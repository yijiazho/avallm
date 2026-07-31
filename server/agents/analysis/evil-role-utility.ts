import type {
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { MAX_PROPOSALS } from '../../engine/rules.ts'
import type { PolicyCandidate } from '../candidate/types.ts'
import { compareCandidateIds } from '../candidate/candidates.ts'
import { JOINT_IDENTITY_MODEL_VERSION } from '../belief/identity.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './observer-types.ts'
import { validatePrivateEvilRoleObjectiveSnapshot } from './evil-objectives.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type EvilCandidateObjective,
  type EvilObjectiveRole,
  type EvilRolePosture,
  type PrivateEvilRoleObjectiveSnapshot,
  isEvilObjectiveRole,
} from './evil-objective-types.ts'
import {
  canonicalRequestBlock,
  canonicalSeats,
  exactKeys,
  LEGAL_TEAM_CANDIDATE_BOUND,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  clampProbability as clamp01,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'

export const EVIL_ROLE_UTILITY_PROJECTION_VERSION =
  'evil-oberon-role-utility-v1'
export const EVIL_ROLE_UTILITY_DEGRADATION =
  'evil-role-utility-projection-failed'
export const EVIL_ROLE_UTILITY_VALUE_SEMANTICS =
  'bounded-deterministic-heuristic-utility-not-probability'

/**
 * Failure capacity is intentionally dominant. The other terms can affect
 * close choices without turning public cover into a substitute for the
 * mechanical objective.
 */
export const EVIL_ROLE_UTILITY_CONSTANTS = Object.freeze({
  failureCapacityWeight: 0.70,
  publicCoverWeight: 0.20,
  futureOpportunityWeight: 0.10,
  alternativeRealizationBase: 0.72,
  alternativeRealizationPerRejection: 0.07,
})

export interface EvilRoleUtilityAssessment {
  candidateId: string
  kind: 'propose' | 'vote'
  role: EvilObjectiveRole
  posture: EvilRolePosture
  direction: 'support' | 'oppose'
  team: readonly Seat[]
  valueSemantics: typeof EVIL_ROLE_UTILITY_VALUE_SEMANTICS
  probabilitySemantics: 'resolved-complete-world-sum'
  teamFailureCapabilityProbability: number
  publicProbabilitySemantics:
    'public-preaction-uniform-feasible-joint'
  publicTeamFailureCapabilityProbability: number
  bestAlternativeCandidateId?: string
  bestAlternativeTeam?: readonly Seat[]
  bestAlternativeFailureCapabilityProbability?: number
  alternativeRealization: number
  failureCapacityValue: number
  publicActionPlausibilityValue: number
  participantCoverProxyIndex: number
  participantCoverAvailable: boolean
  publicCoverValue: number
  publicCoverAvailable: boolean
  publicCoverSemantics:
    'bounded-action-plausibility-plus-participant-cover-proxy'
  futureOpportunityValue: number
  futureOpportunityAvailable: boolean
  futureOpportunitySemantics:
    'bounded-reserve-or-runway-proxy-not-win-probability'
  futureOpportunitySource:
    | {
        kind: 'visible-coordination-reserve'
        reservedVisibleEvil: number
        totalVisibleEvil: number
      }
    | {
        kind: 'oberon-unseen-placement-reserve'
        unseenEvilOnTeamProbability: number
      }
    | {
        kind: 'rejection-runway'
        rejectionsBeforeHammer: number
        runwayDenominator: 4
      }
    | {
        kind: 'terminal-none'
      }
    | {
        kind: 'decisive-board-none'
      }
  failureCapacityContribution: number
  publicCoverContribution: number
  futureOpportunityContribution: number
  roleValue: number
  coordination:
    | {
        kind: 'visible-coordination'
        coordinatedEvilAboard: number
        totalVisibleEvil: number
      }
    | {
        kind: 'self-only-uncoordinated'
        selfAboard: boolean
        unseenEvilOnTeamProbability: number
      }
}

export interface PrivateEvilRoleUtilityProjection {
  version: typeof EVIL_ROLE_UTILITY_PROJECTION_VERSION
  role: EvilObjectiveRole
  source: {
    roleObjectiveVersion: typeof EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    identityModelVersion: string
    observerModelVersion: string
    beliefModelVersion: string
    beliefThroughSeq: number
    playerCount: number
  }
  request: {
    seat: Seat
    kind: 'propose' | 'vote'
    round: number
    proposalNum: number
    failsRequired: number
    completedGoodQuests: number
    completedEvilQuests: number
  }
  assessments: readonly EvilRoleUtilityAssessment[]
}

const POSTURE_BY_ROLE: Readonly<Record<EvilObjectiveRole, EvilRolePosture>> =
  Object.freeze({
    assassin: 'assassin-shot-preservation',
    morgana: 'morgana-counterfeit-cover',
    mordred: 'mordred-deep-cover',
    minion: 'minion-failure-banking',
    oberon: 'oberon-uncoordinated-disruption',
  })

/**
 * The per-candidate scalar derivations that both the builder and the schema
 * recompute, extracted once so a weight can never drift between the two sites.
 *
 * Each helper takes exactly the operands its caller already holds: the builder
 * passes freshly derived values, the schema passes the stored ones. This keeps
 * the schema validating the stored intermediates (stored plausibility feeds
 * publicCoverValue, stored contributions feed roleValue) rather than internally
 * recomputed ones, so no comparison target moves and no tolerance boundary can
 * flip. roleValueSumFrom returns the raw contribution sum, exactly what the
 * schema has always compared against; the builder clamps that sum at its own
 * call site (the stored roleValue is a probability), so build and schema keep
 * their original clamp-vs-raw asymmetry and neither comparison target moves.
 */
function publicActionPlausibilityFrom(
  support: boolean,
  publicTeamFailureCapabilityProbability: number,
): number {
  return support
    ? 1 - publicTeamFailureCapabilityProbability
    : publicTeamFailureCapabilityProbability
}

function publicCoverValueFrom(
  publicActionPlausibility: number,
  participantCoverProxyIndex: number,
): number {
  return 0.5 * publicActionPlausibility + 0.5 * participantCoverProxyIndex
}

function failureCapacityContributionFrom(failureCapacityValue: number): number {
  return EVIL_ROLE_UTILITY_CONSTANTS.failureCapacityWeight
    * failureCapacityValue
}

function publicCoverContributionFrom(publicCoverValue: number): number {
  return EVIL_ROLE_UTILITY_CONSTANTS.publicCoverWeight * publicCoverValue
}

function futureOpportunityContributionFrom(
  futureOpportunityValue: number,
): number {
  return EVIL_ROLE_UTILITY_CONSTANTS.futureOpportunityWeight
    * futureOpportunityValue
}

function roleValueSumFrom(
  failureCapacityContribution: number,
  publicCoverContribution: number,
  futureOpportunityContribution: number,
): number {
  return failureCapacityContribution
    + publicCoverContribution
    + futureOpportunityContribution
}

function alternativeRealizationFrom(rejectionsBeforeHammer: number): number {
  return Math.min(
    1,
    EVIL_ROLE_UTILITY_CONSTANTS.alternativeRealizationBase
      + EVIL_ROLE_UTILITY_CONSTANTS.alternativeRealizationPerRejection
        * rejectionsBeforeHammer,
  )
}

function teamProxyValue(
  objective: PrivateEvilRoleObjectiveSnapshot,
  team: readonly Seat[],
  key: 'coverProxyIndex' | 'standingProxyIndex',
): { value: number; available: boolean } {
  if (!team.length) return { value: 0.5, available: false }
  let available = true
  const value = team.reduce((sum, seat) => {
    const standing = objective.publicStanding[seat]
    if (!standing) {
      throw new Error('evil role utility lacks public standing for team seat')
    }
    // Missing behavioral observations are neutral. Public exact evil
    // probability remains available and is never silently treated as proof of
    // innocence.
    return sum + (
      standing[key] === null
        ? 0.5
        : standing[key]
    )
  }, 0) / team.length
  for (const seat of team) {
    if (objective.publicStanding[seat]?.[key] === null) available = false
  }
  return { value, available }
}

function participantCover(
  objective: PrivateEvilRoleObjectiveSnapshot,
  team: readonly Seat[],
): { value: number; available: boolean } {
  const participants = objective.coordination.kind === 'visible-partners'
    ? objective.coordination.seats.filter((seat) => team.includes(seat))
    : team.includes(objective.coordination.self)
      ? [objective.coordination.self]
      : []
  if (!participants.length) return { value: 0.5, available: false }
  return teamProxyValue(objective, participants, 'coverProxyIndex')
}

function objectiveMap(
  objective: PrivateEvilRoleObjectiveSnapshot,
): ReadonlyMap<string, EvilCandidateObjective> {
  const mapped = new Map<string, EvilCandidateObjective>()
  for (const assessment of objective.assessments) {
    if (mapped.has(assessment.candidateId)) {
      throw new Error('evil role utility received duplicate objective candidates')
    }
    mapped.set(assessment.candidateId, assessment)
  }
  return mapped
}

function candidateTeam(
  req: DecisionRequest,
  view: PlayerView,
  candidate: PolicyCandidate,
): readonly Seat[] {
  if (candidate.kind !== req.kind) {
    throw new Error('evil role utility received a mixed candidate surface')
  }
  if (candidate.decision.kind === 'propose') return candidate.decision.team
  if (candidate.decision.kind === 'vote' && view.currentTeam) {
    return view.currentTeam
  }
  throw new Error('evil role utility candidate lacks a team')
}

interface EvilRoleUtilityProjectionInput {
  req: DecisionRequest
  view: PlayerView
  objective: PrivateEvilRoleObjectiveSnapshot
  candidates: readonly PolicyCandidate[]
  alternativeObjective?: PrivateEvilRoleObjectiveSnapshot
}

/**
 * Build one candidate's utility assessment. This is the per-candidate map body
 * of buildEvilRoleUtilityProjectionInternal, extracted verbatim; it takes
 * exactly the operands the closure read, so the produced object is identical
 * field for field (host-join reconstruction still compares byte for byte).
 */
function buildAssessment(args: {
  candidate: PolicyCandidate
  req: DecisionRequest
  view: PlayerView
  objective: PrivateEvilRoleObjectiveSnapshot
  objectives: ReadonlyMap<string, EvilCandidateObjective>
  bestAlternative: EvilCandidateObjective | undefined
  alternativeRealization: number
  requestKind: 'propose' | 'vote'
}): EvilRoleUtilityAssessment {
  const {
    candidate,
    req,
    view,
    objective,
    objectives,
    bestAlternative,
    alternativeRealization,
    requestKind,
  } = args
  const source = objectives.get(candidate.id)
  const team = [...candidateTeam(req, view, candidate)]
    .sort((left, right) => left - right)
  if (
    !source
    || source.kind !== req.kind
    || source.team.length !== team.length
    || source.team.some((seat, index) => seat !== team[index])
  ) {
    throw new Error(`evil role utility objective join mismatch for ${candidate.id}`)
  }
  const support = source.direction === 'support'
  const failureCapacityValue = support
    ? source.teamFailureCapabilityProbability
    : bestAlternative!.teamFailureCapabilityProbability
      * alternativeRealization
  const participant = participantCover(objective, team)
  const publicActionPlausibility = publicActionPlausibilityFrom(
    support,
    source.publicTeamFailureCapabilityProbability,
  )
  const publicCoverValue = publicCoverValueFrom(
    publicActionPlausibility,
    participant.value,
  )
  const completedGood = view.quests.filter(
    (quest) => quest.status === 'complete' && quest.result === 'success',
  ).length
  const completedEvil = view.quests.filter(
    (quest) => quest.status === 'complete' && quest.result === 'fail',
  ).length
  const futureQuestsRemain = view.round < view.quests.length
  const decisiveBoard = completedGood >= 2 || completedEvil >= 2
  let futureOpportunityValue = 0
  let futureOpportunityAvailable = false
  let futureOpportunitySource:
    EvilRoleUtilityAssessment['futureOpportunitySource'] = {
      kind: 'terminal-none',
    }
  if (futureQuestsRemain && !decisiveBoard) {
    if (!support) {
      const rejectionsBeforeHammer =
        Math.max(0, MAX_PROPOSALS - view.proposalNum)
      futureOpportunityValue =
        rejectionsBeforeHammer / 4
      futureOpportunityAvailable = true
      futureOpportunitySource = {
        kind: 'rejection-runway',
        rejectionsBeforeHammer,
        runwayDenominator: 4,
      }
    } else if (source.coordination.kind === 'visible-coordination') {
      const totalVisible = objective.coordination.kind === 'visible-partners'
        ? objective.coordination.seats.length
        : 0
      const reservedVisibleEvil =
        totalVisible - source.coordination.coordinatedEvilAboard
      futureOpportunityValue = totalVisible
        ? reservedVisibleEvil / totalVisible
        : 0
      futureOpportunityAvailable = totalVisible > 0
      futureOpportunitySource = {
        kind: 'visible-coordination-reserve',
        reservedVisibleEvil,
        totalVisibleEvil: totalVisible,
      }
    } else {
      const unseenEvilOnTeamProbability =
        source.unseenEvilOnTeamProbability ?? 0
      futureOpportunityValue =
        1 - unseenEvilOnTeamProbability
      futureOpportunityAvailable =
        source.unseenEvilOnTeamProbability !== undefined
      futureOpportunitySource = {
        kind: 'oberon-unseen-placement-reserve',
        unseenEvilOnTeamProbability,
      }
    }
  } else if (futureQuestsRemain && decisiveBoard) {
    futureOpportunitySource = { kind: 'decisive-board-none' }
  }
  const failureCapacityContribution =
    failureCapacityContributionFrom(failureCapacityValue)
  const publicCoverContribution =
    publicCoverContributionFrom(publicCoverValue)
  const futureOpportunityContribution =
    futureOpportunityContributionFrom(futureOpportunityValue)
  const roleValue = clamp01(roleValueSumFrom(
    failureCapacityContribution,
    publicCoverContribution,
    futureOpportunityContribution,
  ))
  return {
    candidateId: candidate.id,
    kind: requestKind,
    role: objective.role,
    posture: objective.posture.kind,
    direction: source.direction,
    team,
    valueSemantics: EVIL_ROLE_UTILITY_VALUE_SEMANTICS,
    probabilitySemantics: source.probabilitySemantics,
    teamFailureCapabilityProbability:
      source.teamFailureCapabilityProbability,
    publicProbabilitySemantics: source.publicProbabilitySemantics,
    publicTeamFailureCapabilityProbability:
      source.publicTeamFailureCapabilityProbability,
    ...(support || !bestAlternative
      ? {}
      : {
          bestAlternativeCandidateId: bestAlternative.candidateId,
          bestAlternativeTeam: [...bestAlternative.team],
          bestAlternativeFailureCapabilityProbability:
            bestAlternative.teamFailureCapabilityProbability,
        }),
    alternativeRealization: support ? 1 : alternativeRealization,
    failureCapacityValue,
    publicActionPlausibilityValue: publicActionPlausibility,
    participantCoverProxyIndex: participant.value,
    participantCoverAvailable: participant.available,
    publicCoverValue,
    publicCoverAvailable: participant.available,
    publicCoverSemantics:
      'bounded-action-plausibility-plus-participant-cover-proxy',
    futureOpportunityValue,
    futureOpportunityAvailable,
    futureOpportunitySemantics:
      'bounded-reserve-or-runway-proxy-not-win-probability',
    futureOpportunitySource,
    failureCapacityContribution,
    publicCoverContribution,
    futureOpportunityContribution,
    roleValue,
    coordination: source.coordination.kind === 'visible-coordination'
      ? {
          kind: 'visible-coordination',
          coordinatedEvilAboard:
            source.coordination.coordinatedEvilAboard,
          totalVisibleEvil:
            objective.coordination.kind === 'visible-partners'
              ? objective.coordination.seats.length
              : 0,
        }
      : {
          kind: 'self-only-uncoordinated',
          selfAboard: source.coordination.selfAboard,
          unseenEvilOnTeamProbability:
            source.unseenEvilOnTeamProbability ?? 0,
        },
  }
}

function buildEvilRoleUtilityProjectionInternal(
  input: EvilRoleUtilityProjectionInput,
  admittedObjective: boolean,
): PrivateEvilRoleUtilityProjection {
  const { req, view, objective, candidates, alternativeObjective } = input
  if (
    (req.kind !== 'propose' && req.kind !== 'vote')
    || view.alignment !== 'evil'
    || objective.role !== view.role
    || (!admittedObjective
      && !validatePrivateEvilRoleObjectiveSnapshot(objective))
    || objective.assessmentApplicability !== 'team-candidates'
    || req.seat !== view.seat
    || candidates.length === 0
    || candidates.length > LEGAL_TEAM_CANDIDATE_BOUND
  ) {
    throw new Error('evil role utility is inapplicable or has invalid sources')
  }
  const requestKind: 'propose' | 'vote' = req.kind
  const objectives = objectiveMap(objective)
  if (objectives.size !== candidates.length) {
    throw new Error('evil role utility requires the complete candidate surface')
  }
  const currentTeam = view.currentTeam
    ? [...view.currentTeam].sort((left, right) => left - right)
    : undefined
  const alternatives = alternativeObjective
    ? [...alternativeObjective.assessments]
        .filter((assessment) =>
          !currentTeam
          || assessment.team.length !== currentTeam.length
          || assessment.team.some(
            (seat, index) => seat !== currentTeam[index],
          ))
        .sort((left, right) =>
          right.teamFailureCapabilityProbability
            - left.teamFailureCapabilityProbability
          || compareCandidateIds(left.candidateId, right.candidateId))
    : []
  const bestAlternative = alternatives[0]
  if (
    req.kind === 'vote'
    && (
      !alternativeObjective
      || alternativeObjective.role !== objective.role
      || alternativeObjective.request.kind !== 'propose'
      || !bestAlternative
    )
  ) {
    throw new Error(
      'evil vote utility requires a complete D1 alternative surface',
    )
  }
  const alternativeRealization = req.kind === 'vote'
    ? alternativeRealizationFrom(Math.max(0, MAX_PROPOSALS - view.proposalNum))
    : 1
  const assessments = candidates.map(
    (candidate): EvilRoleUtilityAssessment =>
      buildAssessment({
        candidate,
        req,
        view,
        objective,
        objectives,
        bestAlternative,
        alternativeRealization,
        requestKind,
      }),
  )
  const projection: PrivateEvilRoleUtilityProjection = {
    version: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
    role: objective.role,
    source: {
      roleObjectiveVersion: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
      identityModelVersion: objective.source.identityModelVersion,
      observerModelVersion: objective.source.observerModelVersion,
      beliefModelVersion: objective.source.beliefModelVersion,
      beliefThroughSeq: objective.source.beliefThroughSeq,
      playerCount: objective.source.playerCount,
    },
    request: {
      seat: req.seat,
      kind: req.kind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired: objective.request.failsRequired,
      completedGoodQuests: view.quests.filter(
        (quest) => quest.status === 'complete' && quest.result === 'success',
      ).length,
      completedEvilQuests: view.quests.filter(
        (quest) => quest.status === 'complete' && quest.result === 'fail',
      ).length,
    },
    assessments,
  }
  return projection
}

export function buildEvilRoleUtilityProjection(
  input: EvilRoleUtilityProjectionInput,
): PrivateEvilRoleUtilityProjection {
  return buildEvilRoleUtilityProjectionInternal(input, false)
}

/** Build from an objective dependency already admitted by the kernel. */
export function buildAdmittedEvilRoleUtilityProjection(
  input: EvilRoleUtilityProjectionInput,
): PrivateEvilRoleUtilityProjection {
  return buildEvilRoleUtilityProjectionInternal(input, true)
}

/**
 * Per-assessment scalar formulas: role/kind/direction shape plus every stored
 * intermediate reconstructed from the same *From helpers the builder used.
 * Verbatim tail of the original per-assessment guard (the `values` finiteness
 * sweep included), so the exact clause set and short-circuit order are kept.
 */
function validateAssessmentFormulas(
  assessment: EvilRoleUtilityAssessment,
  projection: PrivateEvilRoleUtilityProjection,
  alternativeKeys: readonly string[],
): boolean {
  const values = [
    assessment.teamFailureCapabilityProbability,
    assessment.publicTeamFailureCapabilityProbability,
    assessment.alternativeRealization,
    assessment.failureCapacityValue,
    assessment.publicActionPlausibilityValue,
    assessment.participantCoverProxyIndex,
    assessment.publicCoverValue,
    assessment.futureOpportunityValue,
    assessment.failureCapacityContribution,
    assessment.publicCoverContribution,
    assessment.futureOpportunityContribution,
    assessment.roleValue,
  ]
  return !(
    assessment.role !== projection.role
    || typeof assessment.candidateId !== 'string'
    || !assessment.candidateId.length
    || assessment.candidateId.length > 256
    || assessment.kind !== projection.request.kind
    || assessment.posture !== POSTURE_BY_ROLE[projection.role]
    || !['support', 'oppose'].includes(assessment.direction)
    || !canonicalSeats(
      assessment.team,
      projection.source.playerCount,
    )
    || assessment.valueSemantics !== EVIL_ROLE_UTILITY_VALUE_SEMANTICS
    || assessment.probabilitySemantics
      !== 'resolved-complete-world-sum'
    || assessment.publicProbabilitySemantics
      !== 'public-preaction-uniform-feasible-joint'
    || typeof assessment.publicCoverAvailable !== 'boolean'
    || typeof assessment.participantCoverAvailable !== 'boolean'
    || assessment.publicCoverAvailable
      !== assessment.participantCoverAvailable
    || assessment.publicCoverSemantics
      !== 'bounded-action-plausibility-plus-participant-cover-proxy'
    || typeof assessment.futureOpportunityAvailable !== 'boolean'
    || assessment.futureOpportunitySemantics
      !== 'bounded-reserve-or-runway-proxy-not-win-probability'
    || Math.abs(
      assessment.publicCoverValue
        - publicCoverValueFrom(
          assessment.publicActionPlausibilityValue,
          assessment.participantCoverProxyIndex,
        ),
    ) > PROBABILITY_TOLERANCE
    || Math.abs(
      assessment.publicActionPlausibilityValue
        - publicActionPlausibilityFrom(
          assessment.direction === 'support',
          assessment.publicTeamFailureCapabilityProbability,
        ),
    ) > PROBABILITY_TOLERANCE
    || (
      assessment.direction === 'support'
        ? (
            alternativeKeys.length !== 0
            || assessment.alternativeRealization !== 1
            || Math.abs(
              assessment.failureCapacityValue
                - assessment.teamFailureCapabilityProbability,
            ) > PROBABILITY_TOLERANCE
          )
        : (
            alternativeKeys.length !== 3
            || typeof assessment.bestAlternativeCandidateId !== 'string'
            || !assessment.bestAlternativeCandidateId.length
            || assessment.bestAlternativeCandidateId.length > 256
            || !canonicalSeats(
              assessment.bestAlternativeTeam,
              projection.source.playerCount,
            )
            || !Number.isFinite(
              assessment.bestAlternativeFailureCapabilityProbability,
            )
            || assessment.bestAlternativeFailureCapabilityProbability! < 0
            || assessment.bestAlternativeFailureCapabilityProbability! > 1
            || Math.abs(
              assessment.failureCapacityValue
                - assessment
                  .bestAlternativeFailureCapabilityProbability!
                  * assessment.alternativeRealization,
            ) > PROBABILITY_TOLERANCE
          )
    )
    || values.some(
      (entry) =>
        !Number.isFinite(entry) || entry < 0 || entry > 1,
    )
    || Math.abs(
      assessment.failureCapacityContribution
        - failureCapacityContributionFrom(assessment.failureCapacityValue),
    ) > PROBABILITY_TOLERANCE
    || Math.abs(
      assessment.publicCoverContribution
        - publicCoverContributionFrom(assessment.publicCoverValue),
    ) > PROBABILITY_TOLERANCE
    || Math.abs(
      assessment.futureOpportunityContribution
        - futureOpportunityContributionFrom(
          assessment.futureOpportunityValue,
        ),
    ) > PROBABILITY_TOLERANCE
    || Math.abs(
      assessment.roleValue
        - roleValueSumFrom(
          assessment.failureCapacityContribution,
          assessment.publicCoverContribution,
          assessment.futureOpportunityContribution,
        ),
    ) > PROBABILITY_TOLERANCE
  )
}

/**
 * futureOpportunitySource shape and its value reconstruction. The original was
 * a five-deep nested ternary with a fail-closed `: true` tail; rewritten as a
 * switch over the discriminant with an explicit `default: return false`, which
 * is the same fail-closed behavior for an unknown kind. Per-kind clause sets
 * and short-circuit order are unchanged.
 */
function validateFutureOpportunitySource(
  assessment: EvilRoleUtilityAssessment,
): boolean {
  const source = assessment.futureOpportunitySource
  if (!source || typeof source !== 'object') return false
  switch (source.kind) {
    case 'visible-coordination-reserve':
      return !(
        !exactKeys(source, [
          'kind', 'reservedVisibleEvil', 'totalVisibleEvil',
        ])
        || !Number.isSafeInteger(source.reservedVisibleEvil)
        || !Number.isSafeInteger(source.totalVisibleEvil)
        || source.totalVisibleEvil <= 0
        || source.reservedVisibleEvil < 0
        || source.reservedVisibleEvil > source.totalVisibleEvil
        || Math.abs(
          assessment.futureOpportunityValue
            - source.reservedVisibleEvil / source.totalVisibleEvil,
        ) > PROBABILITY_TOLERANCE
      )
    case 'oberon-unseen-placement-reserve':
      return !(
        !exactKeys(source, [
          'kind', 'unseenEvilOnTeamProbability',
        ])
        || !Number.isFinite(source.unseenEvilOnTeamProbability)
        || source.unseenEvilOnTeamProbability < 0
        || source.unseenEvilOnTeamProbability > 1
        || Math.abs(
          assessment.futureOpportunityValue
            - (1 - source.unseenEvilOnTeamProbability),
        ) > PROBABILITY_TOLERANCE
      )
    case 'rejection-runway':
      return !(
        !exactKeys(source, [
          'kind', 'rejectionsBeforeHammer', 'runwayDenominator',
        ])
        || !Number.isSafeInteger(source.rejectionsBeforeHammer)
        || source.rejectionsBeforeHammer < 0
        || source.rejectionsBeforeHammer > 4
        || source.runwayDenominator !== 4
        || Math.abs(
          assessment.futureOpportunityValue
            - source.rejectionsBeforeHammer / 4,
        ) > PROBABILITY_TOLERANCE
      )
    case 'terminal-none':
    case 'decisive-board-none':
      return !(
        !exactKeys(source, ['kind'])
        || assessment.futureOpportunityValue !== 0
        || assessment.futureOpportunityAvailable
      )
    default:
      return false
  }
}

/**
 * Coordination-kind block: shape and per-kind bounds. Verbatim from the
 * original if/else-if/else (unknown kind returns false), so the check set and
 * order are unchanged. The selfOnly/oberon consts that later cross-checks rely
 * on for narrowing stay in the caller, so this extraction does not move them.
 */
function validateCoordination(
  assessment: EvilRoleUtilityAssessment,
  projection: PrivateEvilRoleUtilityProjection,
): boolean {
  if (assessment.coordination.kind === 'visible-coordination') {
    return !(
      !exactKeys(assessment.coordination, [
        'kind', 'coordinatedEvilAboard', 'totalVisibleEvil',
      ])
      || !Number.isSafeInteger(
        assessment.coordination.coordinatedEvilAboard,
      )
      || assessment.coordination.coordinatedEvilAboard < 0
      || assessment.coordination.coordinatedEvilAboard
        > assessment.team.length
      || !Number.isSafeInteger(
        assessment.coordination.totalVisibleEvil,
      )
      || assessment.coordination.totalVisibleEvil <= 0
      || assessment.coordination.totalVisibleEvil
        > Math.ceil(projection.source.playerCount / 3)
      || assessment.coordination.coordinatedEvilAboard
        > assessment.coordination.totalVisibleEvil
    )
  } else if (
    assessment.coordination.kind === 'self-only-uncoordinated'
  ) {
    return !(
      !exactKeys(assessment.coordination, [
        'kind', 'selfAboard', 'unseenEvilOnTeamProbability',
      ])
      || typeof assessment.coordination.selfAboard !== 'boolean'
      || !Number.isFinite(
        assessment.coordination.unseenEvilOnTeamProbability,
      )
      || assessment.coordination.unseenEvilOnTeamProbability < 0
      || assessment.coordination.unseenEvilOnTeamProbability > 1
      || assessment.coordination.selfAboard
        !== assessment.team.includes(projection.request.seat)
    )
  } else {
    return false
  }
}

function evilRoleUtilitySchema(detached: unknown): boolean {
  if (
    !detached
    || typeof detached !== 'object'
    || Array.isArray(detached)
  ) return false
  const projection = detached as PrivateEvilRoleUtilityProjection
  if (
    !exactKeys(projection, [
      'version', 'role', 'source', 'request', 'assessments',
    ])
    || !exactKeys(projection.source, [
      'roleObjectiveVersion',
      'identityModelVersion',
      'observerModelVersion',
      'beliefModelVersion',
      'beliefThroughSeq',
      'playerCount',
    ])
    || projection.version !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    || !isEvilObjectiveRole(projection.role)
    || projection.source.roleObjectiveVersion
      !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    || projection.source.identityModelVersion
      !== JOINT_IDENTITY_MODEL_VERSION
    || projection.source.observerModelVersion
      !== PUBLIC_OBSERVER_MODEL_VERSION
    || typeof projection.source.beliefModelVersion !== 'string'
    || !projection.source.beliefModelVersion.length
    || projection.source.beliefModelVersion.length > 256
    || !Number.isSafeInteger(projection.source.beliefThroughSeq)
    || projection.source.beliefThroughSeq < -1
    || !tableSize(projection.source.playerCount)
    || !canonicalRequestBlock(projection.request, {
      playerCount: projection.source.playerCount,
      kinds: ['propose', 'vote'],
      extraKeys: ['completedGoodQuests', 'completedEvilQuests'],
    })
    || !Number.isSafeInteger(projection.request.completedGoodQuests)
    || projection.request.completedGoodQuests < 0
    || projection.request.completedGoodQuests > 2
    || !Number.isSafeInteger(projection.request.completedEvilQuests)
    || projection.request.completedEvilQuests < 0
    || projection.request.completedEvilQuests > 2
    || projection.request.completedGoodQuests
      + projection.request.completedEvilQuests
        !== projection.request.round - 1
    || !Array.isArray(projection.assessments)
    || projection.assessments.length === 0
    || projection.assessments.length > LEGAL_TEAM_CANDIDATE_BOUND
    || new Set(
      projection.assessments.map((assessment) => assessment.candidateId),
    ).size !== projection.assessments.length
  ) return false
  for (const assessment of projection.assessments) {
    const alternativeKeys = assessment.bestAlternativeCandidateId === undefined
      ? []
      : [
          'bestAlternativeCandidateId',
          'bestAlternativeTeam',
          'bestAlternativeFailureCapabilityProbability',
        ]
    if (!exactKeys(assessment, [
      'candidateId',
      'kind',
      'role',
      'posture',
      'direction',
      'team',
      'valueSemantics',
      'probabilitySemantics',
      'teamFailureCapabilityProbability',
      'publicProbabilitySemantics',
      'publicTeamFailureCapabilityProbability',
      ...alternativeKeys,
      'alternativeRealization',
      'failureCapacityValue',
      'publicActionPlausibilityValue',
      'participantCoverProxyIndex',
      'participantCoverAvailable',
      'publicCoverValue',
      'publicCoverAvailable',
      'publicCoverSemantics',
      'futureOpportunityValue',
      'futureOpportunityAvailable',
      'futureOpportunitySemantics',
      'futureOpportunitySource',
      'failureCapacityContribution',
      'publicCoverContribution',
      'futureOpportunityContribution',
      'roleValue',
      'coordination',
    ])) return false
    if (
      !validateAssessmentFormulas(assessment, projection, alternativeKeys)
    ) return false
    const source = assessment.futureOpportunitySource
    if (!validateFutureOpportunitySource(assessment)) return false
    if (
      assessment.futureOpportunityAvailable
        !== (
          source.kind !== 'terminal-none'
          && source.kind !== 'decisive-board-none'
        )
    ) return false
    const oberon = assessment.role === 'oberon'
    const selfOnly =
      assessment.coordination.kind === 'self-only-uncoordinated'
    const decisiveBoard =
      projection.request.completedGoodQuests >= 2
      || projection.request.completedEvilQuests >= 2
    const finalQuestState =
      projection.request.round === 5
      && projection.request.completedGoodQuests === 2
      && projection.request.completedEvilQuests === 2
    const rejectionsBeforeHammer = Math.max(
      0,
      MAX_PROPOSALS - projection.request.proposalNum,
    )
    const expectedAlternativeRealization =
      alternativeRealizationFrom(rejectionsBeforeHammer)
    if (oberon !== selfOnly) return false
    if (
      assessment.direction === 'oppose'
      && Math.abs(
        assessment.alternativeRealization
          - expectedAlternativeRealization,
      ) > PROBABILITY_TOLERANCE
    ) return false
    if (!validateCoordination(assessment, projection)) return false
    if (source.kind === 'visible-coordination-reserve') {
      if (
        decisiveBoard
        || projection.request.round >= 5
        || oberon
        || selfOnly
        || assessment.direction !== 'support'
        || source.totalVisibleEvil
          !== assessment.coordination.totalVisibleEvil
        || source.reservedVisibleEvil
          !== source.totalVisibleEvil
            - assessment.coordination.coordinatedEvilAboard
      ) return false
    } else if (
      source.kind === 'oberon-unseen-placement-reserve'
    ) {
      if (
        decisiveBoard
        || projection.request.round >= 5
        || !oberon
        || !selfOnly
        || assessment.direction !== 'support'
        || source.unseenEvilOnTeamProbability
          !== assessment.coordination.unseenEvilOnTeamProbability
      ) return false
    } else if (source.kind === 'rejection-runway') {
      if (
        decisiveBoard
        || projection.request.round >= 5
        || assessment.direction !== 'oppose'
        || source.rejectionsBeforeHammer !== rejectionsBeforeHammer
      ) return false
    } else if (source.kind === 'terminal-none') {
      if (!finalQuestState) return false
    } else if (source.kind === 'decisive-board-none') {
      if (!decisiveBoard || finalQuestState) return false
    }
  }
  return true
}

const evilRoleUtilityCodec =
  projectionCodec<PrivateEvilRoleUtilityProjection>(evilRoleUtilitySchema)

export const validatePrivateEvilRoleUtilityProjection =
  evilRoleUtilityCodec.validate
export const decodeCanonicalPrivateEvilRoleUtilityProjection =
  evilRoleUtilityCodec.decode

export const validateAdmittedPrivateEvilRoleUtilityHostJoin =
  exactHostJoin(buildAdmittedEvilRoleUtilityProjection)
