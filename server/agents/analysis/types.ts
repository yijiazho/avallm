import type { Alignment, Seat } from '../../engine/types.ts'
import type { TeamAssessment } from '../belief/types.ts'

export const SITUATION_ANALYSIS_VERSION = 'situation-analysis-v1'
export const GOOD_VOTE_SITUATION_VERSION = 'good-vote-situation-v1'
export type JointProbabilitySemantics =
  | 'uniform-feasible-joint'
  | 'weighted-joint'

export interface BoardScore {
  good: number
  evil: number
}

export type HammerProximity = 'normal' | 'near' | 'next' | 'hammer'

export interface BoardSituation {
  score: BoardScore
  matchPoint: { good: boolean; evil: boolean }
  failsRequired: number
  proposalNumber: number
  /** Future proposals after the current one, including the hammer if reachable. */
  proposalsRemaining: number
  /** How many more voted teams can be rejected before automatic approval. */
  rejectionsBeforeHammer: number
  hammer: {
    proximity: HammerProximity
    automaticApproval: boolean
  }
}

export interface SituationTeamAssessment extends TeamAssessment {
  knownFailsAboard: readonly Seat[]
}

export interface CandidateTeamFacts {
  candidateId: string
  team: readonly Seat[]
  knownFailsAboard: readonly Seat[]
}

export interface PolicyCandidateTeamAssessment
  extends SituationTeamAssessment {
  candidateId: string
  beliefModelVersion: string
  beliefThroughSeq: number
  probabilitySemantics: JointProbabilitySemantics
}

/**
 * Decision-ready posterior projection for a good-side vote. These are exact
 * shares of currently feasible joint worlds, not calibrated quest-success
 * probabilities.
 */
export interface GoodVoteSituation {
  version: typeof GOOD_VOTE_SITUATION_VERSION
  probabilitySemantics: JointProbabilitySemantics
  beliefModelVersion: string
  beliefThroughSeq: number
  currentTeam: SituationTeamAssessment
  currentCandidateId: string
  bestAlternative: PolicyCandidateTeamAssessment
}

export interface DeclaredLeanTally {
  seat: Seat
  lean: 'approve' | 'reject' | 'unsure'
}

export type DeductionProvenance =
  | {
      kind: 'private-deal'
      evidenceIds: readonly string[]
    }
  | {
      kind: 'role-cardinality-closure'
      evidenceIds: readonly string[]
    }
  | {
      kind: 'quest-record'
      evidenceIds: readonly string[]
      questNums: readonly number[]
    }
  | {
      kind: 'joint-constraints'
      evidenceIds: readonly string[]
      questNums: readonly number[]
      components: readonly ('private-knowledge' | 'role-cardinality' | 'quest-record')[]
    }

export interface HardDeduction {
  seat: Seat
  alignment: Alignment
  provenance: DeductionProvenance
}

export const ANALYSIS_FACT_CODES = [
  'GOOD_MATCH_POINT',
  'EVIL_MATCH_POINT',
  'HAMMER_NEAR',
  'HAMMER_NEXT',
  'HAMMER_AUTOMATIC',
  'CURRENT_TEAM_HAS_KNOWN_EVIL',
  'CURRENT_TEAM_CAN_MEET_FAIL_REQUIREMENT',
  'ALIGNMENT_PROVEN_PRIVATE',
  'ALIGNMENT_PROVEN_CLOSURE',
  'ALIGNMENT_PROVEN_QUEST',
  'ALIGNMENT_PROVEN_JOINT',
] as const
export type AnalysisFactCode = typeof ANALYSIS_FACT_CODES[number]

export const FORCED_PLAY_REASON_CODES = [
  'GOOD_QUEST_CARD_FORCED_SUCCESS',
  'EVIL_QUEST_CARD_CANNOT_SINK',
  'EVIL_MATCH_POINT_FAIL_AVAILABLE',
  'GOOD_MATCH_POINT_FAIL_REQUIRED',
  'EVIL_TEAM_CAN_SINK',
  'EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT',
  'EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED',
  'EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
  'HAMMER_TEAM_AUTOMATIC',
] as const
export type ForcedPlayReasonCode = typeof FORCED_PLAY_REASON_CODES[number]

export interface SituationAnalysis extends BoardSituation {
  throughSeq: number
  modelVersion: typeof SITUATION_ANALYSIS_VERSION
  currentTeam?: SituationTeamAssessment
  candidateTeams: readonly SituationTeamAssessment[]
  /** Cheap mechanical facts for exhaustive legal-team candidate surfaces. */
  policyCandidateTeams: readonly CandidateTeamFacts[]
  /**
   * Opt-in decision-ready joint posterior projection. Empty unless a policy
   * explicitly requests the exhaustive team surface.
   */
  policyCandidateAssessments: readonly PolicyCandidateTeamAssessment[]
  /** Opt-in current-team versus best-different-team vote projection. */
  goodVote?: GoodVoteSituation
  /** Latest public lean per seat on the current proposal segment. */
  declaredLeans: readonly DeclaredLeanTally[]
  /** Whether this seat's approve/reject could still change passage by public leans. */
  voteLeverage: {
    approveCouldMatter: boolean
    rejectCouldMatter: boolean
  }
  provenGood: readonly Seat[]
  provenEvil: readonly Seat[]
  unresolved: readonly Seat[]
  deductions: readonly HardDeduction[]
  factCodes: readonly AnalysisFactCode[]
  forcedPlayReasonCodes: readonly ForcedPlayReasonCode[]
}
