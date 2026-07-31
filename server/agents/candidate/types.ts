import type {
  Decision,
  DecisionKind,
} from '../../engine/types.ts'


/**
 * Why a decision was forced rather than chosen.
 *
 * These codes sat in analysis/situation-types.ts, next to the analysis that
 * derives them. That put a string union above the candidate vocabulary that
 * reports it, and it was the single edge keeping this folder from sitting
 * below analysis: ForcedPolicyResult names the code, so the candidate types
 * could not be reached without reaching analysis first. The list depends on
 * nothing, so it comes down to the module that has to name it, and analysis
 * imports it back.
 */
export const FORCED_PLAY_REASON_CODES = [
  'GOOD_QUEST_CARD_FORCED_SUCCESS',
  'EVIL_QUEST_CARD_CANNOT_SINK',
  'EVIL_INSUFFICIENT_VISIBLE_QUOTA_HOLD',
  'EVIL_SHARED_SLOW_PLAY_HOLD',
  'EVIL_ROBUST_DECISIVE_FAIL',
  'EVIL_ROBUST_LOCAL_SLOW_PLAY_FAIL',
  'EVIL_ROBUST_LOCAL_SLOW_PLAY_HOLD',
  'EVIL_MATCH_POINT_FAIL_AVAILABLE',
  'GOOD_MATCH_POINT_FAIL_REQUIRED',
  'EVIL_TEAM_CAN_SINK',
  'EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT',
  'EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED',
  'EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
  'HAMMER_TEAM_AUTOMATIC',
] as const
export type ForcedPlayReasonCode = typeof FORCED_PLAY_REASON_CODES[number]

export const LEGAL_CANDIDATE_VERSION = 'legal-candidates-v2'
export const FORCED_POLICY_VERSION = 'forced-policy-v1'

export interface PolicyCandidate {
  id: string
  version: typeof LEGAL_CANDIDATE_VERSION
  kind: DecisionKind
  decision: Decision
}

/**
 * A finite discussion seam. Table talk has no enumerable mechanical content, so
 * this is a single candidate: the policy commits to speaking and arbitrary
 * prose remains the communication layer's job.
 */
export interface DiscussionCandidate extends PolicyCandidate {
  kind: 'discuss'
  decision: Extract<Decision, { kind: 'discuss' }>
  template: 'pass'
}

export interface ForcedPolicyResult {
  version: typeof FORCED_POLICY_VERSION
  applied: boolean
  reasonCodes: readonly ForcedPlayReasonCode[]
  allowedCandidateIds: readonly string[]
  selectedCandidateId?: string
}
