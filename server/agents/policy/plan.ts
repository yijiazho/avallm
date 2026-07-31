import type {
  Decision,
  DecisionRequest,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { ForcedPlayReasonCode } from '../analysis/situation-types.ts'
import type {
  LanguageUtteranceChannel,
  PublicAttributedUtterance,
} from '../record/language-types.ts'
import type { PublicRecord } from '../record/public-record.ts'
import {
  type CandidateScore,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
} from './score.ts'

export const DECISION_PLAN_VERSION = 'decision-plan-v3'
export const COMMUNICATION_INTENT_VERSION = 'communication-intent-v3'
export const POSTERIOR_UNCERTAINTY_VERSION = 'posterior-uncertainty-v1'
export const STRATEGIC_INTENT_VERSION = 'strategic-intent-v1'

export const STRATEGIC_OBJECTIVE_CODES = [
  'BUILD_TRUST',
  'TEST_PLAYER',
  'SUPPORT_TEAM',
  'OPPOSE_TEAM',
  'GATHER_INFORMATION',
  'PRESERVE_COVER',
  'REPAIR_COHERENCE',
] as const
export type StrategicObjectiveCode =
  typeof STRATEGIC_OBJECTIVE_CODES[number]

export const STRATEGIC_INTENT_HORIZONS = [
  'THIS_ACTION',
  'CURRENT_PROPOSAL',
  'NEXT_QUEST',
] as const
export type StrategicIntentHorizon =
  typeof STRATEGIC_INTENT_HORIZONS[number]

export const COMMUNICATION_ACT_CODES = [
  'PASS',
  'EXPLAIN_COMMITTED_TEAM',
  'EXPLAIN_COMMITTED_REVISION',
  'ADVOCATE_SELECTED_ACTION',
  'ACKNOWLEDGE_UNCERTAINTY',
  'EXPRESS_SUSPICION',
  'EXPRESS_TRUST',
  'DEFEND_SELF',
  'RESPOND_TO_PLAYER',
  'WARN_ROLE_EXPOSURE',
  'DISCUSS_ROLE_STRATEGY',
  'CLAIM_ROLE',
] as const
export type CommunicationActCode =
  typeof COMMUNICATION_ACT_CODES[number]

export const COMMUNICATION_ACTS_BY_CHANNEL = {
  discussion: [
    'PASS',
    'ADVOCATE_SELECTED_ACTION',
    'ACKNOWLEDGE_UNCERTAINTY',
    'EXPRESS_SUSPICION',
    'EXPRESS_TRUST',
    'DEFEND_SELF',
    'RESPOND_TO_PLAYER',
    'WARN_ROLE_EXPOSURE',
    'DISCUSS_ROLE_STRATEGY',
    'CLAIM_ROLE',
  ],
  'proposal-pitch': [
    'EXPLAIN_COMMITTED_TEAM',
    'ADVOCATE_SELECTED_ACTION',
    'ACKNOWLEDGE_UNCERTAINTY',
    'EXPRESS_TRUST',
    'CLAIM_ROLE',
  ],
  'revision-reason': [
    'EXPLAIN_COMMITTED_REVISION',
    'ADVOCATE_SELECTED_ACTION',
    'ACKNOWLEDGE_UNCERTAINTY',
    'EXPRESS_TRUST',
    'CLAIM_ROLE',
  ],
} as const satisfies Record<
  LanguageUtteranceChannel,
  readonly CommunicationActCode[]
>

export function communicationActAllowed(
  channel: LanguageUtteranceChannel,
  code: unknown,
): code is CommunicationActCode {
  if (typeof code !== 'string') return false
  return (COMMUNICATION_ACTS_BY_CHANNEL[channel] as readonly CommunicationActCode[])
    .includes(code as CommunicationActCode)
}

export const PUBLIC_EVIDENCE_KINDS = [
  'utterance',
  'proposal',
  'proposal-vote',
  'quest',
] as const
export type PublicEvidenceKind = typeof PUBLIC_EVIDENCE_KINDS[number]

/** Stable coordinates into facts every player can observe. */
export type PublicEvidenceReference =
  | {
      kind: 'utterance'
      sourceSeq: number
    }
  | {
      kind: 'proposal'
      round: number
      proposalNum: number
    }
  | {
      kind: 'proposal-vote'
      round: number
      proposalNum: number
      seat: Seat
    }
  | {
      kind: 'quest'
      questNum: number
    }

export type PosteriorUncertainty =
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'selected-team-clean'
      semantics: GoodProposalFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      cleanProbability: number
      residualProbability: number
    }
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'current-versus-alternative-team-clean'
      semantics: GoodVoteFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      currentCleanProbability: number
      bestAlternativeCleanProbability: number
      utilityGap: number
    }
  | {
      version: typeof POSTERIOR_UNCERTAINTY_VERSION
      kind: 'role-composite-decision'
      semantics: GoodProposalFeatures['semantics'] | GoodVoteFeatures['semantics']
      beliefModelVersion: string
      beliefThroughSeq: number
      baseKind: 'proposal-team-clean' | 'vote-current-versus-alternative'
      compositeUtilityGap: number
    }

export interface PlannerCommunicationDirection {
  version: typeof COMMUNICATION_INTENT_VERSION
  channel: LanguageUtteranceChannel
  targetSeats: readonly Seat[]
  actCodes: readonly CommunicationActCode[]
  evidenceRefs: readonly PublicEvidenceReference[]
  /** The public identity to present; deliberately says nothing about truth. */
  claimedRole?: Role
  /** Role under discussion, separate from any player-to-role assertion. */
  roleTopic?: Role
  tone: 'natural'
}

export interface CommunicationIntent extends PlannerCommunicationDirection {
  safeFactCodes: readonly string[]
  conceal: readonly string[]
  strategicReasonCodes: readonly string[]
  uncertainty?: PosteriorUncertainty
}

/**
 * Private, bounded continuity metadata chosen by the planner. It is persisted
 * only after the associated mechanical decision has passed engine legality.
 * The finite vocabulary and public evidence coordinates keep durable strategy
 * auditable without storing free-form model reasoning.
 */
export interface StrategicIntent {
  version: typeof STRATEGIC_INTENT_VERSION
  objective: StrategicObjectiveCode
  targetSeats: readonly Seat[]
  horizon: StrategicIntentHorizon
  evidenceRefs: readonly PublicEvidenceReference[]
}

export interface DecisionPlan {
  version: typeof DECISION_PLAN_VERSION
  request: DecisionRequest
  decision: Decision
  candidateId: string
  policyId: string
  reasons: readonly (ForcedPlayReasonCode | string)[]
  beliefThroughSeq: number
  candidateScores: readonly CandidateScore[]
  strategicIntent?: StrategicIntent
  communication?: CommunicationIntent
}

export interface CommittedVoicePlan {
  version: typeof DECISION_PLAN_VERSION
  players: readonly {
    seat: Seat
    name: string
  }[]
  publicContext: {
    record: PublicRecord
    recentUtterances: readonly PublicAttributedUtterance[]
  }
  decision: Decision
  candidateId: string
  communication?: Omit<
    CommunicationIntent,
    'conceal' | 'uncertainty'
  > & {
    uncertainty?: {
      version: 'voice-uncertainty-v1'
      kind:
        | 'selected-team-clean'
        | 'current-versus-alternative-team-clean'
        | 'decision-confidence'
      confidence: 'certain' | 'high' | 'moderate' | 'close'
    }
  }
}

export interface CommunicationFactProjection {
  safeFactCodes: readonly string[]
  conceal: readonly string[]
}
