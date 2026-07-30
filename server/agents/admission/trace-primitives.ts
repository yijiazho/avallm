// Small shared shapes and predicates used by both the generic composed-trace
// admission owner and the isolated role-trace-v1 reader. Extracted so the v1
// role reader needs no import back into the generic owner.

import type { DecisionTrace } from '../trace.ts'
import type { ForcedPolicyResult } from '../policy/types.ts'
import { FORCED_POLICY_VERSION } from '../policy/types.ts'
import { FORCED_PLAY_REASON_CODES } from '../analysis/types.ts'

/**
 * Shared shape for validators that accept a trace or a raw record.
 *
 * The two arms are both live and neither is redundant. validDecisionTrace is a
 * type guard over `unknown`, so it narrows to a raw record and hands that to
 * these helpers; the post-admission callers already hold a DecisionTrace and
 * hand that to the same helpers. Collapsing the union to DecisionTrace would
 * assert validity inside the code whose job is to establish it, and collapsing
 * it to Record<string, unknown> only moves the casts out to the call sites.
 * Both were compiled: 9 errors and 14 errors respectively, not zero either way.
 * The field-level casts these helpers carry are the cost of that honesty, not
 * an oversight; ROADMAP item 18 holds the parse-don't-validate rewrite that
 * would actually retire them.
 */
export type TraceValidationInput = Record<string, unknown> | DecisionTrace

/**
 * A runtime key list bound to the compile-time shape it guards. Every entry has
 * to name a real key of `T`, so renaming or removing a field on `T` turns its
 * stale string here into a type error instead of a silently dropped check.
 */
export type ExactKeyList<T> = readonly (keyof T & string)[]

/**
 * Keys of `T` that `List` fails to name, or `never` when the list is complete.
 * Pair it with `NoMissingKeys` to bind the two directions at once: `ExactKeyList`
 * rejects keys that do not exist, this rejects keys that were never listed.
 */
export type MissingKeys<T, List extends readonly PropertyKey[]> =
  Exclude<keyof T & string, List[number]>

/** Keys of `T` the shape declares as mandatory, computed from `T` itself. */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T] & string

/**
 * Like `MissingKeys`, restricted to the mandatory keys of `T`. Validators that
 * check presence for required fields and value shape for optional ones separately
 * bind their presence list with this.
 */
export type MissingRequiredKeys<T, List extends readonly PropertyKey[]> =
  Exclude<RequiredKeys<T>, List[number]>

/**
 * Type-level assertion that a key list is exhaustive. Instantiating it with a
 * leftover key fails the `never` constraint, and the compiler names the missing
 * field in the error, so adding a field to a validated shape cannot pass review
 * without also extending the validator that guards it.
 */
export type NoMissingKeys<Leftover extends never> = Leftover

/**
 * The first key `List` repeats, or `never` when every entry is distinct. Walks
 * the tuple accumulating what it has already seen, so it only resolves for a
 * literal tuple (an `as const` list); a widened `string[]` yields `never`.
 */
export type DuplicateKeys<
  List extends readonly PropertyKey[],
  Seen = never,
> = List extends readonly [
  infer Head,
  ...infer Rest extends readonly PropertyKey[],
]
  ? Head extends Seen
    ? Head
    : DuplicateKeys<Rest, Seen | Head>
  : never

/**
 * Type-level assertion that a key list repeats nothing. Duplicates are harmless
 * for the membership checks but not for the Morgana call site, which compares
 * the assembled list length against the trace's own key count: one repeated
 * entry inflates the length and refuses every otherwise valid trace.
 */
export type NoDuplicateKeys<Repeated extends never> = Repeated

export function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function enumStringArray(
  value: unknown,
  allowed: readonly string[],
): value is readonly string[] {
  const choices = new Set(allowed)
  return stringArray(value) && value.every((entry) => choices.has(entry))
}

export function validForcedPolicyResult(
  value: unknown,
): value is ForcedPolicyResult | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const forced = value as Record<string, unknown>
  const allowed = stringArray(forced.allowedCandidateIds)
    ? forced.allowedCandidateIds
    : undefined
  return (
    forced.version === FORCED_POLICY_VERSION
    && typeof forced.applied === 'boolean'
    && enumStringArray(forced.reasonCodes, FORCED_PLAY_REASON_CODES)
    && allowed !== undefined
    && allowed.length > 0
    && new Set(allowed).size === allowed.length
    && (
      forced.selectedCandidateId === undefined
      || (
        typeof forced.selectedCandidateId === 'string'
        && allowed.includes(forced.selectedCandidateId)
      )
    )
    && (
      forced.applied
        ? (forced.reasonCodes as readonly string[]).length > 0
        : (
            (forced.reasonCodes as readonly string[]).length === 0
            && forced.selectedCandidateId === undefined
          )
    )
  )
}
