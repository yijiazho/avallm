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
import type {
  DecisionCandidateBoundary,
} from '../../server/agents/policy/decision-layer/types.ts'

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
  completion: Omit<ScoreLayerRunCompletion, 'candidateBoundary'> & {
    readonly candidateBoundary?: DecisionCandidateBoundary
  },
): ScoreLayerRun {
  return executePreparedScoreLayerRun(lease, {
    ...completion,
    candidateBoundary: completion.candidateBoundary ?? {
      survivorCandidateIds: completion.forced.allowedCandidateIds,
      selectedCandidateId: completion.forced.selectedCandidateId,
      reasonCodes: completion.forced.reasonCodes,
    },
  })
}
