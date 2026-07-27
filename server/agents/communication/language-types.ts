import type {
  Lean,
  Seat,
} from '../../engine/types.ts'
import type { PublicRecord } from './public-record.ts'

export const LANGUAGE_INTERPRETER_INPUT_VERSION =
  'public-language-input-v1'
export const LANGUAGE_EVIDENCE_VERSION = 'language-evidence-v1'
export const LANGUAGE_CURSOR_VERSION = 'language-cursor-v1'

export const LANGUAGE_EVIDENCE_CLASSES = [
  'contradiction',
  'unsupportedCertainty',
  'coalitionDefense',
  'truthTracking',
  'roleKnowledgeTell',
  'other',
] as const

export const LANGUAGE_EVIDENCE_DIRECTIONS = [
  'moreEvil',
  'moreGood',
  'unchanged',
] as const

export const LANGUAGE_EVIDENCE_CONFIDENCES = [
  'low',
  'medium',
  'high',
] as const

export type LanguageEvidenceClass =
  typeof LANGUAGE_EVIDENCE_CLASSES[number]
export type LanguageEvidenceDirection =
  typeof LANGUAGE_EVIDENCE_DIRECTIONS[number]
export type LanguageEvidenceConfidence =
  typeof LANGUAGE_EVIDENCE_CONFIDENCES[number]
export type LanguageUtteranceChannel =
  'discussion' | 'proposal-pitch' | 'revision-reason'

/**
 * A finite, inspectable interpretation of one public utterance.
 *
 * This is private cognition belonging to the interpreting agent. The source
 * utterance is public, but this record is never part of PlayerView or the
 * public cognition projection.
 */
export interface LanguageEvidence {
  schemaVersion: typeof LANGUAGE_EVIDENCE_VERSION
  sourceSeq: number
  subject: Seat
  direction: LanguageEvidenceDirection
  class: LanguageEvidenceClass
  confidence: LanguageEvidenceConfidence
  publicRationale: string
  interpreterVersion: string
}

export interface LanguageUtteranceContext {
  round: number
  proposalNum: number
  leader: Seat
  team: readonly Seat[]
  discussionRound?: number
  postRevision?: boolean
}

/**
 * Names and text are untrusted player-authored data. An eventual provider
 * adapter must delimit them as data and must not concatenate them into its
 * instructions.
 */
export interface PublicAttributedUtterance {
  sourceSeq: number
  channel: LanguageUtteranceChannel
  speaker: { seat: Seat; name: string }
  text: string
  lean?: Lean
  context?: LanguageUtteranceContext
}

export type LanguagePublicContext = PublicRecord

/**
 * Strict public-only DTO. `newUtterances` is the only output-eligible source;
 * history exists solely to give an interpreter public conversational context.
 */
export interface LanguageInterpreterInput {
  schemaVersion: typeof LANGUAGE_INTERPRETER_INPUT_VERSION
  dataClassification: 'untrusted-public-player-data'
  throughSeq: number
  newUtterances: readonly PublicAttributedUtterance[]
  utteranceHistory: readonly PublicAttributedUtterance[]
  publicContext: LanguagePublicContext
}

export interface LanguageInterpreter {
  readonly interpreterVersion: string
  interpret(input: LanguageInterpreterInput): Promise<unknown>
}

export interface LanguageEvidenceCursor {
  schemaVersion: typeof LANGUAGE_CURSOR_VERSION
  /** Last public engine sequence projected, whether or not it contained speech. */
  throughSeq: number
  /** Public utterance sequences already admitted as private evidence. */
  countedSourceSeqs: readonly number[]
}

export interface LanguageEvidenceAdmission {
  evidence: readonly LanguageEvidence[]
  cursor: LanguageEvidenceCursor
}
