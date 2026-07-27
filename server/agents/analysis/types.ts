import type { Alignment, Seat } from '../../engine/types.ts'
import type { TeamAssessment } from '../belief/types.ts'

export const SITUATION_ANALYSIS_VERSION = 'situation-analysis-v1'

export interface BoardScore {
  good: number
  evil: number
}

export type HammerProximity = 'normal' | 'near' | 'next' | 'hammer'

export interface BoardSituation {
  score: BoardScore
  matchPoint: { good: boolean; evil: boolean }
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

export type AnalysisFactCode =
  | 'GOOD_MATCH_POINT'
  | 'EVIL_MATCH_POINT'
  | 'HAMMER_NEAR'
  | 'HAMMER_NEXT'
  | 'HAMMER_AUTOMATIC'
  | 'CURRENT_TEAM_HAS_KNOWN_EVIL'
  | 'CURRENT_TEAM_CAN_MEET_FAIL_REQUIREMENT'
  | 'ALIGNMENT_PROVEN_PRIVATE'
  | 'ALIGNMENT_PROVEN_CLOSURE'
  | 'ALIGNMENT_PROVEN_QUEST'
  | 'ALIGNMENT_PROVEN_JOINT'

export type ForcedPlayReasonCode =
  | 'GOOD_QUEST_CARD_FORCED_SUCCESS'
  | 'EVIL_MATCH_POINT_FAIL_AVAILABLE'
  | 'GOOD_MATCH_POINT_FAIL_REQUIRED'
  | 'EVIL_TEAM_CAN_SINK'
  | 'EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT'
  | 'HAMMER_TEAM_AUTOMATIC'

export interface SituationAnalysis extends BoardSituation {
  throughSeq: number
  modelVersion: typeof SITUATION_ANALYSIS_VERSION
  currentTeam?: SituationTeamAssessment
  candidateTeams: readonly SituationTeamAssessment[]
  provenGood: readonly Seat[]
  provenEvil: readonly Seat[]
  unresolved: readonly Seat[]
  deductions: readonly HardDeduction[]
  factCodes: readonly AnalysisFactCode[]
  forcedPlayReasonCodes: readonly ForcedPlayReasonCode[]
}
