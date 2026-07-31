import { isRole, type Role, type Seat } from '../../engine/types.ts'
import { hasDistinctSeats } from '../../engine/seatset.ts'
import {
  denseArray,
  onlyAllowedKeys,
  plainDataRecord,
} from '../canonical/canonical-shape.ts'
import type {
  AssertNever,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
} from '../../shared/key-list-guards.ts'
import {
  COMMUNICATION_INTENT_VERSION,
  communicationActAllowed,
  type PlannerCommunicationDirection,
  type PublicEvidenceReference,
} from '../policy/plan.ts'
import type {
  LanguageUtteranceChannel,
} from '../record/language-types.ts'
import {
  MAX_EVIDENCE_REFS,
  evidenceKey,
  evidenceReferenceShaped,
  publicEvidenceExists,
  safeIndex,
  validPublicEvidenceReferences,
} from '../record/evidence-reference.ts'

export { MAX_EVIDENCE_REFS, publicEvidenceExists, validPublicEvidenceReferences }

/**
 * The one contract for a planner-authored communication direction.
 *
 * Three boundaries admit this shape and they know different amounts about the
 * table: the reply parser (`planner-voice-adapter`) has only the JSON, the
 * in-process planner seam (`composed`) has the seat's view, and trace admission
 * (`admission/composed-trace`) has the host view when a host supplied one. Each
 * used to carry its own copy of the rules, and the copies drifted in exactly
 * the places that matter: the parser facing real model output was the one
 * missing the evidence-existence and roles-in-play checks.
 *
 * So the rules live here once and the per-caller knowledge arrives as
 * capabilities. A caller that cannot answer a question omits the capability and
 * the corresponding check is skipped by construction, which is the one thing
 * this module lets a caller be lax about. Everything structural is checked for
 * everyone.
 */
export interface CommunicationDirectionContext {
  /**
   * Channels the committed action may speak on. One entry for a caller that
   * knows the decision, all three for a parser that does not, and none for an
   * action that speaks at all, which rejects every direction.
   */
  readonly allowedChannels: readonly LanguageUtteranceChannel[]
  /**
   * Whether a seat number names a player at this table. A caller without a
   * roster admits any non-negative seat; the structural bounds still apply.
   */
  readonly seatExists?: (seat: Seat) => boolean
  /** Roles the deal put in play, when the caller can know them. */
  readonly rolesInPlay?: readonly Role[]
  /**
   * Whether a structurally valid reference names a fact in the public record.
   * Omitted by a caller with no record to check against.
   */
  readonly evidenceExists?: (reference: PublicEvidenceReference) => boolean
  /**
   * Keys the caller's own shape adds on top of the direction. Only the trace
   * boundary supplies these, because it validates a whole CommunicationIntent:
   * the direction fields by this contract, and its own four by its own rules.
   */
  readonly additionalKeys?: readonly string[]
}


/**
 * Pinned to the type, so a new direction field cannot be added without a
 * decision about how this contract validates it: the key list stops matching
 * `PlannerCommunicationDirection` and the assertion below fails to compile.
 */
const DIRECTION_KEYS = [
  'version',
  'channel',
  'targetSeats',
  'actCodes',
  'evidenceRefs',
  'claimedRole',
  'roleTopic',
  'tone',
] as const satisfies ExactKeyList<PlannerCommunicationDirection>
export type _DirectionKeysSound =
  | AssertNever<
      MissingKeys<PlannerCommunicationDirection, typeof DIRECTION_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof DIRECTION_KEYS>>

/**
 * Why a direction was rejected.
 *
 * Every caller collapses this to a single degradation code today, so the value
 * of naming the clause is diagnostic: a test can pin which rule fired, and a
 * future caller can report it without re-deriving it from a boolean.
 */
export type CommunicationDirectionFailure =
  | 'not-a-record'
  | 'unknown-key'
  | 'version'
  | 'channel'
  | 'target-seats'
  | 'unknown-seat'
  | 'act-codes'
  | 'act-not-on-channel'
  | 'pass-not-exclusive'
  | 'missing-targets'
  | 'evidence-refs'
  | 'evidence-malformed'
  | 'evidence-unknown'
  | 'claimed-role'
  | 'role-topic'
  | 'role-exposure-topic'
  | 'tone'





/**
 * Validate a communication direction, naming the first rule it breaks.
 *
 * Ordered shape first, meaning first: every derived question (does this act set
 * need targets, does it claim a role) is asked only of values already proven to
 * be the arrays and strings they claim to be. Deriving those flags before the
 * shape checks is how the in-process copy of this function came to throw a
 * TypeError on a non-array `actCodes` instead of returning a verdict.
 */
export function communicationDirectionFailure(
  value: unknown,
  context: CommunicationDirectionContext,
): CommunicationDirectionFailure | undefined {
  if (!plainDataRecord(value)) return 'not-a-record'
  if (!onlyAllowedKeys(value, [
    ...DIRECTION_KEYS,
    ...(context.additionalKeys ?? []),
  ])) return 'unknown-key'
  if (value.version !== COMMUNICATION_INTENT_VERSION) return 'version'
  const channel = value.channel as LanguageUtteranceChannel
  if (!context.allowedChannels.includes(channel)) return 'channel'

  const targetSeats = value.targetSeats
  if (
    !denseArray(targetSeats)
    || !targetSeats.every((seat) => safeIndex(seat, 0))
    || !hasDistinctSeats(targetSeats as readonly Seat[])
  ) return 'target-seats'
  if (
    context.seatExists
    && !(targetSeats as readonly Seat[]).every(context.seatExists)
  ) return 'unknown-seat'

  const actCodes = value.actCodes
  if (
    !denseArray(actCodes)
    || actCodes.length === 0
    || new Set(actCodes).size !== actCodes.length
  ) return 'act-codes'
  if (!actCodes.every((code) => communicationActAllowed(channel, code))) {
    return 'act-not-on-channel'
  }

  const evidenceRefs = value.evidenceRefs
  if (
    !denseArray(evidenceRefs)
    || evidenceRefs.length > MAX_EVIDENCE_REFS
  ) return 'evidence-refs'
  if (
    !evidenceRefs.every((reference) =>
      evidenceReferenceShaped(reference, context))
  ) return 'evidence-malformed'
  if (
    new Set(
      (evidenceRefs as readonly PublicEvidenceReference[]).map(evidenceKey),
    ).size !== evidenceRefs.length
  ) return 'evidence-refs'
  if (
    context.evidenceExists
    && !(evidenceRefs as readonly PublicEvidenceReference[])
      .every(context.evidenceExists)
  ) return 'evidence-unknown'

  // Every question below is about what the act set commits the speaker to, so
  // it is asked only now that the act set is known to be a set of strings.
  const acts = actCodes as readonly string[]
  if (
    acts.includes('PASS')
    && (
      acts.length !== 1
      || targetSeats.length !== 0
      || evidenceRefs.length !== 0
    )
  ) return 'pass-not-exclusive'
  if (
    acts.some((code) =>
      code === 'EXPRESS_SUSPICION'
      || code === 'EXPRESS_TRUST'
      || code === 'RESPOND_TO_PLAYER')
    && targetSeats.length === 0
  ) return 'missing-targets'

  const claimedRole = value.claimedRole
  if (
    acts.includes('CLAIM_ROLE') !== (claimedRole !== undefined)
    || (claimedRole !== undefined && !isRole(claimedRole))
    || (
      claimedRole !== undefined
      && context.rolesInPlay !== undefined
      && !context.rolesInPlay.includes(claimedRole as Role)
    )
  ) return 'claimed-role'

  const roleTopic = value.roleTopic
  const topicalActs = acts.includes('WARN_ROLE_EXPOSURE')
    || acts.includes('DISCUSS_ROLE_STRATEGY')
  if (
    topicalActs !== (roleTopic !== undefined)
    || (roleTopic !== undefined && !isRole(roleTopic))
    || (
      roleTopic !== undefined
      && context.rolesInPlay !== undefined
      && !context.rolesInPlay.includes(roleTopic as Role)
    )
  ) return 'role-topic'
  if (acts.includes('WARN_ROLE_EXPOSURE') && roleTopic !== 'merlin') {
    return 'role-exposure-topic'
  }

  if (value.tone !== 'natural') return 'tone'
  return undefined
}

export function validCommunicationDirection(
  value: unknown,
  context: CommunicationDirectionContext,
): value is PlannerCommunicationDirection {
  return communicationDirectionFailure(value, context) === undefined
}


/** The channel a decision of this kind speaks on, if it speaks at all. */
export function directionChannelFor(
  kind: string,
  stick: boolean | undefined,
): LanguageUtteranceChannel | undefined {
  if (kind === 'discuss') return 'discussion'
  if (kind === 'propose') return 'proposal-pitch'
  if (kind === 'finalize' && stick === false) return 'revision-reason'
  return undefined
}
