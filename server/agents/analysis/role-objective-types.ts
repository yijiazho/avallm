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
export type PublicCommitmentDirection = 'support' | 'oppose' | 'neutral'

export interface RoleObjectiveSource {
  beliefModelVersion: string
  beliefThroughSeq: number
  beliefQuality: BeliefSnapshot['quality']
  playerCount: number
  rolesInPlay: readonly Role[]
  identityModelVersion: string
  observerModelVersion: string
  observerFeasibleWorldCount: number
}

export interface RoleObjectiveRequest {
  seat: Seat
  kind: DecisionKind
  round: number
  proposalNum: number
  failsRequired: number
}

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
  role: RoleObjectiveRole
  source: RoleObjectiveSource
  request: RoleObjectiveRequest
  objective: MerlinRoleObjective | PercivalRoleObjective
}
