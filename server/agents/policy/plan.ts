import type {
  Decision,
  DecisionRequest,
  Lean,
  Seat,
} from '../../engine/types.ts'
import type { ForcedPlayReasonCode } from '../analysis/types.ts'
import type { CandidateScore } from './score.ts'

export const DECISION_PLAN_VERSION = 'decision-plan-v1'
export const COMMUNICATION_INTENT_VERSION = 'communication-intent-v1'

export interface CommunicationIntent {
  version: typeof COMMUNICATION_INTENT_VERSION
  channel: 'discussion' | 'proposal-pitch' | 'revision-reason'
  desiredLean?: Lean
  targetSeats: readonly Seat[]
  claims: readonly string[]
  safeFactCodes: readonly string[]
  conceal: readonly string[]
  tone: 'natural'
}

export interface DecisionPlan {
  version: typeof DECISION_PLAN_VERSION
  request: DecisionRequest
  decision: Decision
  candidateId: string
  policyId: string
  reasons: readonly ForcedPlayReasonCode[]
  beliefThroughSeq: number
  candidateScores: readonly CandidateScore[]
  communication?: CommunicationIntent
}

const PUBLIC_SAFE_FACT_CODES = new Set([
  'GOOD_MATCH_POINT',
  'EVIL_MATCH_POINT',
  'HAMMER_NEAR',
  'HAMMER_NEXT',
  'HAMMER_AUTOMATIC',
])

export interface CommunicationFactProjection {
  safeFactCodes: readonly string[]
  conceal: readonly string[]
}

/** Private analysis facts are denied public use unless explicitly allowlisted. */
export function communicationFactProjection(
  factCodes: readonly string[],
): CommunicationFactProjection {
  return {
    safeFactCodes: factCodes.filter((code) => PUBLIC_SAFE_FACT_CODES.has(code)),
    conceal: factCodes.filter((code) => !PUBLIC_SAFE_FACT_CODES.has(code)),
  }
}

export function defaultCommunicationIntent(
  decision: Decision,
  factCodes: readonly string[],
): CommunicationIntent | undefined {
  const { safeFactCodes, conceal } = communicationFactProjection(factCodes)
  if (decision.kind === 'discuss') {
    return {
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'discussion',
      ...(decision.lean ? { desiredLean: decision.lean } : {}),
      targetSeats: [],
      claims: decision.lean ? [`public lean is ${decision.lean}`] : [],
      safeFactCodes,
      conceal,
      tone: 'natural',
    }
  }
  if (decision.kind === 'propose') {
    return {
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'proposal-pitch',
      targetSeats: [...decision.team],
      claims: ['explain the committed team'],
      safeFactCodes,
      conceal,
      tone: 'natural',
    }
  }
  if (decision.kind === 'finalize' && !decision.stick) {
    return {
      version: COMMUNICATION_INTENT_VERSION,
      channel: 'revision-reason',
      targetSeats: [...decision.team],
      claims: ['explain the committed revision'],
      safeFactCodes,
      conceal,
      tone: 'natural',
    }
  }
  return undefined
}
