import type {
  ScoreLayerRun,
  ScoreLayerTrace,
} from './types.ts'

/** Keep component payload state single-owned by DecisionTrace.components. */
export function projectScoreLayerRun(
  run: ScoreLayerRun,
): ScoreLayerTrace {
  return structuredClone({
    version: run.version,
    configured: run.configured,
    journal: run.journal,
    surface: run.surface,
    operations: run.operations,
  }) as ScoreLayerTrace
}
