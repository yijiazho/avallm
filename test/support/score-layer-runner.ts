import {
  executePreparedScoreLayerRun,
  prepareScoreLayerRunLease,
} from '../../server/agents/policy/score-layer/runner.ts'
import type {
  ScoreLayerRun,
  ScoreLayerRunCompletion,
  ScoreLayerRunLease,
  ScoreLayerRunPreparation,
} from '../../server/agents/policy/score-layer/types.ts'

/**
 * Explicit low-level seam for generic kernel laws. Production policy must
 * enter through the staged DecisionFrame lease.
 */
export function prepareScoreLayerRunForTest(
  preparation: ScoreLayerRunPreparation,
): ScoreLayerRunLease {
  return prepareScoreLayerRunLease(preparation)
}

export function runPreparedScoreLayersForTest(
  lease: ScoreLayerRunLease,
  completion: ScoreLayerRunCompletion,
): ScoreLayerRun {
  return executePreparedScoreLayerRun(lease, completion)
}
