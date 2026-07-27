import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from './types.ts'

export const CANDIDATE_SCORER_VERSION = 'compatibility-scorer-v1'

export interface CandidateScore {
  version: string
  candidateId: string
  value: number
  viable: boolean
  reasonCodes: readonly string[]
}

/**
 * Enforce the scorer/plugin boundary. A scorer may remove additional
 * dominated candidates, but it cannot reopen a forced-policy removal or
 * change the legal candidate surface.
 */
export function validateCandidateScores(
  context: CandidateScoringContext,
  scores: readonly CandidateScore[],
  scorerVersion: string,
): void {
  if (typeof scorerVersion !== 'string' || !scorerVersion.trim()) {
    throw new Error('candidate scorer must have a non-empty version')
  }
  if (scores.length !== context.candidates.length) {
    throw new Error('candidate scorer did not score the complete legal surface')
  }
  const candidateIds = new Set(
    context.candidates.map((candidate) => candidate.id),
  )
  const allowed = new Set(context.forced.allowedCandidateIds)
  const seen = new Set<string>()
  for (const score of scores) {
    if (
      score.version !== scorerVersion
      || !candidateIds.has(score.candidateId)
      || seen.has(score.candidateId)
      || !Number.isFinite(score.value)
      || typeof score.viable !== 'boolean'
      || !Array.isArray(score.reasonCodes)
      || score.reasonCodes.some((reason) => typeof reason !== 'string')
      || (score.viable && !allowed.has(score.candidateId))
    ) {
      throw new Error(`invalid candidate score for ${score.candidateId}`)
    }
    seen.add(score.candidateId)
  }
  const viable = scores.filter((score) => score.viable)
  if (!viable.length) {
    throw new Error('candidate scorer removed every forced-policy candidate')
  }
  if (
    context.forced.selectedCandidateId
    && !viable.some(
      (score) => score.candidateId === context.forced.selectedCandidateId,
    )
  ) {
    throw new Error('candidate scorer removed the forced selection')
  }
}

export interface CandidateScoringContext {
  request: DecisionRequest
  view: PlayerView
  analysis: SituationAnalysis
  candidates: readonly PolicyCandidate[]
  forced: ForcedPolicyResult
  compatibilityCandidateId?: string
}

/**
 * Phase 3 scorer. It deliberately preserves a supplied compatibility choice
 * and otherwise uses canonical candidate order. Belief-driven utility belongs
 * to Phase 4; this seam makes that future scorer replaceable and attributable.
 */
export function scoreCandidates(
  context: CandidateScoringContext,
): readonly CandidateScore[] {
  const allowed = new Set(context.forced.allowedCandidateIds)
  return context.candidates.map((candidate, index): CandidateScore => {
    const viable = allowed.has(candidate.id)
    const compatibility = candidate.id === context.compatibilityCandidateId
    return {
      version: CANDIDATE_SCORER_VERSION,
      candidateId: candidate.id,
      value: viable
        ? (compatibility ? 1_000_000 : -index)
        : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: [
        ...(viable ? ['FORCED_POLICY_ALLOWED'] : ['FORCED_POLICY_REMOVED']),
        ...(compatibility ? ['COMPATIBILITY_CHOICE'] : []),
      ],
    }
  })
}

export function structuredChoice(
  scores: readonly CandidateScore[],
): CandidateScore {
  const viable = scores.filter((score) => score.viable)
  if (!viable.length) throw new Error('candidate scorer produced no viable choice')
  return viable.reduce((best, score) => score.value > best.value ? score : best)
}
