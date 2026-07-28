import {
  CANDIDATE_SCORER_VERSION,
  scoreCandidates,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './score.ts'

export interface LegacyScorerFallback {
  readonly scorer: CandidateScorer
  readonly degradationCode: string
}

export interface LegacyScoreResult {
  readonly appliedScorer: CandidateScorer
  readonly scores: readonly CandidateScore[]
  readonly degradation: readonly string[]
}

function score(
  scorer: CandidateScorer,
  context: Readonly<CandidateScoringContext>,
): readonly CandidateScore[] {
  const supplied = scorer.score(structuredClone(context))
  validateCandidateScores(context, supplied, scorer.version)
  return structuredClone(supplied)
}

/**
 * Compatibility quarantine for the old scorer degradation chain.
 * DecisionFrame owns the scoring context and admits the returned surface.
 */
export function resolveLegacyScores(
  context: Readonly<CandidateScoringContext>,
  configured: CandidateScorer,
  fallback?: LegacyScorerFallback,
): LegacyScoreResult {
  try {
    return {
      appliedScorer: configured,
      scores: score(configured, context),
      degradation: [],
    }
  } catch {
    const degradation = ['scorer-invalid-output']
    if (fallback) {
      degradation.push(fallback.degradationCode)
      try {
        return {
          appliedScorer: fallback.scorer,
          scores: score(fallback.scorer, context),
          degradation,
        }
      } catch {
        degradation.push('base-scorer-invalid-output')
      }
    }
    const appliedScorer: CandidateScorer = {
      version: CANDIDATE_SCORER_VERSION,
      score: scoreCandidates,
    }
    const scores = scoreCandidates(context)
    validateCandidateScores(context, scores, CANDIDATE_SCORER_VERSION)
    return { appliedScorer, scores, degradation }
  }
}
