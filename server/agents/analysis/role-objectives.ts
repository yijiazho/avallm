import { isDeepStrictEqual } from 'node:util'
import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import { merlinCandidatesOf } from '../../engine/knowledge.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import { DECISION_KINDS } from '../../engine/types.ts'
import {
  hiddenTeamEvilMarginals,
  JOINT_IDENTITY_MODEL_VERSION,
  type IdentityProjectionScope,
  type PrivateIdentitySnapshot,
  type RoleIdentityPosterior,
  validatePrivateIdentityHostJoin,
} from '../belief/identity.ts'
import { canonicalRoleMultiset } from '../belief/worlds.ts'
import type { PolicyCandidate } from '../candidate/types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicJointTeamAssessment,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import {
  assessPublicJointTeams,
  observePublicRecord,
  validatePublicObserverSnapshot,
} from './observer.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import {
  MAX_ROLE_OBJECTIVE_ASSESSMENTS,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type CandidatePublicCommitment,
  type MerlinCandidateObjective,
  type MerlinMorganaPairHypothesis,
  type ObjectiveRequest,
  type ObjectiveSource,
  type PercivalCandidateObjective,
  type PercivalRoleObjective,
  type PrivateRoleObjectiveSnapshot,
  type RoleObjectiveRole,
  isPublicCommitmentDirection,
} from './role-objective-types.ts'
import type {
  AssertNever,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
} from '../../shared/key-list-guards.ts'
import {
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
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
import { publicSeatSalience } from './public-seat-salience.ts'
import { questFailureCapabilityProbability } from './quest-failure-capability.ts'
import { validCountDistribution } from './count-distribution.ts'

const boundedIndex = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= -1
  && value <= 1

function roleCount(roles: readonly Role[], role: Role): number {
  return roles.filter((candidate) => candidate === role).length
}

function teamForDecision(
  decision: Decision,
  view: PlayerView,
): readonly Seat[] | undefined {
  if (decision.kind === 'propose') return decision.team
  if (decision.kind === 'finalize') {
    return decision.stick ? view.currentTeam : decision.team
  }
  if (decision.kind === 'vote' || decision.kind === 'discuss') {
    return view.currentTeam
  }
  return undefined
}

function directionForDecision(
  decision: Decision,
): CandidatePublicCommitment['direction'] {
  if (decision.kind === 'vote') {
    return decision.vote === 'approve' ? 'support' : 'oppose'
  }
  // Table talk carries no machine-readable direction: what a seat said about
  // the team is prose, and reading support or opposition out of it would be a
  // judgement this projection does not make.
  if (decision.kind === 'discuss') return 'neutral'
  return decision.kind === 'propose' || decision.kind === 'finalize'
    ? 'support'
    : 'neutral'
}

function commitmentFor(
  candidate: PolicyCandidate,
  view: PlayerView,
): CandidatePublicCommitment | undefined {
  const team = teamForDecision(candidate.decision, view)
  if (!team) return undefined
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    direction: directionForDecision(candidate.decision),
    team: [...team].sort((left, right) => left - right),
  }
}

function directionSign(
  direction: CandidatePublicCommitment['direction'],
): number {
  return direction === 'support' ? 1 : direction === 'oppose' ? -1 : 0
}

function publicTeamAmbiguityFrom(cleanProbability: number): number {
  return clamp01(
    1 - Math.abs(2 * cleanProbability - 1),
  )
}

function publicTeamAmbiguity(
  assessment: PublicJointTeamAssessment,
): number {
  return publicTeamAmbiguityFrom(assessment.cleanProbability)
}

function influenceValueFrom(
  sign: number,
  cleanProbability: number,
  failureCapability: number,
): number {
  return sign * (cleanProbability - failureCapability)
}

interface PercivalProxyIndices {
  publicPairInfluenceValue: number
  pairKnowledgeTellIndex: number
  decisiveAmbiguityIndex: number
  merlinMimicryProxyIndex: number
  selfDecoyOpportunityProxyIndex: number
}

/**
 * The Percival proxy chain, derived once for the builder and the schema.
 *
 * `pairInfluenceValue` is supplied by the caller (the builder passes its fresh
 * value, the schema passes the stored one) so the tell keeps reading exactly
 * the operand each side reads today. The inner clamps on the ambiguity and the
 * self-decoy product are provable no-ops over the validated domain - the
 * ambiguity argument is 1 - |2c - 1| with c a probability, so it lies in
 * [0, 1], and the self-decoy product multiplies two [0, 1] factors - so the
 * schema, whose old code omitted those clamps, computes the same numbers.
 */
function percivalProxies(args: {
  sign: number
  pairInfluenceValue: number
  publicMerlinOnTeamProbability: number
  publicMorganaOnTeamProbability: number
  publicTeamCleanProbability: number
  publicMerlinProbabilityAtSelf: number
}): PercivalProxyIndices {
  const publicPairInfluenceValue =
    args.sign * (
      args.publicMerlinOnTeamProbability - args.publicMorganaOnTeamProbability
    )
  const pairKnowledgeTellIndex = clamp01(
    Math.max(0, args.pairInfluenceValue - publicPairInfluenceValue) / 2,
  )
  const decisiveAmbiguityIndex = clamp01(
    Math.abs(args.sign)
      * publicTeamAmbiguityFrom(args.publicTeamCleanProbability),
  )
  const merlinMimicryProxyIndex = clamp01(
    0.75 * pairKnowledgeTellIndex + 0.25 * decisiveAmbiguityIndex,
  )
  const selfDecoyOpportunityProxyIndex = clamp01(
    (1 - args.publicMerlinProbabilityAtSelf) * merlinMimicryProxyIndex,
  )
  return {
    publicPairInfluenceValue,
    pairKnowledgeTellIndex,
    decisiveAmbiguityIndex,
    merlinMimicryProxyIndex,
    selfDecoyOpportunityProxyIndex,
  }
}

function publicRoleOnTeamProbability(
  observer: PublicObserverSnapshot,
  team: readonly Seat[],
  role: 'merlin' | 'morgana',
): number {
  return clamp01(
    team.reduce(
      (sum, seat) =>
        sum + (
          observer.seats[seat]!.roleMarginals.find(
            (marginal) => marginal.role === role,
          )?.probability ?? 0
        ),
      0,
    ),
  )
}

function identityRolePosterior(
  identity: PrivateIdentitySnapshot,
  roles: readonly Role[],
): RoleIdentityPosterior | undefined {
  const expected = canonicalRoleMultiset(roles)
  return identity.rolePosteriors.find(
    (posterior) => isDeepStrictEqual(posterior.queriedRoles, expected),
  )
}

function merlinAssessments(
  identity: PrivateIdentitySnapshot,
  observer: PublicObserverSnapshot,
  commitments: readonly CandidatePublicCommitment[],
  viewerSeat: Seat,
  publicTeams: readonly PublicJointTeamAssessment[],
  failsRequired: number,
  publicRecord: ReturnType<typeof projectPublicRecord>,
): readonly MerlinCandidateObjective[] {
  const hidden = identity.hiddenTeamPosterior
  if (!hidden) throw new Error('Merlin objective requires a hidden-team posterior')
  return commitments.map((candidate, candidateIndex) => {
    const team = candidate.team ?? []
    const publicTeam = publicTeams[candidateIndex]!
    const distribution = Array<number>(team.length + 1).fill(0)
    for (const hypothesis of hidden.hypotheses) {
      const evil = team.filter((seat) => hypothesis.evilSeats.includes(seat)).length
      distribution[evil]! += hypothesis.probability
    }
    const distributionTotal = distribution.reduce(
      (sum, mass) => sum + mass,
      0,
    )
    for (let index = 0; index < distribution.length; index++) {
      distribution[index] = clamp01(distribution[index]! / distributionTotal)
    }
    const teamCleanProbability = distribution[0]!
    const teamFailureCapabilityProbability = questFailureCapabilityProbability(
      distribution,
      failsRequired,
    )
    const sign = directionSign(candidate.direction)
    const ambiguity = publicTeamAmbiguity(publicTeam)
    const conspicuousness = clamp01(Math.abs(sign) * ambiguity)
    return {
      candidate,
      probabilitySemantics: 'resolved-complete-world-sum',
      valueSemantics: 'bounded-deterministic-indices-not-probabilities',
      teamCleanProbability,
      teamFailureCapabilityProbability,
      evilCountDistribution: distribution,
      influenceValue: influenceValueFrom(
        sign,
        teamCleanProbability,
        teamFailureCapabilityProbability,
      ),
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamCleanProbability: publicTeam.cleanProbability,
      publicAmbiguityIndex: ambiguity,
      conspicuousnessIndex: conspicuousness,
      assassinExposureProxyIndex: clamp01(
        (
          publicSeatSalience(
            observer.seats[viewerSeat]!,
            publicRecord,
          )
          + conspicuousness
        ) / 2,
      ),
    }
  })
}

function pairPosterior(
  identity: PrivateIdentitySnapshot,
): {
  includesMorgana: boolean
  hypotheses: readonly MerlinMorganaPairHypothesis[]
} {
  const includesMorgana = identity.sourceBelief.rolesInPlay.includes('morgana')
  const queriedRoles: Role[] = includesMorgana
    ? ['merlin', 'morgana']
    : ['merlin']
  const posterior = identityRolePosterior(identity, queriedRoles)
  if (!posterior) {
    throw new Error('Percival objective requires a Merlin/Morgana identity posterior')
  }
  const hypotheses = posterior.hypotheses.map((hypothesis) => {
    const merlin = hypothesis.assignments.find(
      (assignment) => assignment.role === 'merlin',
    )
    const morgana = hypothesis.assignments.find(
      (assignment) => assignment.role === 'morgana',
    )
    if (
      !merlin
      || merlin.seats.length !== 1
      || (includesMorgana && (!morgana || morgana.seats.length !== 1))
      || (!includesMorgana && morgana !== undefined)
    ) {
      throw new Error('identity posterior has invalid Merlin/Morgana multiplicity')
    }
    return {
      merlinSeat: merlin.seats[0]!,
      morganaSeat: morgana?.seats[0] ?? null,
      probability: hypothesis.probability,
    }
  }).sort((left, right) =>
    left.merlinSeat - right.merlinSeat
    || (left.morganaSeat ?? -1) - (right.morganaSeat ?? -1))
  return { includesMorgana, hypotheses }
}

function percivalAssessments(
  pairs: ReturnType<typeof pairPosterior>,
  observer: PublicObserverSnapshot,
  commitments: readonly CandidatePublicCommitment[],
  viewerSeat: Seat,
  publicTeams: readonly PublicJointTeamAssessment[],
): readonly PercivalCandidateObjective[] {
  return commitments.map((candidate, candidateIndex) => {
    const team = candidate.team ?? []
    const merlinOnTeamProbability = clamp01(
      pairs.hypotheses.reduce(
        (sum, hypothesis) =>
          sum + (team.includes(hypothesis.merlinSeat)
            ? hypothesis.probability
            : 0),
        0,
      ),
    )
    const morganaOnTeamProbability = clamp01(
      pairs.hypotheses.reduce(
        (sum, hypothesis) =>
          sum + (
            hypothesis.morganaSeat !== null
            && team.includes(hypothesis.morganaSeat)
              ? hypothesis.probability
              : 0
          ),
        0,
      ),
    )
    const sign = directionSign(candidate.direction)
    const publicTeam = publicTeams[candidateIndex]!
    const publicMerlinProbabilityAtSelf =
      observer.seats[viewerSeat]!.roleMarginals.find(
        (marginal) => marginal.role === 'merlin',
      )?.probability ?? 0
    const publicMerlinOnTeamProbability =
      publicRoleOnTeamProbability(observer, team, 'merlin')
    const publicMorganaOnTeamProbability =
      publicRoleOnTeamProbability(observer, team, 'morgana')
    const pairInfluenceValue =
      sign * (merlinOnTeamProbability - morganaOnTeamProbability)
    const proxies = percivalProxies({
      sign,
      pairInfluenceValue,
      publicMerlinOnTeamProbability,
      publicMorganaOnTeamProbability,
      publicTeamCleanProbability: publicTeam.cleanProbability,
      publicMerlinProbabilityAtSelf,
    })
    return {
      candidate,
      probabilitySemantics: 'resolved-complete-world-sum',
      valueSemantics: 'bounded-deterministic-indices-not-probabilities',
      merlinOnTeamProbability,
      morganaOnTeamProbability,
      pairInfluenceValue,
      publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint',
      publicTeamCleanProbability: publicTeam.cleanProbability,
      publicMerlinProbabilityAtSelf,
      publicMerlinOnTeamProbability,
      publicMorganaOnTeamProbability,
      publicPairInfluenceValue: proxies.publicPairInfluenceValue,
      pairKnowledgeTellIndex: proxies.pairKnowledgeTellIndex,
      decisiveAmbiguityIndex: proxies.decisiveAmbiguityIndex,
      merlinMimicryProxyIndex: proxies.merlinMimicryProxyIndex,
      selfDecoyOpportunityProxyIndex: proxies.selfDecoyOpportunityProxyIndex,
    }
  })
}

export function roleObjectiveIdentityScope(
  role: RoleObjectiveRole,
  rolesInPlay: readonly Role[],
): IdentityProjectionScope {
  return role === 'merlin'
    ? { roleQueries: [{ roles: ['merlin'] }], hiddenTeam: true }
    : {
        roleQueries: [{
          roles: rolesInPlay.includes('morgana')
            ? ['merlin', 'morgana']
            : ['merlin'],
        }],
        hiddenTeam: false,
      }
}

export function mergeIdentityScopes(
  left: IdentityProjectionScope | undefined,
  right: IdentityProjectionScope,
): IdentityProjectionScope {
  const queries = [...(left?.roleQueries ?? []), ...right.roleQueries]
  const unique = new Map<string, { roles: readonly Role[] }>()
  for (const query of queries) {
    const roles = canonicalRoleMultiset(query.roles)
    unique.set(roles.join('|'), { roles })
  }
  return {
    roleQueries: [...unique.values()],
    hiddenTeam: (left?.hiddenTeam ?? false) || right.hiddenTeam,
  }
}

export function buildRoleObjectiveSnapshot(input: {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}): PrivateRoleObjectiveSnapshot {
  const { req, view, identity, observer, candidates } = input
  if (
    (view.role !== 'merlin' && view.role !== 'percival')
    || req.seat !== view.seat
    || candidates.length > MAX_ROLE_OBJECTIVE_ASSESSMENTS
    || !validatePrivateIdentityHostJoin(
      identity,
      view.rolesInPlay,
      identity.hiddenTeamPosterior
        ? hiddenTeamEvilMarginals(
            identity.hiddenTeamPosterior,
            view.playerCount,
          ).map((evilProbability, seat) => ({
            seat,
            goodProbability: 1 - evilProbability,
            evilProbability,
          }))
        : // The pair-only Percival scope has no alignment surface. Its cast and
          // source semantics were already validated by the identity projector.
          Array.from({ length: view.playerCount }, (_, seat) => ({
            seat,
            goodProbability: ROLE_ALIGNMENT[view.role] === 'good' && seat === view.seat
              ? 1
              : 0.5,
            evilProbability: ROLE_ALIGNMENT[view.role] === 'good' && seat === view.seat
              ? 0
              : 0.5,
          })),
    )
    || !validatePublicObserverSnapshot(observer)
    || observer.playerCount !== view.playerCount
  ) {
    throw new Error('role objective received inconsistent private sources')
  }
  const commitments = candidates
    .map((candidate) => commitmentFor(candidate, view))
    .filter(
      (candidate): candidate is CandidatePublicCommitment =>
        candidate !== undefined,
    )
  if (view.role === 'merlin') {
    const ownPosterior = identityRolePosterior(identity, ['merlin'])
    if (
      !ownPosterior
      || ownPosterior.hypotheses.some(
        (hypothesis) =>
          hypothesis.assignments.length !== 1
          || hypothesis.assignments[0]!.role !== 'merlin'
          || !isDeepStrictEqual(hypothesis.assignments[0]!.seats, [view.seat]),
      )
    ) {
      throw new Error('Merlin objective identity does not bind the viewer role')
    }
  }
  const publicRecord = projectPublicRecord(view)
  const publicTeams = assessPublicJointTeams(
    publicRecord,
    commitments.map((candidate) => candidate.team!),
  )
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  if (failsRequired !== 1 && failsRequired !== 2) {
    throw new Error('role objective requires the current quest failure threshold')
  }
  const source = {
    beliefModelVersion: identity.sourceBelief.modelVersion,
    beliefThroughSeq: identity.sourceBelief.throughSeq,
    beliefQuality: identity.sourceBelief.quality,
    playerCount: identity.sourceBelief.playerCount,
    rolesInPlay: [...identity.sourceBelief.rolesInPlay],
    identityModelVersion: JOINT_IDENTITY_MODEL_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    observerFeasibleWorldCount: observer.feasibleWorldCount,
  }
  const request: ObjectiveRequest = {
    seat: req.seat,
    kind: req.kind,
    round: req.round,
    proposalNum: req.proposalNum,
    failsRequired,
  }
  if (view.role === 'merlin') {
    return {
      version: ROLE_OBJECTIVE_MODEL_VERSION,
      team: 'good',
      role: 'merlin',
      source,
      request,
      objective: {
        role: 'merlin',
        assessments: merlinAssessments(
          identity,
          observer,
          commitments,
          view.seat,
          publicTeams,
          failsRequired,
          publicRecord,
        ),
      },
    }
  }
  const pairs = pairPosterior(identity)
  const privateCandidateSeats = [...merlinCandidatesOf(view.privateInfo)]
    .sort((left, right) => left - right)
  const pairCandidateSeats = [...new Set(pairs.hypotheses.flatMap(
    (hypothesis) => [
      hypothesis.merlinSeat,
      ...(hypothesis.morganaSeat === null ? [] : [hypothesis.morganaSeat]),
    ],
  ))].sort((left, right) => left - right)
  if (
    !canonicalSeats(privateCandidateSeats, view.playerCount)
    || !isDeepStrictEqual(privateCandidateSeats, pairCandidateSeats)
    || (
      pairs.includesMorgana
      && pairs.hypotheses.some(
        (hypothesis) =>
          !isDeepStrictEqual(
            [hypothesis.merlinSeat, hypothesis.morganaSeat!]
              .sort((left, right) => left - right),
            privateCandidateSeats,
          ),
      )
    )
    || (
      !pairs.includesMorgana
      && pairs.hypotheses.some(
        (hypothesis) =>
          !privateCandidateSeats.includes(hypothesis.merlinSeat),
      )
    )
  ) {
    throw new Error('Percival pair posterior disagrees with private candidate union')
  }
  return {
    version: ROLE_OBJECTIVE_MODEL_VERSION,
    team: 'good',
    role: 'percival',
    source,
    request,
    objective: {
      role: 'percival',
      pairPosterior: {
        probabilitySemantics: 'resolved-complete-world-sum',
        includesMorgana: pairs.includesMorgana,
        privateCandidateSeats,
        hypotheses: pairs.hypotheses,
      },
      assessments: percivalAssessments(
        pairs,
        observer,
        commitments,
        view.seat,
        publicTeams,
      ),
    },
  }
}

function validCommitment(
  value: unknown,
  source: Record<string, unknown>,
  request: Record<string, unknown>,
): value is CandidatePublicCommitment {
  if (!plainRecord(value)) return false
  const candidate = value as Record<string, unknown>
  const playerCount = source.playerCount as number
  return exactKeys(candidate, ['candidateId', 'kind', 'direction', 'team'])
    && typeof candidate.candidateId === 'string'
    && candidate.candidateId.length > 0
    && candidate.candidateId.length <= 256
    && candidate.kind === request.kind
    && isPublicCommitmentDirection(candidate.direction)
    && canonicalSeats(candidate.team, playerCount)
}

/*
 * The schema key lists bound to the interfaces they enumerate, so a field
 * renamed or added on any of these shapes turns its stale list here into a
 * compile error instead of a silently dropped exactKeys check. None of these
 * shapes has an optional field, so ExactKeyList rejects a stray or misspelled
 * key and the paired MissingKeys assertion rejects a forgotten one.
 *
 * The underscore-prefixed soundness aliases are exported only so the assertion
 * has a referenced home; nothing imports one, and deleting one as unused would
 * silently drop its check.
 */
const ROLE_OBJECTIVE_SOURCE_KEYS = [
  'beliefModelVersion',
  'beliefThroughSeq',
  'beliefQuality',
  'playerCount',
  'rolesInPlay',
  'identityModelVersion',
  'observerModelVersion',
  'observerFeasibleWorldCount',
] as const satisfies ExactKeyList<ObjectiveSource>
export type _RoleObjectiveSourceKeysSound =
  | AssertNever<MissingKeys<ObjectiveSource, typeof ROLE_OBJECTIVE_SOURCE_KEYS>>
  | AssertNever<DuplicateKeys<typeof ROLE_OBJECTIVE_SOURCE_KEYS>>

const MERLIN_ASSESSMENT_KEYS = [
  'candidate',
  'probabilitySemantics',
  'valueSemantics',
  'teamCleanProbability',
  'teamFailureCapabilityProbability',
  'evilCountDistribution',
  'influenceValue',
  'publicProbabilitySemantics',
  'publicTeamCleanProbability',
  'publicAmbiguityIndex',
  'conspicuousnessIndex',
  'assassinExposureProxyIndex',
] as const satisfies ExactKeyList<MerlinCandidateObjective>
export type _MerlinAssessmentKeysSound =
  | AssertNever<
      MissingKeys<MerlinCandidateObjective, typeof MERLIN_ASSESSMENT_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof MERLIN_ASSESSMENT_KEYS>>

const PERCIVAL_ASSESSMENT_KEYS = [
  'candidate',
  'probabilitySemantics',
  'valueSemantics',
  'merlinOnTeamProbability',
  'morganaOnTeamProbability',
  'pairInfluenceValue',
  'publicProbabilitySemantics',
  'publicTeamCleanProbability',
  'publicMerlinProbabilityAtSelf',
  'publicMerlinOnTeamProbability',
  'publicMorganaOnTeamProbability',
  'publicPairInfluenceValue',
  'pairKnowledgeTellIndex',
  'decisiveAmbiguityIndex',
  'merlinMimicryProxyIndex',
  'selfDecoyOpportunityProxyIndex',
] as const satisfies ExactKeyList<PercivalCandidateObjective>
export type _PercivalAssessmentKeysSound =
  | AssertNever<
      MissingKeys<PercivalCandidateObjective, typeof PERCIVAL_ASSESSMENT_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof PERCIVAL_ASSESSMENT_KEYS>>

const PERCIVAL_PAIR_KEYS = [
  'probabilitySemantics',
  'includesMorgana',
  'privateCandidateSeats',
  'hypotheses',
] as const satisfies ExactKeyList<PercivalRoleObjective['pairPosterior']>
export type _PercivalPairKeysSound =
  | AssertNever<
      MissingKeys<PercivalRoleObjective['pairPosterior'], typeof PERCIVAL_PAIR_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof PERCIVAL_PAIR_KEYS>>

/**
 * The Merlin per-assessment branch of the decode schema, verbatim. Reconstructs
 * the failure-capability tail and the influence value from the stored operands
 * with the shared *From helpers, keeping the exact clause set and short-circuit
 * order (each later clause still runs only once an earlier one proved its
 * field). teamSize and request are the operands the block already read inline.
 */
function validateMerlinAssessment(
  assessment: Record<string, unknown>,
  teamSize: number,
  request: Record<string, unknown>,
): boolean {
  return !(
    !exactKeys(assessment, MERLIN_ASSESSMENT_KEYS)
    || assessment.probabilitySemantics !== 'resolved-complete-world-sum'
    || assessment.valueSemantics
      !== 'bounded-deterministic-indices-not-probabilities'
    || !probability(assessment.teamCleanProbability)
    || !probability(assessment.teamFailureCapabilityProbability)
    || !validCountDistribution(assessment.evilCountDistribution, teamSize)
    || Math.abs(
      (assessment.evilCountDistribution as number[])[0]!
        - (assessment.teamCleanProbability as number),
    ) > PROBABILITY_TOLERANCE
    || Math.abs(
      questFailureCapabilityProbability(
        assessment.evilCountDistribution as number[],
        request.failsRequired as number,
      )
        - (assessment.teamFailureCapabilityProbability as number),
    ) > PROBABILITY_TOLERANCE
    || !boundedIndex(assessment.influenceValue)
    || Math.abs(
      influenceValueFrom(
        directionSign(
          (assessment.candidate as CandidatePublicCommitment).direction,
        ),
        assessment.teamCleanProbability as number,
        assessment.teamFailureCapabilityProbability as number,
      )
        - (assessment.influenceValue as number),
    ) > PROBABILITY_TOLERANCE
    || assessment.publicProbabilitySemantics
      !== 'public-preaction-uniform-feasible-joint'
    || !probability(assessment.publicTeamCleanProbability)
    || !probability(assessment.publicAmbiguityIndex)
    || !probability(assessment.conspicuousnessIndex)
    || !probability(assessment.assassinExposureProxyIndex)
  )
}

/**
 * The Percival per-assessment branch of the decode schema, verbatim. The proxy
 * chain those fields must satisfy is cross-checked later against the pair
 * posterior; this branch pins the shape and per-field probability/index bounds
 * in the original clause set and short-circuit order.
 */
function validatePercivalAssessment(
  assessment: Record<string, unknown>,
): boolean {
  return !(
    !exactKeys(assessment, PERCIVAL_ASSESSMENT_KEYS)
    || assessment.probabilitySemantics !== 'resolved-complete-world-sum'
    || assessment.valueSemantics
      !== 'bounded-deterministic-indices-not-probabilities'
    || !probability(assessment.merlinOnTeamProbability)
    || !probability(assessment.morganaOnTeamProbability)
    || !boundedIndex(assessment.pairInfluenceValue)
    || assessment.publicProbabilitySemantics
      !== 'public-preaction-uniform-feasible-joint'
    || !probability(assessment.publicTeamCleanProbability)
    || !probability(assessment.publicMerlinProbabilityAtSelf)
    || !probability(assessment.publicMerlinOnTeamProbability)
    || !probability(assessment.publicMorganaOnTeamProbability)
    || !boundedIndex(assessment.publicPairInfluenceValue)
    || !probability(assessment.pairKnowledgeTellIndex)
    || !probability(assessment.decisiveAmbiguityIndex)
    || !probability(assessment.merlinMimicryProxyIndex)
    || !probability(assessment.selfDecoyOpportunityProxyIndex)
  )
}

function roleObjectiveSchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  const snapshot = detached as Record<string, unknown>
  const source = snapshot.source as Record<string, unknown>
  const request = snapshot.request as Record<string, unknown>
  const objective = snapshot.objective as Record<string, unknown>
  if (
    !exactKeys(snapshot, [
      'version',
      'team',
      'role',
      'source',
      'request',
      'objective',
    ])
    || snapshot.version !== ROLE_OBJECTIVE_MODEL_VERSION
    || snapshot.team !== 'good'
    || !['merlin', 'percival'].includes(snapshot.role as string)
    || !plainRecord(source)
    || !exactKeys(source, ROLE_OBJECTIVE_SOURCE_KEYS)
    || typeof source.beliefModelVersion !== 'string'
    || source.beliefModelVersion.length === 0
    || source.beliefModelVersion.length > 200
    || !Number.isSafeInteger(source.beliefThroughSeq)
    || (source.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      source.beliefQuality as string,
    )
    || !tableSize(source.playerCount)
    || !canonicalRoles(source.rolesInPlay, source.playerCount as number)
    || roleCount(source.rolesInPlay as Role[], snapshot.role as Role) !== 1
    || source.identityModelVersion !== JOINT_IDENTITY_MODEL_VERSION
    || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !Number.isSafeInteger(source.observerFeasibleWorldCount)
    || (source.observerFeasibleWorldCount as number) <= 0
    || !canonicalRequestBlock(request, {
      playerCount: source.playerCount as number,
      kinds: DECISION_KINDS,
    })
    || !plainRecord(objective)
    || objective.role !== snapshot.role
    || !denseArray(objective.assessments)
    || objective.assessments.length > MAX_ROLE_OBJECTIVE_ASSESSMENTS
  ) return false

  const candidateIds = new Set<string>()
  for (const raw of objective.assessments) {
    if (!plainRecord(raw)) return false
    const assessment = raw as Record<string, unknown>
    const candidate = assessment.candidate as Record<string, unknown>
    if (
      !validCommitment(candidate, source, request)
      || candidateIds.has(candidate.candidateId as string)
    ) return false
    candidateIds.add(candidate.candidateId as string)
    const teamSize = (candidate.team as Seat[]).length
    if (snapshot.role === 'merlin') {
      if (
        !validateMerlinAssessment(assessment, teamSize, request)
      ) return false
    } else if (!validatePercivalAssessment(assessment)) return false
  }

  if (snapshot.role === 'merlin') {
    return exactKeys(objective, ['role', 'assessments'])
  }
  const pair = objective.pairPosterior as Record<string, unknown>
  if (
    !exactKeys(objective, ['role', 'pairPosterior', 'assessments'])
    || !plainRecord(pair)
    || !exactKeys(pair, PERCIVAL_PAIR_KEYS)
    || pair.probabilitySemantics !== 'resolved-complete-world-sum'
    || typeof pair.includesMorgana !== 'boolean'
    || pair.includesMorgana !== (source.rolesInPlay as Role[]).includes('morgana')
    || !canonicalSeats(pair.privateCandidateSeats, source.playerCount as number)
    || !denseArray(pair.hypotheses)
    || pair.hypotheses.length === 0
    || pair.hypotheses.length > 90
  ) return false
  let total = 0
  let priorKey = ''
  const hypotheses = pair.hypotheses as unknown[]
  for (const raw of hypotheses) {
    if (!plainRecord(raw)) return false
    const hypothesis = raw as Record<string, unknown>
    if (
      !exactKeys(hypothesis, ['merlinSeat', 'morganaSeat', 'probability'])
      || !Number.isSafeInteger(hypothesis.merlinSeat)
      || (hypothesis.merlinSeat as number) < 0
      || (hypothesis.merlinSeat as number) >= (source.playerCount as number)
      || (
        pair.includesMorgana
          ? (
              !Number.isSafeInteger(hypothesis.morganaSeat)
              || (hypothesis.morganaSeat as number) < 0
              || (hypothesis.morganaSeat as number)
                >= (source.playerCount as number)
              || hypothesis.morganaSeat === hypothesis.merlinSeat
            )
          : hypothesis.morganaSeat !== null
      )
      || !probability(hypothesis.probability)
      || hypothesis.probability === 0
    ) return false
    const key = `${hypothesis.merlinSeat}:${hypothesis.morganaSeat ?? -1}`
    if (priorKey && priorKey >= key) return false
    priorKey = key
    total += hypothesis.probability as number
  }
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) return false
  const pairCandidateSeats = [...new Set(
    (hypotheses as MerlinMorganaPairHypothesis[]).flatMap(
      (hypothesis) => [
        hypothesis.merlinSeat,
        ...(hypothesis.morganaSeat === null ? [] : [hypothesis.morganaSeat]),
      ],
    ),
  )].sort((left, right) => left - right)
  if (!isDeepStrictEqual(pair.privateCandidateSeats, pairCandidateSeats)) {
    return false
  }
  if (
    pair.includesMorgana
    && (hypotheses as MerlinMorganaPairHypothesis[]).some(
      (hypothesis) =>
        !isDeepStrictEqual(
          [hypothesis.merlinSeat, hypothesis.morganaSeat!]
            .sort((left, right) => left - right),
          pair.privateCandidateSeats,
        ),
    )
  ) return false

  const typedHypotheses = hypotheses as MerlinMorganaPairHypothesis[]
  for (const raw of objective.assessments as unknown[]) {
    const assessment = raw as PercivalCandidateObjective
    const team = assessment.candidate.team ?? []
    const merlin = typedHypotheses.reduce(
      (sum, hypothesis) =>
        sum + (team.includes(hypothesis.merlinSeat)
          ? hypothesis.probability
          : 0),
      0,
    )
    const morgana = typedHypotheses.reduce(
      (sum, hypothesis) =>
        sum + (
          hypothesis.morganaSeat !== null
          && team.includes(hypothesis.morganaSeat)
            ? hypothesis.probability
            : 0
        ),
      0,
    )
    if (
      Math.abs(merlin - assessment.merlinOnTeamProbability)
        > PROBABILITY_TOLERANCE
      || Math.abs(morgana - assessment.morganaOnTeamProbability)
        > PROBABILITY_TOLERANCE
      || Math.abs(
        directionSign(assessment.candidate.direction) * (merlin - morgana)
          - assessment.pairInfluenceValue,
      ) > PROBABILITY_TOLERANCE
    ) return false
    const sign = directionSign(assessment.candidate.direction)
    const proxies = percivalProxies({
      sign,
      pairInfluenceValue: assessment.pairInfluenceValue,
      publicMerlinOnTeamProbability: assessment.publicMerlinOnTeamProbability,
      publicMorganaOnTeamProbability: assessment.publicMorganaOnTeamProbability,
      publicTeamCleanProbability: assessment.publicTeamCleanProbability,
      publicMerlinProbabilityAtSelf: assessment.publicMerlinProbabilityAtSelf,
    })
    if (
      Math.abs(
        proxies.publicPairInfluenceValue
          - assessment.publicPairInfluenceValue,
      ) > PROBABILITY_TOLERANCE
      || Math.abs(
        proxies.pairKnowledgeTellIndex - assessment.pairKnowledgeTellIndex,
      ) > PROBABILITY_TOLERANCE
      || Math.abs(
        proxies.decisiveAmbiguityIndex - assessment.decisiveAmbiguityIndex,
      ) > PROBABILITY_TOLERANCE
      || Math.abs(
        proxies.merlinMimicryProxyIndex - assessment.merlinMimicryProxyIndex,
      ) > PROBABILITY_TOLERANCE
      || Math.abs(
        proxies.selfDecoyOpportunityProxyIndex
          - assessment.selfDecoyOpportunityProxyIndex,
      ) > PROBABILITY_TOLERANCE
    ) return false
  }
  return true
}

const roleObjectiveCodec =
  projectionCodec<PrivateRoleObjectiveSnapshot>(roleObjectiveSchema)

export const validatePrivateRoleObjectiveSnapshot = roleObjectiveCodec.validate
export const decodeCanonicalPrivateRoleObjectiveSnapshot =
  roleObjectiveCodec.decode

interface RoleObjectiveHostJoinInput {
  req: DecisionRequest
  view: PlayerView
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
  candidates: readonly PolicyCandidate[]
}

/**
 * The host must observe the record itself rather than trust the observer it
 * was handed, so a non-authoritative observer rejects the join. Throwing is
 * how that reaches the shared rebuild-and-compare rule as a rejection.
 */
export const validateAdmittedPrivateRoleObjectiveHostJoin = exactHostJoin(
  (input: RoleObjectiveHostJoinInput) => {
    const authoritativeObserver = observePublicRecord(
      projectPublicRecord(input.view),
    )
    if (!isDeepStrictEqual(input.observer, authoritativeObserver)) {
      throw new Error('role objective observer is not authoritative')
    }
    return buildRoleObjectiveSnapshot({
      ...input,
      observer: authoritativeObserver,
    })
  },
)

export function validatePrivateRoleObjectiveHostJoin(
  value: unknown,
  input: RoleObjectiveHostJoinInput,
): value is PrivateRoleObjectiveSnapshot {
  return validatePrivateRoleObjectiveSnapshot(value)
    && validateAdmittedPrivateRoleObjectiveHostJoin(value, input)
}
