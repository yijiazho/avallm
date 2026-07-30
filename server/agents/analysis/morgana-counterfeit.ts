import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import {
  canonicalTeam,
  hasDistinctSeats,
  ROLE_ALIGNMENT,
  TEAM_SIZES,
  teamsEqual,
} from '../../engine/rules.ts'
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
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import type { PublicRecord } from '../communication/public-record.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import { candidateIdForDecision } from '../policy/candidates.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
import {
  MAX_MORGANA_COUNTERFEIT_ASSESSMENTS,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type CounterfeitObservationFraction,
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
} from '../components/canonical-shape.ts'
import {
  clampProbability as clamp01,
  closeProbability as close,
  latticeCount,
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
} from '../components/probability-arithmetic.ts'

function fraction(
  numerator: number,
  denominator: number,
): CounterfeitObservationFraction {
  return {
    numerator,
    denominator,
    index: denominator === 0 ? null : numerator / denominator,
  }
}

interface TruthCounts {
  proposalHits: number
  proposalObservations: number
  voteHits: number
  voteObservations: number
}

/**
 * Join only resolved public proposals to their quest outcomes. Player names,
 * prose, raw events, private state, and input ordering never enter this read.
 */
function truthCounts(record: PublicRecord): readonly TruthCounts[] {
  const counts = Array.from(
    { length: record.playerCount },
    (): TruthCounts => ({
      proposalHits: 0,
      proposalObservations: 0,
      voteHits: 0,
      voteObservations: 0,
    }),
  )
  for (const quest of [...record.quests].sort((a, b) => a.num - b.num)) {
    if (!quest.team || quest.result === undefined) continue
    const executed = record.proposals
      .filter(
        (proposal) =>
          proposal.round === quest.num
          && (proposal.approved === true || proposal.auto === true)
          && teamsEqual(proposal.team, quest.team!),
      )
      .sort(
        (left, right) =>
          left.proposalNum - right.proposalNum
          || left.leader - right.leader,
      )
      .at(-1)
    if (!executed) continue
    counts[executed.leader].proposalObservations += 1
    if (quest.result === 'success') {
      counts[executed.leader].proposalHits += 1
    }
    for (const vote of [...(executed.votes ?? [])].sort(
      (left, right) => left.seat - right.seat,
    )) {
      counts[vote.seat].voteObservations += 1
      if (
        (vote.vote === 'approve' && quest.result === 'success')
        || (vote.vote === 'reject' && quest.result === 'fail')
      ) {
        counts[vote.seat].voteHits += 1
      }
    }
  }
  return counts
}

/**
 * A public-only read projection for "appears Merlin-like." Exact public role
 * marginals remain separate from explicitly non-probabilistic behavior counts.
 */
export function buildPublicCounterfeitMerlinRead(
  record: PublicRecord,
  observer: PublicObserverSnapshot = observePublicRecord(record),
): PublicCounterfeitMerlinReadSnapshot {
  const authoritative = observePublicRecord(record)
  if (!isDeepStrictEqual(observer, authoritative)) {
    throw new Error('counterfeit public read received inconsistent observer')
  }
  const counts = truthCounts(record)
  const merlinNumerators = observer.seats.map((seat) => {
    const merlin = seat.roleMarginals.find(
      (marginal) => marginal.role === 'merlin',
    )?.probability ?? 0
    return Math.round(merlin * observer.feasibleWorldCount)
  })
  const maximum = Math.max(...merlinNumerators)
  if (maximum <= 0) {
    throw new Error('counterfeit public read requires Merlin in the public cast')
  }
  const seats = counts.map((entry, seat): PublicCounterfeitMerlinRead => {
    const proposal = fraction(
      entry.proposalHits,
      entry.proposalObservations,
    )
    const vote = fraction(entry.voteHits, entry.voteObservations)
    const total = fraction(
      entry.proposalHits + entry.voteHits,
      entry.proposalObservations + entry.voteObservations,
    )
    const smoothedTruthTrackingIndex =
      (total.numerator + 1) / (total.denominator + 2)
    const relativeMerlinEligibilityIndex =
      merlinNumerators[seat] / maximum
    return {
      seat,
      probabilitySemantics: 'public-uniform-feasible-joint',
      merlinWorldNumerator: merlinNumerators[seat],
      feasibleWorldDenominator: observer.feasibleWorldCount,
      merlinProbability:
        merlinNumerators[seat] / observer.feasibleWorldCount,
      relativeMerlinEligibilityIndex,
      observationSemantics: 'public-counts-no-data-is-null',
      proposalTruthTracking: proposal,
      voteTruthTracking: vote,
      totalTruthTracking: total,
      proxySemantics:
        'bounded-deterministic-proxy-not-role-probability',
      smoothedTruthTrackingIndex,
      counterfeitReadProxyIndex:
        relativeMerlinEligibilityIndex * smoothedTruthTrackingIndex,
    }
  })
  return {
    version: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    playerCount: record.playerCount,
    feasibleWorldCount: observer.feasibleWorldCount,
    seats,
  }
}

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
  const out = Array<number>(team.length + 1).fill(0)
  for (const weighted of belief.worlds) {
    let count = 0
    for (const seat of team) {
      const role = weighted.world.roleBySeat[seat]
      if (ROLE_ALIGNMENT[role] === 'evil' && role !== 'mordred') count += 1
    }
    out[count] += weighted.probability
  }
  return normalizedDistribution(out)
}

function failureCapability(
  distribution: readonly number[],
  failsRequired: number,
): number {
  return clamp01(
    distribution
      .slice(failsRequired)
      .reduce((sum, mass) => sum + mass, 0),
  )
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
            weighted.probability - belief.worlds[0].probability,
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
  if (![1, 2].includes(failsRequired)) {
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
    (candidate, index): MorganaCounterfeitAssessment => {
        const privateDistribution = merlinVisibleDistribution(
          belief,
          candidate.team,
        )
        const q = failureCapability(privateDistribution, failsRequired)
        const publicDistribution =
          publicTeams[index].evilCountDistribution.slice()
        const p = failureCapability(publicDistribution, failsRequired)
        const support = candidate.direction === 'support'
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
        const counterfeitOpportunityReadProxyIndex =
          read.counterfeitReadProxyIndex
        const counterfeitValue =
          counterfeitOpportunityReadProxyIndex
            * expectedMerlinConsistencyIndex
          + (1 - counterfeitOpportunityReadProxyIndex)
            * counterfeitSignalIndex
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
    },
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

function validFraction(value: unknown): value is CounterfeitObservationFraction {
  if (!plainRecord(value)) return false
  if (
    !exactKeys(value, ['numerator', 'denominator', 'index'])
    || !Number.isSafeInteger(value.numerator)
    || !Number.isSafeInteger(value.denominator)
    || (value.numerator as number) < 0
    || (value.denominator as number) < (value.numerator as number)
  ) return false
  if (value.denominator === 0) {
    return value.numerator === 0 && value.index === null
  }
  return probability(value.index)
    && close(
      value.index,
      (value.numerator as number) / (value.denominator as number),
    )
}

function validReadRow(
  value: unknown,
  seat: number,
  playerCount: number,
  feasibleWorldCount: number,
): value is PublicCounterfeitMerlinRead {
  if (!plainRecord(value)) return false
  if (
    !exactKeys(value, [
      'seat',
      'probabilitySemantics',
      'merlinWorldNumerator',
      'feasibleWorldDenominator',
      'merlinProbability',
      'relativeMerlinEligibilityIndex',
      'observationSemantics',
      'proposalTruthTracking',
      'voteTruthTracking',
      'totalTruthTracking',
      'proxySemantics',
      'smoothedTruthTrackingIndex',
      'counterfeitReadProxyIndex',
    ])
    || value.seat !== seat
    || seat < 0
    || seat >= playerCount
    || value.probabilitySemantics !== 'public-uniform-feasible-joint'
    || !Number.isSafeInteger(value.merlinWorldNumerator)
    || (value.merlinWorldNumerator as number) < 0
    || value.feasibleWorldDenominator !== feasibleWorldCount
    || !probability(value.merlinProbability)
    || !probability(value.relativeMerlinEligibilityIndex)
    || value.observationSemantics !== 'public-counts-no-data-is-null'
    || !validFraction(value.proposalTruthTracking)
    || !validFraction(value.voteTruthTracking)
    || !validFraction(value.totalTruthTracking)
    || value.proxySemantics
      !== 'bounded-deterministic-proxy-not-role-probability'
    || !probability(value.smoothedTruthTrackingIndex)
    || !probability(value.counterfeitReadProxyIndex)
  ) return false
  const proposal = value.proposalTruthTracking
  const vote = value.voteTruthTracking
  const total = value.totalTruthTracking
  return (
    (value.merlinWorldNumerator as number) <= feasibleWorldCount
    && proposal.denominator <= 5
    && vote.denominator <= 5
    && total.denominator <= 10
    && total.numerator === proposal.numerator + vote.numerator
    && total.denominator === proposal.denominator + vote.denominator
    && latticeCount(
      value.merlinProbability,
      feasibleWorldCount,
    ) === value.merlinWorldNumerator
    && close(
      value.smoothedTruthTrackingIndex as number,
      (total.numerator + 1) / (total.denominator + 2),
    )
    && close(
      value.counterfeitReadProxyIndex as number,
      (value.relativeMerlinEligibilityIndex as number)
        * (value.smoothedTruthTrackingIndex as number),
    )
  )
}

function publicCounterfeitReadSchema(value: unknown): boolean {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'version',
      'observerModelVersion',
      'playerCount',
      'feasibleWorldCount',
      'seats',
    ])
    || value.version !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || value.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !Number.isSafeInteger(value.playerCount)
    || (value.playerCount as number) < 5
    || (value.playerCount as number) > 10
    || !Number.isSafeInteger(value.feasibleWorldCount)
    || (value.feasibleWorldCount as number) <= 0
    || (value.feasibleWorldCount as number) > 3_628_800
    || !denseArray(value.seats)
    || value.seats.length !== value.playerCount
  ) return false
  const playerCount = value.playerCount as number
  const denominator = value.feasibleWorldCount as number
  const rows = value.seats as unknown[]
  if (
    rows.some(
      (row, seat) =>
        !validReadRow(row, seat, playerCount, denominator),
    )
  ) return false
  const typed = rows as PublicCounterfeitMerlinRead[]
  const maxNumerator = Math.max(
    ...typed.map((row) => row.merlinWorldNumerator),
  )
  if (
    maxNumerator <= 0
    || typed.reduce(
      (sum, row) => sum + row.merlinWorldNumerator,
      0,
    ) !== denominator
  ) return false
  // Also a count lattice: the index is one seat's Merlin-world count over the
  // largest such count, so the exact integer is recoverable and a decimal slack
  // would admit ratios no world set can produce.
  return typed.every(
    (row) =>
      latticeCount(row.relativeMerlinEligibilityIndex, maxNumerator)
        === row.merlinWorldNumerator,
  )
}

const publicCounterfeitReadCodec =
  projectionCodec<PublicCounterfeitMerlinReadSnapshot>(
    publicCounterfeitReadSchema,
  )

export const validatePublicCounterfeitMerlinRead =
  publicCounterfeitReadCodec.validate
export const decodeCanonicalPublicCounterfeitMerlinRead =
  publicCounterfeitReadCodec.decode

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
    || !Number.isSafeInteger(source.playerCount)
    || (source.playerCount as number) < 5
    || (source.playerCount as number) > 10
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
    const q = failureCapability(
      raw.merlinVisibleEvilCountDistribution as number[],
      threshold,
    )
    const p = failureCapability(
      raw.publicEvilCountDistribution as number[],
      threshold,
    )
    const support = candidate.direction === 'support'
    const a = support ? 1 - q : q
    const b = support ? 1 - p : p
    const tell = Math.max(0, a - b)
    const ambiguity = 1 - Math.abs(2 * p - 1)
    const signal = a * (0.5 * ambiguity + 0.5 * tell)
    const read = (
      value.actingSeatRead as PublicCounterfeitMerlinRead
    ).counterfeitReadProxyIndex
    const counterfeitValue = read * a + (1 - read) * signal
    if (
      !close(q, raw.merlinVisibleFailureCapabilityProbability as number)
      || !close(p, raw.publicFailureCapabilityProbability as number)
      || !close(a, raw.expectedMerlinConsistencyIndex as number)
      || !close(b, raw.publicConsistencyBaselineIndex as number)
      || !close(tell, raw.privateKnowledgeTellIndex as number)
      || !close(ambiguity, raw.publicAmbiguityIndex as number)
      || !close(signal, raw.counterfeitSignalIndex as number)
      || !close(
        read,
        raw.counterfeitOpportunityReadProxyIndex as number,
      )
      || !close(counterfeitValue, raw.counterfeitValue as number)
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

export function validatePublicCounterfeitMerlinReadHostJoin(
  value: unknown,
  record: PublicRecord,
): value is PublicCounterfeitMerlinReadSnapshot {
  return validatePublicCounterfeitMerlinRead(value)
    && validateAdmittedPublicCounterfeitMerlinReadHostJoin(value, record)
}

export function validateAdmittedPublicCounterfeitMerlinReadHostJoin(
  value: PublicCounterfeitMerlinReadSnapshot,
  record: PublicRecord,
): boolean {
  return isDeepStrictEqual(value, buildPublicCounterfeitMerlinRead(record))
}

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
