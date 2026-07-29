import { isDeepStrictEqual } from 'node:util'
import type {
  NativeScoreLayersResolvedDecisionFrame,
  ScoredDecisionFrame,
} from '../policy/decision-frame.ts'

const OUT_OF_SCOPE_REASONS = new Set([
  'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
  'GOOD_POLICY_OUT_OF_SCOPE_COMPATIBILITY',
])

const DIAGNOSTIC_SAMPLE_LIMIT = 32
const DIAGNOSTIC_JSON_BYTES = 8 * 1024

function sample<T>(values: readonly T[]): {
  readonly count: number
  readonly values: readonly T[]
  readonly omitted: number
} {
  const sampled = values.slice(0, DIAGNOSTIC_SAMPLE_LIMIT)
  return {
    count: values.length,
    values: sampled,
    omitted: values.length - sampled.length,
  }
}

function firstDifference(
  native: NativeScoreLayersResolvedDecisionFrame,
  legacyRows: readonly {
    readonly candidateId: string
    readonly value: number
    readonly viable: boolean
    readonly reasonCodes: readonly string[]
  }[],
  legacy: ScoredDecisionFrame,
): Readonly<Record<string, unknown>> {
  const rowCount = Math.max(native.scores.length, legacyRows.length)
  for (let index = 0; index < rowCount; index++) {
    if (!isDeepStrictEqual(native.scores[index], legacyRows[index])) {
      return {
        field: 'scores',
        index,
        candidateId:
          native.scores[index]?.candidateId
          ?? legacyRows[index]?.candidateId
          ?? null,
        native: native.scores[index] ?? null,
        legacy: legacyRows[index] ?? null,
      }
    }
  }
  if (!isDeepStrictEqual(
    native.survivorCandidateIds,
    legacy.effectiveForced.allowedCandidateIds,
  )) {
    return {
      field: 'survivorCandidateIds',
      native: sample(native.survivorCandidateIds),
      legacy: sample(legacy.effectiveForced.allowedCandidateIds),
    }
  }
  if (native.structuredCandidateId !== legacy.structuredCandidateId) {
    return {
      field: 'structuredCandidateId',
      native: native.structuredCandidateId,
      legacy: legacy.structuredCandidateId,
    }
  }
  return {
    field: 'componentRun.policyUse',
    native: sample(native.componentRun.policyUse),
    legacy: sample(legacy.componentRun.policyUse),
  }
}

function boundedDiagnostic(value: Readonly<Record<string, unknown>>): string {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') <= DIAGNOSTIC_JSON_BYTES) {
    return serialized
  }
  const preview = serialized.slice(0, DIAGNOSTIC_JSON_BYTES / 2)
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(serialized, 'utf8'),
    preview,
  })
}

/**
 * Temporary A2-A4 equality edge. It projects the feature-rich legacy writer
 * down to the common native mechanics without teaching the native DTO about
 * historical optional fields or out-of-scope attribution-only relabeling.
 */
export function assertGoodScoreLayerLegacyEquality(
  native: NativeScoreLayersResolvedDecisionFrame,
  legacy: ScoredDecisionFrame,
): void {
  const legacyRows = legacy.scores.map((row) => ({
    candidateId: row.candidateId,
    value: row.value,
    viable: row.viable,
    reasonCodes: row.reasonCodes.filter(
      (reason) => !OUT_OF_SCOPE_REASONS.has(reason),
    ),
  }))
  if (
    !isDeepStrictEqual(native.scores, legacyRows)
    || !isDeepStrictEqual(
      native.survivorCandidateIds,
      legacy.effectiveForced.allowedCandidateIds,
    )
    || native.structuredCandidateId !== legacy.structuredCandidateId
    || !isDeepStrictEqual(
      native.componentRun.policyUse,
      legacy.componentRun.policyUse,
    )
  ) {
    throw new Error(
      `native and legacy good score policies diverged: ${boundedDiagnostic({
        firstDifference: firstDifference(native, legacyRows, legacy),
        configuredChain: native.scoreLayerRun.configured,
        nativeJournal: native.scoreLayerRun.journal,
        survivors: {
          native: sample(native.survivorCandidateIds),
          legacy: sample(legacy.effectiveForced.allowedCandidateIds),
        },
        structuredCandidateIds: {
          native: native.structuredCandidateId,
          legacy: legacy.structuredCandidateId,
        },
        componentPolicyUse: {
          native: sample(native.componentRun.policyUse),
          legacy: sample(legacy.componentRun.policyUse),
        },
      })}`,
    )
  }
}
