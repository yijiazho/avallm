// Durable strategic intent and the public-record coordinates it points at.
//
// This vocabulary sat in policy/plan.ts, which made cognition depend on policy:
// CognitionState persists a StrategicIntent, and plan-memory validates one, so
// the two folders pointed at each other for a handful of type references. None
// of it is policy machinery. A StrategicIntent is bounded state a planner
// chose and the table may later be shown, and a PublicEvidenceReference is a
// coordinate into the record every seat can see, which is this folder's
// subject. policy/plan.ts imports them back and re-exports them, so the
// planner, renderer and admission consumers keep the import they had.
import type { Seat } from '../../engine/types.ts'

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
