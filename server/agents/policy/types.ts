import type {
  Decision,
  DecisionKind,
} from '../../engine/types.ts'
import type { ForcedPlayReasonCode } from '../analysis/situation-types.ts'

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
