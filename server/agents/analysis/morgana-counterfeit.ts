import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import {
  ROLE_ALIGNMENT,
  TEAM_SIZES,
} from '../../engine/rules.ts'
import { canonicalTeam, hasDistinctSeats } from '../../engine/seatset.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import { assertDistribution } from '../belief/invariants.ts'
import {
  visibleEventCursor,
} from '../belief/exact.ts'
import { worldSatisfiesView } from '../belief/constraints.ts'
import {
  canonicalRoleMultiset,
  canonicalWorldKey,
} from '../belief/worlds.ts'
import { assessPublicJointTeams, observePublicRecord } from './observer.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './observer-types.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import {
  buildPublicCounterfeitMerlinRead,
  validatePublicCounterfeitMerlinReadHostJoin,
  validReadRow,
} from './morgana-counterfeit-public-read.ts'
import type { PolicyCandidate } from '../candidate/types.ts'
import { candidateIdForDecision } from '../candidate/candidates.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
import {
  MAX_MORGANA_COUNTERFEIT_ASSESSMENTS,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type MorganaCounterfeitAssessment,
  type MorganaCounterfeitCandidate,
  type PrivateMorganaCounterfeitObjective,
  type PublicCounterfeitMerlinRead,
  type PublicCounterfeitMerlinReadSnapshot,
} from './morgana-counterfeit-types.ts'
import {
  canonicalCombinations,
  canonicalRequestBlock,
  canonicalRoles,
  canonicalSeats,
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  clampProbability as clamp01,
  closeProbability as close,
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
} from '../canonical/probability-arithmetic.ts'
import { teamEvilCountDistribution } from './perception-asymmetry.ts'
import { questFailureCapabilityProbability } from './quest-failure-capability.ts'

// The public-read half moved to morgana-counterfeit-public-read.ts. Re-export its
// boundary so existing importers of these names keep resolving through here.
export {
  buildPublicCounterfeitMerlinRead,
  validatePublicCounterfeitMerlinReadHostJoin,
}
export {
  validatePublicCounterfeitMerlinRead,
  decodeCanonicalPublicCounterfeitMerlinRead,
  validateAdmittedPublicCounterfeitMerlinReadHostJoin,
} from './morgana-counterfeit-public-read.ts'

function candidateCommitment(
  candidate: PolicyCandidate,
  view: PlayerView,
): MorganaCounterfeitCandidate | undefined {
  if (candidate.decision.kind === 'propose') {
    return {
      candidateId: candidate.id,
      kind: 'propose',
      direction: 'support',
      team: canonicalTeam(candidate.decision.team),
    }
  }
  if (candidate.decision.kind === 'vote' && view.currentTeam) {
    return {
      candidateId: candidate.id,
      kind: 'vote',
      direction: candidate.decision.vote === 'approve'
        ? 'support'
        : 'oppose',
      team: canonicalTeam(view.currentTeam),
    }
  }
  return undefined
}

function normalizedDistribution(
  distribution: readonly number[],
): readonly number[] {
  const total = distribution.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('counterfeit objective requires positive world mass')
  }
  // The per-element clamp is a no-op for the non-negative masses this receives
  // (each value/total is already in [0, 1]), so it must not perturb the sum. A
  // negative input, the shape that would make clamp bite and the total lie,
  // trips this guard instead of skewing the counterfeit assessment downstream.
  const normalized = distribution.map((value) => clamp01(value / total))
  assertDistribution(normalized, 'counterfeit objective distribution')
  return normalized
}

function merlinVisibleDistribution(
  belief: BeliefSnapshot,
  team: readonly Seat[],
): readonly number[] {
  // Merlin-visible evil is everyone evil except Mordred; the shared per-team
  // count fold matches the inline loop this replaced bit-for-bit.
  const out = teamEvilCountDistribution(
    belief.worlds,
    team,
    (weighted, seat) => {
      const role = weighted.world.roleBySeat[seat]!
      return ROLE_ALIGNMENT[role]! === 'evil' && role !== 'mordred'
    },
    (weighted) => weighted.probability,
  )
  return normalizedDistribution(out)
}

interface CounterfeitAssessmentValues {
  expectedMerlinConsistencyIndex: number
  publicConsistencyBaselineIndex: number
  privateKnowledgeTellIndex: number
  publicAmbiguityIndex: number
  counterfeitSignalIndex: number
  counterfeitValue: number
}

/**
 * The counterfeit assessment math, derived once for both the builder and the
 * schema. Given the two failure-capability probabilities (private q, public p)
 * and the acting-seat opportunity read, it produces the full index chain. The
 * schema previously recomputed the same expressions under single-letter locals
 * (a, b, tell, signal); routing both callers through this helper removes that
 * translation. No index here is clamped in either the old builder or the old
 * schema, so the extraction is operator-for-operator identical with no domain
 * assumptions.
 */
function counterfeitAssessmentValues(
  support: boolean,
  merlinVisibleFailureCapabilityProbability: number,
  publicFailureCapabilityProbability: number,
  counterfeitOpportunityReadProxyIndex: number,
): CounterfeitAssessmentValues {
  const q = merlinVisibleFailureCapabilityProbability
  const p = publicFailureCapabilityProbability
  const expectedMerlinConsistencyIndex = support ? 1 - q : q
  const publicConsistencyBaselineIndex = support ? 1 - p : p
  const privateKnowledgeTellIndex = Math.max(
    0,
    expectedMerlinConsistencyIndex - publicConsistencyBaselineIndex,
  )
  const publicAmbiguityIndex = 1 - Math.abs(2 * p - 1)
  const counterfeitSignalIndex = expectedMerlinConsistencyIndex * (
    0.5 * publicAmbiguityIndex
    + 0.5 * privateKnowledgeTellIndex
  )
  const counterfeitValue =
    counterfeitOpportunityReadProxyIndex * expectedMerlinConsistencyIndex
    + (1 - counterfeitOpportunityReadProxyIndex) * counterfeitSignalIndex
  return {
    expectedMerlinConsistencyIndex,
    publicConsistencyBaselineIndex,
    privateKnowledgeTellIndex,
    publicAmbiguityIndex,
    counterfeitSignalIndex,
    counterfeitValue,
  }
}

function validateBeliefForMorgana(
  belief: BeliefSnapshot,
  view: PlayerView,
): void {
  const cast = canonicalRoleMultiset(view.rolesInPlay)
  const keys = new Set<string>()
  if (
    !belief
    || typeof belief.modelVersion !== 'string'
    || belief.modelVersion.length === 0
    || !Number.isSafeInteger(belief.throughSeq)
    || belief.throughSeq < -1
    || belief.throughSeq !== visibleEventCursor(view)
    || !['constraints-only', 'weighted', 'degraded'].includes(
      belief.quality,
    )
    || !belief.worlds.length
    || belief.playerMarginals.length !== view.playerCount
    || belief.worlds.some(
      (weighted) => {
        const roles = weighted.world.roleBySeat
        const alignments = weighted.world.alignmentBySeat
        const duplicate = keys.has(weighted.world.key)
        keys.add(weighted.world.key)
        return (
          roles.length !== view.playerCount
        || alignments.length !== view.playerCount
        || weighted.world.roleBySeat[view.seat] !== 'morgana'
        || !isDeepStrictEqual(canonicalRoleMultiset(roles), cast)
        || weighted.world.key !== canonicalWorldKey(roles)
        || duplicate
        || roles.some(
          (role, seat) => ROLE_ALIGNMENT[role] !== alignments[seat],
        )
        || !probability(weighted.probability)
        || weighted.probability === 0
        || !worldSatisfiesView(
          view,
          weighted.world,
          { questRecord: 'all' },
        )
        )
      },
    )
    // Compensated, for the reason spelled out at the same check in
    // analysis/mordred-blindness.ts.
    || Math.abs(
      stableProbabilitySum(belief.worlds, (weighted) => weighted.probability)
      - 1,
    ) > PROBABILITY_TOLERANCE
    || (
      belief.quality === 'constraints-only'
      && belief.worlds.some(
        (weighted) =>
          Math.abs(
            weighted.probability - belief.worlds[0]!.probability,
          ) > PROBABILITY_TOLERANCE,
      )
    )
  ) {
    throw new Error('counterfeit objective requires Morgana-bound joint worlds')
  }
}

/**
 * Bind a kernel-admitted belief root to this exact seat view without
 * repeating the root codec's structural and probability validation.
 */
function validateAdmittedBeliefForMorgana(
  belief: BeliefSnapshot,
  view: PlayerView,
): void {
  const cast = canonicalRoleMultiset(view.rolesInPlay)
  if (
    belief.throughSeq !== visibleEventCursor(view)
    || belief.worlds.some((weighted) => {
      const roles = weighted.world.roleBySeat
      return (
        roles[view.seat] !== 'morgana'
        || !isDeepStrictEqual(canonicalRoleMultiset(roles), cast)
        || !worldSatisfiesView(
          view,
          weighted.world,
          { questRecord: 'all' },
        )
      )
    })
  ) {
    throw new Error('counterfeit objective requires Morgana-bound joint worlds')
  }
}

interface MorganaCounterfeitObjectiveInput {
  req: DecisionRequest
  view: PlayerView
  belief: BeliefSnapshot
  publicRead: PublicCounterfeitMerlinReadSnapshot
  candidates: readonly PolicyCandidate[]
}

/**
 * Assess one counterfeit candidate. This is the per-candidate map body of
 * buildMorganaCounterfeitObjectiveInternal, extracted verbatim; it takes
 * exactly the operands the closure captured, so every field is produced
 * identically (the host-join reconstructs the objective byte for byte).
 */
function assessCandidate(
  candidate: MorganaCounterfeitCandidate,
  index: number,
  belief: BeliefSnapshot,
  failsRequired: number,
  publicTeams: ReturnType<typeof assessPublicJointTeams>,
  read: PublicCounterfeitMerlinRead,
): MorganaCounterfeitAssessment {
  const privateDistribution = merlinVisibleDistribution(
    belief,
    candidate.team,
  )
  const q = clamp01(questFailureCapabilityProbability(
    privateDistribution,
    failsRequired,
  ))
  const publicDistribution =
    publicTeams[index]!.evilCountDistribution.slice()
  const p = clamp01(questFailureCapabilityProbability(
    publicDistribution,
    failsRequired,
  ))
  const support = candidate.direction === 'support'
  const counterfeitOpportunityReadProxyIndex =
    read.counterfeitReadProxyIndex
  const {
    expectedMerlinConsistencyIndex,
    publicConsistencyBaselineIndex,
    privateKnowledgeTellIndex,
    publicAmbiguityIndex,
    counterfeitSignalIndex,
    counterfeitValue,
  } = counterfeitAssessmentValues(
    support,
    q,
    p,
    counterfeitOpportunityReadProxyIndex,
  )
  return {
    candidate,
    probabilitySemantics: 'resolved-complete-world-sum',
    merlinVisibleEvilCountDistribution: privateDistribution,
    merlinVisibleFailureCapabilityProbability: q,
    publicProbabilitySemantics:
      'public-preaction-uniform-feasible-joint',
    publicEvilCountDistribution: publicDistribution,
    publicFailureCapabilityProbability: p,
    valueSemantics:
      'bounded-deterministic-indices-not-probabilities',
    expectedMerlinConsistencyIndex,
    publicConsistencyBaselineIndex,
    privateKnowledgeTellIndex,
    publicAmbiguityIndex,
    counterfeitSignalIndex,
    counterfeitOpportunityReadProxyIndex,
    counterfeitValue,
  }
}

function buildMorganaCounterfeitObjectiveInternal(
  input: MorganaCounterfeitObjectiveInput,
  admittedInputs: boolean,
): PrivateMorganaCounterfeitObjective {
  const { req, view, belief, publicRead, candidates } = input
  if (
    view.role !== 'morgana'
    || req.seat !== view.seat
    || !['propose', 'vote'].includes(req.kind)
    || req.round !== view.round
    || req.proposalNum !== view.proposalNum
    || view.phase !== (req.kind === 'propose' ? 'proposal' : 'vote')
    || candidates.length > MAX_MORGANA_COUNTERFEIT_ASSESSMENTS
  ) {
    throw new Error('counterfeit objective is inapplicable to this decision')
  }
  // admittedInputs gates two independent kernel-trust skips. Skip 1: the belief
  // is checked with the admitted (structural-only) validator instead of the full
  // hostile-boundary one. Skip 2 (below): the public read is trusted as-is
  // rather than reconstructed and compared. Both are only skipped for inputs the
  // component kernel already admitted; an untrusted build performs both.
  if (admittedInputs) {
    validateAdmittedBeliefForMorgana(belief, view)
  } else {
    validateBeliefForMorgana(belief, view)
  }
  const record = projectPublicRecord(view)
  const observer = observePublicRecord(record)
  if (
    !admittedInputs
    && !isDeepStrictEqual(
      publicRead,
      buildPublicCounterfeitMerlinRead(record, observer),
    )
  ) {
    throw new Error('counterfeit objective received inconsistent public read')
  }
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  if (failsRequired !== 1 && failsRequired !== 2) {
    throw new Error('counterfeit objective requires current fail threshold')
  }
  const expectedTeamSize = TEAM_SIZES[view.playerCount]?.[view.round - 1]
  const currentTeam = req.kind === 'vote'
    ? view.currentTeam === undefined
      ? undefined
      : canonicalTeam(view.currentTeam)
    : undefined
  if (
    !Number.isSafeInteger(expectedTeamSize)
    || (
      req.kind === 'vote'
      && (
        currentTeam === undefined
        || currentTeam.length !== expectedTeamSize
        || !hasDistinctSeats(currentTeam)
        || currentTeam.some(
          (seat) =>
            !Number.isSafeInteger(seat)
            || seat < 0
            || seat >= view.playerCount,
        )
      )
    )
  ) {
    throw new Error('counterfeit objective requires a legal current team')
  }
  const commitments = candidates
    .map((candidate) => candidateCommitment(candidate, view))
    .filter(
      (candidate): candidate is MorganaCounterfeitCandidate =>
        candidate !== undefined,
    )
  if (
    commitments.length !== candidates.length
    || new Set(commitments.map((candidate) => candidate.candidateId)).size
      !== commitments.length
  ) {
    throw new Error('counterfeit objective requires unique team candidates')
  }
  if (!view.rolesInPlay.includes('percival')) {
    throw new Error('Morgana counterfeit objective requires legal Percival dependency')
  }
  const publicTeams = assessPublicJointTeams(
    record,
    commitments.map((candidate) => candidate.team),
  )
  const read = publicRead.seats[view.seat]
  if (!read || read.seat !== view.seat) {
    throw new Error('counterfeit objective requires the acting-seat read')
  }
  const assessments = commitments.map(
    (candidate, index): MorganaCounterfeitAssessment =>
      assessCandidate(candidate, index, belief, failsRequired, publicTeams, read),
  )
  const snapshot: PrivateMorganaCounterfeitObjective = {
    version: MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
    role: 'morgana',
    source: {
      beliefModelVersion: belief.modelVersion,
      beliefThroughSeq: belief.throughSeq,
      beliefQuality: belief.quality,
      playerCount: view.playerCount,
      rolesInPlay: [...view.rolesInPlay],
      publicReadVersion: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
      observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
      observerFeasibleWorldCount: observer.feasibleWorldCount,
    },
    request: {
      seat: req.seat,
      kind: req.kind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired,
      ...(currentTeam ? { currentTeam } : {}),
    },
    counterfeitApplicability: 'percival-in-cast',
    assessmentApplicability: 'team-candidates',
    actingSeatRead: structuredClone(read),
    assessments,
  }
  return snapshot
}

export function buildMorganaCounterfeitObjective(
  input: MorganaCounterfeitObjectiveInput,
): PrivateMorganaCounterfeitObjective {
  return buildMorganaCounterfeitObjectiveInternal(input, false)
}

/** Build after the kernel has admitted the belief and public-read inputs. */
export function buildAdmittedMorganaCounterfeitObjective(
  input: MorganaCounterfeitObjectiveInput,
): PrivateMorganaCounterfeitObjective {
  return buildMorganaCounterfeitObjectiveInternal(input, true)
}

function validDistribution(value: unknown, teamSize: number): value is number[] {
  return denseArray(value)
    && value.length === teamSize + 1
    && value.every(probability)
    && close(
      value.reduce((sum, entry) => sum + (entry as number), 0),
      1,
    )
}

function morganaCounterfeitObjectiveSchema(value: unknown): boolean {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'version',
      'role',
      'source',
      'request',
      'counterfeitApplicability',
      'assessmentApplicability',
      'actingSeatRead',
      'assessments',
    ])
    || value.version !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || value.role !== 'morgana'
    || !plainRecord(value.source)
    || !plainRecord(value.request)
  ) return false
  const source = value.source
  const request = value.request
  if (
    !exactKeys(source, [
      'beliefModelVersion',
      'beliefThroughSeq',
      'beliefQuality',
      'playerCount',
      'rolesInPlay',
      'publicReadVersion',
      'observerModelVersion',
      'observerFeasibleWorldCount',
    ])
    || typeof source.beliefModelVersion !== 'string'
    || source.beliefModelVersion.length === 0
    || source.beliefModelVersion.length > 200
    || !Number.isSafeInteger(source.beliefThroughSeq)
    || (source.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      String(source.beliefQuality),
    )
    || !tableSize(source.playerCount)
    || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
    || !(source.rolesInPlay as Role[]).includes('morgana')
    || source.publicReadVersion
      !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !Number.isSafeInteger(source.observerFeasibleWorldCount)
    || (source.observerFeasibleWorldCount as number) <= 0
    || !canonicalRequestBlock(request, {
      playerCount: source.playerCount as number,
      kinds: ['propose', 'vote'],
      voteCurrentTeam: true,
    })
    || !validReadRow(
      value.actingSeatRead,
      request.seat as number,
      source.playerCount as number,
      source.observerFeasibleWorldCount as number,
    )
  ) return false
  // The request's own team is checked by the shared block guard; the team size
  // is still needed below, where the propose candidate set is enumerated.
  const requestTeamSize = TEAM_SIZES[source.playerCount as number]?.[
    (request.round as number) - 1
  ]
  if (
    value.counterfeitApplicability !== 'percival-in-cast'
    || value.assessmentApplicability !== 'team-candidates'
    || !denseArray(value.assessments)
    || value.assessments.length
      > MAX_MORGANA_COUNTERFEIT_ASSESSMENTS
  ) return false
  const ids = new Set<string>()
  for (const raw of value.assessments) {
    if (!plainRecord(raw)) return false
    if (
      !exactKeys(raw, [
        'candidate',
        'probabilitySemantics',
        'merlinVisibleEvilCountDistribution',
        'merlinVisibleFailureCapabilityProbability',
        'publicProbabilitySemantics',
        'publicEvilCountDistribution',
        'publicFailureCapabilityProbability',
        'valueSemantics',
        'expectedMerlinConsistencyIndex',
        'publicConsistencyBaselineIndex',
        'privateKnowledgeTellIndex',
        'publicAmbiguityIndex',
        'counterfeitSignalIndex',
        'counterfeitOpportunityReadProxyIndex',
        'counterfeitValue',
      ])
      || !plainRecord(raw.candidate)
    ) return false
    const candidate = raw.candidate
    if (
      !exactKeys(candidate, [
        'candidateId',
        'kind',
        'direction',
        'team',
      ])
      || typeof candidate.candidateId !== 'string'
      || candidate.candidateId.length === 0
      || candidate.candidateId.length > 256
      || ids.has(candidate.candidateId)
      || candidate.kind !== request.kind
      || !['support', 'oppose'].includes(String(candidate.direction))
      || !canonicalSeats(candidate.team, source.playerCount as number)
    ) return false
    const playerCount = source.playerCount as number
    const teamSize = TEAM_SIZES[playerCount]?.[
      (request.round as number) - 1
    ]
    const typedTeam = candidate.team as Seat[]
    const expectedCandidateId = candidate.kind === 'propose'
      ? candidateIdForDecision({
          kind: 'propose',
          team: typedTeam,
        })
      : candidateIdForDecision({
          kind: 'vote',
          vote: candidate.direction === 'support'
            ? 'approve'
            : 'reject',
        })
    if (
      !Number.isSafeInteger(teamSize)
      || typedTeam.length !== teamSize
      || (
        candidate.kind === 'propose'
        && candidate.direction !== 'support'
      )
      || candidate.candidateId !== expectedCandidateId
      || (
        candidate.kind === 'vote'
        && !isDeepStrictEqual(candidate.team, request.currentTeam)
      )
    ) return false
    ids.add(candidate.candidateId)
    const candidateTeamSize = candidate.team.length
    if (
      raw.probabilitySemantics !== 'resolved-complete-world-sum'
      || !validDistribution(
        raw.merlinVisibleEvilCountDistribution,
        candidateTeamSize,
      )
      || !probability(raw.merlinVisibleFailureCapabilityProbability)
      || raw.publicProbabilitySemantics
        !== 'public-preaction-uniform-feasible-joint'
      || !validDistribution(
        raw.publicEvilCountDistribution,
        candidateTeamSize,
      )
      || !probability(raw.publicFailureCapabilityProbability)
      || raw.valueSemantics
        !== 'bounded-deterministic-indices-not-probabilities'
      || !probability(raw.expectedMerlinConsistencyIndex)
      || !probability(raw.publicConsistencyBaselineIndex)
      || !probability(raw.privateKnowledgeTellIndex)
      || !probability(raw.publicAmbiguityIndex)
      || !probability(raw.counterfeitSignalIndex)
      || !probability(raw.counterfeitOpportunityReadProxyIndex)
      || !probability(raw.counterfeitValue)
    ) return false
    const threshold = request.failsRequired as number
    const q = clamp01(questFailureCapabilityProbability(
      raw.merlinVisibleEvilCountDistribution as number[],
      threshold,
    ))
    const p = clamp01(questFailureCapabilityProbability(
      raw.publicEvilCountDistribution as number[],
      threshold,
    ))
    const support = candidate.direction === 'support'
    const read = (
      value.actingSeatRead as PublicCounterfeitMerlinRead
    ).counterfeitReadProxyIndex
    const derived = counterfeitAssessmentValues(support, q, p, read)
    if (
      !close(q, raw.merlinVisibleFailureCapabilityProbability as number)
      || !close(p, raw.publicFailureCapabilityProbability as number)
      || !close(
        derived.expectedMerlinConsistencyIndex,
        raw.expectedMerlinConsistencyIndex as number,
      )
      || !close(
        derived.publicConsistencyBaselineIndex,
        raw.publicConsistencyBaselineIndex as number,
      )
      || !close(
        derived.privateKnowledgeTellIndex,
        raw.privateKnowledgeTellIndex as number,
      )
      || !close(
        derived.publicAmbiguityIndex,
        raw.publicAmbiguityIndex as number,
      )
      || !close(
        derived.counterfeitSignalIndex,
        raw.counterfeitSignalIndex as number,
      )
      || !close(
        read,
        raw.counterfeitOpportunityReadProxyIndex as number,
      )
      || !close(derived.counterfeitValue, raw.counterfeitValue as number)
    ) return false
  }
  const expectedCandidateIds = request.kind === 'vote'
    ? [
        candidateIdForDecision({ kind: 'vote', vote: 'approve' }),
        candidateIdForDecision({ kind: 'vote', vote: 'reject' }),
      ]
    : canonicalCombinations(
        source.playerCount as number,
        requestTeamSize as number,
      ).map((team) => candidateIdForDecision({
        kind: 'propose',
        team,
      }))
  return ids.size === expectedCandidateIds.length
    && expectedCandidateIds.every((candidateId) => ids.has(candidateId))
}

const morganaCounterfeitObjectiveCodec =
  projectionCodec<PrivateMorganaCounterfeitObjective>(
    morganaCounterfeitObjectiveSchema,
  )

export const validatePrivateMorganaCounterfeitObjective =
  morganaCounterfeitObjectiveCodec.validate
export const decodeCanonicalPrivateMorganaCounterfeitObjective =
  morganaCounterfeitObjectiveCodec.decode

export function validatePrivateMorganaCounterfeitHostJoin(
  value: unknown,
  input: {
    req: DecisionRequest
    view: PlayerView
    belief: BeliefSnapshot
    publicRead: PublicCounterfeitMerlinReadSnapshot
    candidates: readonly PolicyCandidate[]
  },
): value is PrivateMorganaCounterfeitObjective {
  return validatePrivateMorganaCounterfeitObjective(value)
    && validatePublicCounterfeitMerlinReadHostJoin(
      input.publicRead,
      projectPublicRecord(input.view),
    )
    && isDeepStrictEqual(value, buildMorganaCounterfeitObjective(input))
}

export const validateAdmittedPrivateMorganaCounterfeitHostJoin = exactHostJoin(
  (input: MorganaCounterfeitObjectiveInput) =>
    buildMorganaCounterfeitObjectiveInternal(input, true),
)
