export interface CompatibilityCandidate {
  readonly id: string
}

export interface CompatibilityRow {
  readonly candidateId: string
  readonly value: number
  readonly viable: boolean
  readonly reasonCodes: readonly string[]
}

export interface CompatibilityBaseContext {
  readonly candidates: readonly CompatibilityCandidate[]
  readonly allowedCandidateIds: readonly string[]
  readonly compatibilityCandidateId?: string
}

/**
 * The one deterministic compatibility-base calculator shared by the native
 * root and the external/custom-scorer fallback boundary.
 */
export function calculateCompatibilityBase(
  context: CompatibilityBaseContext,
): readonly CompatibilityRow[] {
  const allowed = new Set(context.allowedCandidateIds)
  return Object.freeze(context.candidates.map((candidate, index) => {
    const viable = allowed.has(candidate.id)
    const compatibility =
      candidate.id === context.compatibilityCandidateId
    return Object.freeze({
      candidateId: candidate.id,
      value: viable
        ? (compatibility ? 1_000_000 : -index)
        : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: Object.freeze([
        viable ? 'FORCED_POLICY_ALLOWED' : 'FORCED_POLICY_REMOVED',
        ...(compatibility ? ['COMPATIBILITY_CHOICE'] : []),
      ]),
    })
  }))
}
