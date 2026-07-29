// Small shared shapes and predicates used by both the generic composed-trace
// admission owner and the isolated legacy v1 role reader. Extracted so the
// legacy reader needs no import back into the generic owner.

import type { DecisionTrace } from '../trace.ts'
import type { ForcedPolicyResult } from '../policy/types.ts'
import { FORCED_POLICY_VERSION } from '../policy/types.ts'
import { FORCED_PLAY_REASON_CODES } from '../analysis/types.ts'

/** Shared shape for validators that accept a trace or a raw record. */
export type TraceValidationInput = Record<string, unknown> | DecisionTrace

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
