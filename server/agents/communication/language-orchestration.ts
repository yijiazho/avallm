import type { PlayerView } from '../../engine/types.ts'
import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
  projectLanguageInferenceContext,
  type LanguageInferenceContext,
} from '../belief/language-factor.ts'
import {
  admitLanguageEvidence,
  advanceLanguageEvidenceCursorWithoutEvidence,
  initialLanguageEvidenceCursor,
  projectLanguageInterpreterInput,
} from './language-contract.ts'
import {
  LANGUAGE_CURSOR_VERSION,
  LANGUAGE_INTERPRETER_INPUT_VERSION,
  type LanguageEvidence,
  type LanguageEvidenceCursor,
  type LanguageInterpreter,
  type LanguageInterpreterInput,
} from './language-types.ts'

const INTERPRETER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
export const INVALID_LANGUAGE_INTERPRETER_VERSION =
  'invalid-interpreter-version'

function validInterpreterVersion(value: unknown): value is string {
  return typeof value === 'string'
    && value !== INVALID_LANGUAGE_INTERPRETER_VERSION
    && INTERPRETER_VERSION_PATTERN.test(value)
}

export function normalizeInterpreterVersion(
  value: unknown,
): string {
  return validInterpreterVersion(value)
    ? value
    : INVALID_LANGUAGE_INTERPRETER_VERSION
}

export const LANGUAGE_ORCHESTRATION_DEGRADATIONS = Object.freeze([
  'language-input-failed',
  'language-interpreter-invalid-version',
  'language-interpreter-failed',
  'language-evidence-invalid-output',
] as const)

export type LanguageOrchestrationDegradation =
  typeof LANGUAGE_ORCHESTRATION_DEGRADATIONS[number]

export interface LanguageTraceAttribution {
  inputSchemaVersion: typeof LANGUAGE_INTERPRETER_INPUT_VERSION
  cursorSchemaVersion: typeof LANGUAGE_CURSOR_VERSION
  interpreterVersion: string
  factorVersion: typeof LANGUAGE_LIKELIHOOD_FACTOR_VERSION
  factorBundleVersion: typeof LANGUAGE_FACTOR_BUNDLE_VERSION
  cursorThroughSeq: number
  admittedSourceSeqs: readonly number[]
  cumulativeSourceSeqs: readonly number[]
  degradation: readonly LanguageOrchestrationDegradation[]
}

export interface LanguageOrchestrationResult {
  reads: readonly LanguageEvidence[]
  cursor: LanguageEvidenceCursor
  input?: LanguageInterpreterInput
  inferenceContext?: LanguageInferenceContext
  trace: LanguageTraceAttribution
  /** Convenience mirror of trace.degradation; the trace is authoritative. */
  degradation: readonly LanguageOrchestrationDegradation[]
  /**
   * True when language weighting (inferenceContext) should be applied for this
   * decision. False whenever inferenceContext is omitted, which happens on an
   * input projection failure or an invalid interpreter version.
   */
  applyLanguageWeighting: boolean
}

/** Advance past a validated batch without admitting evidence, keeping only the
 * resulting cursor (the evidence on this path is always empty). */
function cursorOnly(
  input: LanguageInterpreterInput,
  cursor: LanguageEvidenceCursor,
): LanguageEvidenceCursor {
  return advanceLanguageEvidenceCursorWithoutEvidence(input, cursor).cursor
}

function appendCanonicalReads(
  prior: readonly LanguageEvidence[],
  admitted: readonly LanguageEvidence[],
): readonly LanguageEvidence[] {
  const reads = structuredClone([...prior, ...admitted])
    .sort((left, right) => left.sourceSeq - right.sourceSeq)
  if (new Set(reads.map((read) => read.sourceSeq)).size !== reads.length) {
    throw new Error('language orchestration produced duplicate evidence')
  }
  return reads
}

function attribution(
  interpreterVersion: string,
  cursor: LanguageEvidenceCursor,
  admitted: readonly LanguageEvidence[],
  reads: readonly LanguageEvidence[],
  degradation: readonly LanguageOrchestrationDegradation[],
): LanguageTraceAttribution {
  return {
    inputSchemaVersion: LANGUAGE_INTERPRETER_INPUT_VERSION,
    cursorSchemaVersion: LANGUAGE_CURSOR_VERSION,
    interpreterVersion,
    factorVersion: LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
    factorBundleVersion: LANGUAGE_FACTOR_BUNDLE_VERSION,
    cursorThroughSeq: cursor.throughSeq,
    admittedSourceSeqs: admitted.map((read) => read.sourceSeq),
    cumulativeSourceSeqs: reads.map((read) => read.sourceSeq),
    degradation: [...degradation],
  }
}

/**
 * Collect one public-language batch. This boundary does no belief arithmetic
 * and never receives raw Game state.
 */
export async function orchestrateLanguageEvidence(
  view: PlayerView,
  prior: {
    languageReads?: readonly LanguageEvidence[]
    languageCursor?: LanguageEvidenceCursor
  } | undefined,
  interpreter: LanguageInterpreter,
  expectedInterpreterVersion: unknown = interpreter.interpreterVersion,
): Promise<LanguageOrchestrationResult> {
  const reads = prior?.languageReads ?? []
  const cursor = prior?.languageCursor ?? initialLanguageEvidenceCursor()
  // The interpreter reports its own version; the caller pins the version it
  // expects (defaulting to the reported one). We admit evidence only when both
  // are well-formed and they agree, so the mismatch check below is dormant
  // unless a caller overrides expectedInterpreterVersion to detect drift.
  const interpreterVersion: unknown = interpreter.interpreterVersion
  const traceInterpreterVersion =
    normalizeInterpreterVersion(expectedInterpreterVersion)
  let input: LanguageInterpreterInput
  try {
    input = projectLanguageInterpreterInput(view, cursor)
  } catch {
    const degradation = ['language-input-failed'] as const
    return {
      reads: structuredClone(reads),
      cursor: structuredClone(cursor),
      trace: attribution(
        traceInterpreterVersion,
        cursor,
        [],
        reads,
        degradation,
      ),
      degradation,
      applyLanguageWeighting: false,
    }
  }

  let admitted: readonly LanguageEvidence[] = []
  let nextCursor: LanguageEvidenceCursor
  const degradation: LanguageOrchestrationDegradation[] = []
  if (
    !validInterpreterVersion(interpreterVersion)
    || !validInterpreterVersion(expectedInterpreterVersion)
    || interpreterVersion !== expectedInterpreterVersion
  ) {
    degradation.push('language-interpreter-invalid-version')
    nextCursor = cursorOnly(input, cursor)
  } else if (input.newUtterances.length === 0) {
    nextCursor = cursorOnly(input, cursor)
  } else {
    let raw: unknown
    try {
      raw = await interpreter.interpret(structuredClone(input))
    } catch {
      degradation.push('language-interpreter-failed')
      nextCursor = cursorOnly(input, cursor)
      const nextReads = appendCanonicalReads(reads, admitted)
      return {
        reads: nextReads,
        cursor: nextCursor,
        input,
        inferenceContext: projectLanguageInferenceContext(
          view.seat,
          input,
          expectedInterpreterVersion,
        ),
        trace: attribution(
          traceInterpreterVersion,
          nextCursor,
          admitted,
          nextReads,
          degradation,
        ),
        degradation,
        applyLanguageWeighting: true,
      }
    }
    try {
      const admission = admitLanguageEvidence(
        raw,
        input,
        cursor,
        interpreterVersion,
      )
      admitted = admission.evidence
      nextCursor = admission.cursor
    } catch {
      degradation.push('language-evidence-invalid-output')
      nextCursor = cursorOnly(input, cursor)
    }
  }

  const nextReads = appendCanonicalReads(reads, admitted)
  return {
    reads: nextReads,
    cursor: nextCursor,
    input,
    ...(validInterpreterVersion(expectedInterpreterVersion)
      ? {
          inferenceContext: projectLanguageInferenceContext(
            view.seat,
            input,
            expectedInterpreterVersion,
          ),
        }
      : {}),
    trace: attribution(
      traceInterpreterVersion,
      nextCursor,
      admitted,
      nextReads,
      degradation,
    ),
    degradation,
    applyLanguageWeighting: validInterpreterVersion(expectedInterpreterVersion),
  }
}
