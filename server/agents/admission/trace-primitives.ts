// Small shared shapes and predicates used by both the generic composed-trace
// admission owner and the isolated role-trace-v1 reader. Extracted so the v1
// role reader needs no import back into the generic owner.

import type { DecisionTrace } from '../trace.ts'
import type { ForcedPolicyResult } from '../policy/types.ts'
import { FORCED_POLICY_VERSION } from '../policy/types.ts'
import { FORCED_PLAY_REASON_CODES } from '../analysis/situation-types.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../belief/types.ts'

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
 * The component-version map a trace declares, read at the untrusted-JSON cast
 * both admission owners share. Kept as one helper so the `as Record` target is
 * written once rather than at every role/generic call site.
 */
export function componentVersionsOf(
  trace: TraceValidationInput,
): Record<string, unknown> | undefined {
  return trace.componentVersions as Record<string, unknown> | undefined
}

/**
 * The recurring "exact belief, no language evidence, no factors" triple that
 * marks a trace as reconstructable from the exact constraint model alone. The
 * three checks are a conjunction, so their source order never mattered; this
 * fixes one order. Component properties are read as `unknown` so a raw-record
 * map and a typed componentVersions object both satisfy the parameter.
 */
export function isExactNonLanguage(
  components:
    | {
        readonly belief?: unknown
        readonly languageEvidence?: unknown
        readonly factors?: unknown
      }
    | undefined,
): boolean {
  return (
    components?.belief === EXACT_BELIEF_MODEL_VERSION
    && components?.languageEvidence === 'off'
    && components?.factors === 'off'
  )
}

/**
 * The degradation codes a trace carries, coerced from untrusted JSON: the same
 * array reference when it is an array, otherwise an empty list. Element typing
 * matches the existing string-code reads (`includes`/`every` over string codes).
 */
export function degradationCodes(trace: TraceValidationInput): readonly string[] {
  return Array.isArray(trace.degradation)
    ? trace.degradation as readonly string[]
    : []
}

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
