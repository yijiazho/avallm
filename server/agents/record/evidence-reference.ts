// Public-record evidence references: their structure, their identity, and
// whether one names a fact that actually happened.
//
// These validators sat in communication/direction-contract.ts, beside the
// direction they mostly serve. That put them above cognition, which persists
// evidence references inside a strategic intent and has to validate what it
// reloads, so cognition imported communication while communication imported
// cognition back for CognitionState. Together with communication's reads of
// policy that closed a three-folder cycle, and it would have forced cognition,
// communication, policy and components into one undifferentiated tier.
//
// None of this is rendering. A PublicEvidenceReference is a coordinate into the
// record every seat can see, which is this folder's subject, so the validators
// belong beside the vocabulary rather than beside their most frequent caller.
// direction-contract.ts imports them back and re-exports the two its own
// consumers read off it.
import { MAX_PROPOSALS, QUESTS_PER_GAME } from '../../engine/rules.ts'
import type { Role, Seat } from '../../engine/types.ts'
import {
  denseArray,
  onlyAllowedKeys,
  plainDataRecord,
} from '../canonical/canonical-shape.ts'
import { recentPublicUtterances } from './language-contract.ts'
import type { LanguageInterpreterInput } from './language-types.ts'
import type { PublicEvidenceReference } from './intent.ts'

/** What a caller can tell us about the table an evidence reference points into. */
export interface EvidenceReferenceContext {
  /** Whether a seat number names a player at this table. */
  readonly seatExists?: (seat: Seat) => boolean
  /** Roles the deal put in play, when the caller can know them. */
  readonly rolesInPlay?: readonly Role[]
  /** Whether a structurally valid reference names a fact in the public record. */
  readonly evidenceExists?: (reference: PublicEvidenceReference) => boolean
}

/** A direction may cite at most this many public facts. */
export const MAX_EVIDENCE_REFS = 8

export function safeIndex(value: unknown, min: number, max?: number): boolean {
  return Number.isSafeInteger(value)
    && (value as number) >= min
    && (max === undefined || (value as number) <= max)
}

/**
 * Structural validity of one evidence reference, independent of the record.
 *
 * `onlyAllowedKeys` permits an absent key, so each coordinate is required here
 * by its own integer check rather than by the key list. The upper bounds are
 * the rules' own constants, which every caller can apply whether or not it can
 * see the record the reference points into.
 */
export function evidenceReferenceShaped(
  value: unknown,
  context: EvidenceReferenceContext,
): value is PublicEvidenceReference {
  if (!plainDataRecord(value)) return false
  const seatKnown = (seat: unknown): boolean =>
    safeIndex(seat, 0)
    && (context.seatExists?.(seat as Seat) ?? true)
  if (value.kind === 'utterance') {
    return onlyAllowedKeys(value, ['kind', 'sourceSeq'])
      && safeIndex(value.sourceSeq, 0)
  }
  if (value.kind === 'proposal') {
    return onlyAllowedKeys(value, ['kind', 'round', 'proposalNum'])
      && safeIndex(value.round, 1, QUESTS_PER_GAME)
      && safeIndex(value.proposalNum, 1, MAX_PROPOSALS)
  }
  if (value.kind === 'proposal-vote') {
    return onlyAllowedKeys(value, ['kind', 'round', 'proposalNum', 'seat'])
      && safeIndex(value.round, 1, QUESTS_PER_GAME)
      && safeIndex(value.proposalNum, 1, MAX_PROPOSALS)
      && seatKnown(value.seat)
  }
  if (value.kind === 'quest') {
    return onlyAllowedKeys(value, ['kind', 'questNum'])
      && safeIndex(value.questNum, 1, QUESTS_PER_GAME)
  }
  return false
}

/**
 * A reference's identity, read field by field rather than serialized.
 *
 * Citing one fact twice is the rule this feeds, and JSON.stringify cannot state
 * it: two references to the same quest whose keys arrive in different orders
 * serialize to different strings, so a model that varied its key order got two
 * citations of one fact past every boundary.
 */
export function evidenceKey(reference: PublicEvidenceReference): string {
  if (reference.kind === 'utterance') {
    return `utterance:${reference.sourceSeq}`
  }
  if (reference.kind === 'proposal') {
    return `proposal:${reference.round}:${reference.proposalNum}`
  }
  if (reference.kind === 'proposal-vote') {
    return [
      'proposal-vote',
      reference.round,
      reference.proposalNum,
      reference.seat,
    ].join(':')
  }
  return `quest:${reference.questNum}`
}

/** Shared structural and optional host join for a bounded evidence-ref set. */
export function validPublicEvidenceReferences(
  value: unknown,
  context: EvidenceReferenceContext = {},
): value is readonly PublicEvidenceReference[] {
  if (!denseArray(value) || value.length > MAX_EVIDENCE_REFS) return false
  if (!value.every(
    (reference) => evidenceReferenceShaped(reference, context),
  )) return false
  const references = value as readonly PublicEvidenceReference[]
  if (new Set(references.map(evidenceKey)).size !== references.length) {
    return false
  }
  return context.evidenceExists === undefined
    || references.every(context.evidenceExists)
}

/**
 * Whether a reference names a fact the whole table can already see.
 *
 * The public projection is the only thing consulted, so this is the same answer
 * for every seat: a direction may only cite what a listener could check.
 */
export function publicEvidenceExists(
  reference: PublicEvidenceReference,
  input: LanguageInterpreterInput,
): boolean {
  if (reference.kind === 'utterance') {
    return recentPublicUtterances(input).some(
      (utterance) => utterance.sourceSeq === reference.sourceSeq,
    )
  }
  if (reference.kind === 'proposal') {
    return input.publicContext.proposals.some(
      (proposal) => proposal.round === reference.round
        && proposal.proposalNum === reference.proposalNum,
    )
  }
  if (reference.kind === 'proposal-vote') {
    return input.publicContext.proposals.some(
      (proposal) => proposal.outcome === 'voted'
        && proposal.round === reference.round
        && proposal.proposalNum === reference.proposalNum
        && proposal.votes.some((vote) => vote.seat === reference.seat),
    )
  }
  return input.publicContext.quests.some(
    (quest) => quest.num === reference.questNum
      && quest.result !== undefined,
  )
}
