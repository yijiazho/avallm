import type {
  Decision,
  DecisionRequest,
  Role,
  Seat,
} from '../../engine/types.ts'
import type { ForcedPlayReasonCode } from '../candidate/types.ts'
import type {
  LanguageUtteranceChannel,
  PublicAttributedUtterance,
} from '../record/language-types.ts'
import type { PublicRecord } from '../record/public-record.ts'
import {
  STRATEGIC_INTENT_VERSION,
  STRATEGIC_OBJECTIVE_CODES,
  STRATEGIC_INTENT_HORIZONS,
  PUBLIC_EVIDENCE_KINDS,
} from '../record/intent.ts'
import type {
  StrategicObjectiveCode,
  StrategicIntentHorizon,
  PublicEvidenceKind,
  PublicEvidenceReference,
  StrategicIntent,
} from '../record/intent.ts'

export {
  STRATEGIC_INTENT_VERSION,
  STRATEGIC_OBJECTIVE_CODES,
  STRATEGIC_INTENT_HORIZONS,
  PUBLIC_EVIDENCE_KINDS,
}
export type {
  StrategicObjectiveCode,
  StrategicIntentHorizon,
  PublicEvidenceKind,
  PublicEvidenceReference,
  StrategicIntent,
}
import {
  type CandidateScore,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
} from './score.ts'

export const DECISION_PLAN_VERSION = 'decision-plan-v3'
export const COMMUNICATION_INTENT_VERSION = 'communication-intent-v3'
export const POSTERIOR_UNCERTAINTY_VERSION = 'posterior-uncertainty-v1'



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
