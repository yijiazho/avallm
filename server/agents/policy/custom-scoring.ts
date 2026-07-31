import {
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
  type CustomCandidateScorer,
} from './score.ts'
import { validateCandidateScores } from './candidate-score-validation.ts'

export interface CustomScoreResult {
  readonly appliedScorer: CandidateScorer
  readonly scores: readonly CandidateScore[]
  readonly degradation: readonly string[]
}

function score(
  scorer: CustomCandidateScorer,
  context: Readonly<CandidateScoringContext>,
): readonly CandidateScore[] {
  const supplied = scorer.score(structuredClone(context))
  validateCandidateScores(context, supplied, scorer.version)
  return structuredClone(supplied)
}

/**
 * Quarantined boundary for one caller-supplied scorer attempt. Failure is
 * deliberately propagated so composition can enter the already prepared
 * canonical native fallback chain.
 */
export function executeCustomScores(
  context: Readonly<CandidateScoringContext>,
  configured: CustomCandidateScorer,
): CustomScoreResult {
  return {
    appliedScorer: configured,
    scores: score(configured, context),
    // Always empty: a failed attempt throws (see `score`) rather than degrading
    // in place, and the fallback chain records degradation as it advances.
    degradation: [],
  }
}
