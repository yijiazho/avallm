import type {
  DecisionKind,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'

export const ROLE_OBJECTIVE_MODEL_VERSION =
  'merlin-percival-objectives-v1'
export const ROLE_OBJECTIVE_DEGRADATION =
  'role-objective-assessment-failed'
export const MAX_ROLE_OBJECTIVE_ASSESSMENTS = 256

export type RoleObjectiveRole = 'merlin' | 'percival'
export const PUBLIC_COMMITMENT_DIRECTIONS = Object.freeze([
  'support',
  'oppose',
  'neutral',
] as const)

export type PublicCommitmentDirection =
  typeof PUBLIC_COMMITMENT_DIRECTIONS[number]

export function isPublicCommitmentDirection(
  value: unknown,
): value is PublicCommitmentDirection {
  return (PUBLIC_COMMITMENT_DIRECTIONS as readonly unknown[]).includes(value)
}

/**
 * The team the objective belongs to. It is the discriminant of the private
 * objective union stored on cognition state: a seat holds one objective or
 * none, never both a good and an evil one.
 */
export type ObjectiveTeam = 'good' | 'evil'

/**
 * The belief and observer provenance every role objective source carries,
 * whatever team it belongs to. The good/evil ObjectiveSource, the Morgana
 * counterfeit source, and the Mordred blindness source all extend this with
 * their own trailing dependency version(s); it is declared once here so the
 * shared five belief/observer fields plus the cast cannot drift per role.
 */
export interface ObjectiveSourceBase {
  beliefModelVersion: string
  beliefThroughSeq: number
  beliefQuality: BeliefSnapshot['quality']
  playerCount: number
  rolesInPlay: readonly Role[]
  observerModelVersion: string
  observerFeasibleWorldCount: number
}

/**
 * The shared objective envelope. Good and evil private objectives carry the
 * identical belief/source provenance, so it is declared once here rather than
 * duplicated per team.
 */
export interface ObjectiveSource extends ObjectiveSourceBase {
  identityModelVersion: string
}

/** The decision the objective snapshot was built for. Shared, like the source. */
export interface ObjectiveRequest {
  seat: Seat
  kind: DecisionKind
  round: number
  proposalNum: number
  failsRequired: number
}

// Retained names for callers that imported the pre-unification aliases.
export type RoleObjectiveSource = ObjectiveSource
export type RoleObjectiveRequest = ObjectiveRequest

export interface CandidatePublicCommitment {
  candidateId: string
  kind: DecisionKind
  direction: PublicCommitmentDirection
  team?: readonly Seat[]
}

export interface MerlinCandidateObjective {
  candidate: CandidatePublicCommitment
  probabilitySemantics: 'resolved-complete-world-sum'
  valueSemantics: 'bounded-deterministic-indices-not-probabilities'
  teamCleanProbability: number
  teamFailureCapabilityProbability: number
  evilCountDistribution: readonly number[]
  influenceValue: number
  publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint'
  publicTeamCleanProbability: number
  publicAmbiguityIndex: number
  conspicuousnessIndex: number
  assassinExposureProxyIndex: number
}

export interface MerlinRoleObjective {
  role: 'merlin'
  assessments: readonly MerlinCandidateObjective[]
}

export interface MerlinMorganaPairHypothesis {
  merlinSeat: Seat
  /** Null is the explicit, sole Morgana coordinate in casts without Morgana. */
  morganaSeat: Seat | null
  probability: number
}

export interface PercivalCandidateObjective {
  candidate: CandidatePublicCommitment
  probabilitySemantics: 'resolved-complete-world-sum'
  valueSemantics: 'bounded-deterministic-indices-not-probabilities'
  merlinOnTeamProbability: number
  morganaOnTeamProbability: number
  pairInfluenceValue: number
  publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint'
  publicTeamCleanProbability: number
  publicMerlinProbabilityAtSelf: number
  publicMerlinOnTeamProbability: number
  publicMorganaOnTeamProbability: number
  publicPairInfluenceValue: number
  pairKnowledgeTellIndex: number
  decisiveAmbiguityIndex: number
  merlinMimicryProxyIndex: number
  selfDecoyOpportunityProxyIndex: number
}

export interface PercivalRoleObjective {
  role: 'percival'
  pairPosterior: {
    probabilitySemantics: 'resolved-complete-world-sum'
    includesMorgana: boolean
    privateCandidateSeats: readonly Seat[]
    hypotheses: readonly MerlinMorganaPairHypothesis[]
  }
  assessments: readonly PercivalCandidateObjective[]
}

export interface PrivateRoleObjectiveSnapshot {
  version: typeof ROLE_OBJECTIVE_MODEL_VERSION
  team: 'good'
  role: RoleObjectiveRole
  source: ObjectiveSource
  request: ObjectiveRequest
  objective: MerlinRoleObjective | PercivalRoleObjective
}
