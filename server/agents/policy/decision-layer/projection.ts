import type {
  DecisionLayerRun,
  DecisionLayerTrace,
} from './types.ts'

/** Keep component payload state single-owned by DecisionTrace.components. */
export function projectDecisionLayerRun(
  run: DecisionLayerRun,
): DecisionLayerTrace {
  return structuredClone({
    version: run.version,
    configured: run.configured,
    journal: run.journal,
    surface: run.surface,
    operations: run.operations,
  }) as DecisionLayerTrace
}
