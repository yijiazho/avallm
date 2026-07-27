import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from './types.ts'

export const CANDIDATE_SCORER_VERSION = 'compatibility-scorer-v1'
export const GOOD_PROPOSAL_SCORER_VERSION = 'good-proposal-scorer-v1'
export const GOOD_PROPOSAL_FEATURE_VERSION = 'good-proposal-features-v1'

export const GOOD_PROPOSAL_REASON_CODES = [
  'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
  'GOOD_PROPOSAL_MAX_TEAM_CLEAN',
  'GOOD_PROPOSAL_CANONICAL_TIE_BREAK',
  'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
] as const
export type GoodProposalReasonCode =
  typeof GOOD_PROPOSAL_REASON_CODES[number]

/**
 * The score's decision-ready posterior projection. Phase 4A deliberately
 * names the current uniform-feasible semantics rather than implying that the
 * hard-constraint posterior is behaviorally calibrated.
 */
export interface GoodProposalFeatures {
  version: typeof GOOD_PROPOSAL_FEATURE_VERSION
  semantics: 'uniform-feasible-joint'
  beliefModelVersion: string
  beliefThroughSeq: number
  team: readonly number[]
  cleanProbability: number
  evilCountDistribution: readonly number[]
}

export interface CandidateScore {
  version: string
  candidateId: string
  value: number
  viable: boolean
  reasonCodes: readonly string[]
  features?: GoodProposalFeatures
}

export type ScorerAnalysisRequirement =
  | 'joint-proposal-team-assessments'

export interface CandidateScorer {
  version: string
  analysisRequirement?: ScorerAnalysisRequirement
  score(context: CandidateScoringContext): readonly CandidateScore[]
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
}

function validGoodProposalFeatures(
  features: GoodProposalFeatures,
  context: CandidateScoringContext,
  candidate: PolicyCandidate,
): boolean {
  const decision = candidate.decision
  if (decision.kind !== 'propose') return false
  const assessment = context.analysis.policyCandidateAssessments.find(
    (candidateAssessment) =>
      candidateAssessment.candidateId === candidate.id,
  )
  if (
    !assessment
    || features.version !== GOOD_PROPOSAL_FEATURE_VERSION
    || features.semantics !== 'uniform-feasible-joint'
    || features.beliefModelVersion !== assessment.beliefModelVersion
    || features.beliefThroughSeq !== assessment.beliefThroughSeq
    || features.beliefThroughSeq !== context.analysis.throughSeq
    || !Array.isArray(features.team)
    || features.team.some((seat) => !Number.isInteger(seat))
    || features.team.length !== decision.team.length
    || features.team.some((seat, index) =>
      seat !== [...decision.team].sort((a, b) => a - b)[index])
    || !validProbability(features.cleanProbability)
    || !Array.isArray(features.evilCountDistribution)
    || features.evilCountDistribution.length !== decision.team.length + 1
    || features.evilCountDistribution.length
      !== assessment.evilCountDistribution.length
    || features.evilCountDistribution.some((value) => !validProbability(value))
    || features.evilCountDistribution.some(
      (value, index) =>
        Math.abs(value - assessment.evilCountDistribution[index]) > 1e-12,
    )
  ) {
    return false
  }
  const total = features.evilCountDistribution.reduce(
    (sum, value) => sum + value,
    0,
  )
  return Math.abs(total - 1) <= 1e-9
    && Math.abs(
      features.cleanProbability - features.evilCountDistribution[0],
    ) <= 1e-12
    && Math.abs(
      features.cleanProbability - assessment.cleanProbability,
    ) <= 1e-12
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
  const candidatesById = new Map(
    context.candidates.map((candidate) => [candidate.id, candidate]),
  )
  const allowed = new Set(context.forced.allowedCandidateIds)
  const goodProposalSemantics =
    scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
    && context.request.kind === 'propose'
    && context.view.alignment === 'good'
  const seen = new Set<string>()
  for (const score of scores) {
    const forcedAllowed = allowed.has(score.candidateId)
    const validGoodSemantics = !goodProposalSemantics || (
      score.features !== undefined
      && score.viable === forcedAllowed
      && score.value === (
        forcedAllowed
          ? score.features.cleanProbability
          : -Number.MAX_SAFE_INTEGER
      )
    )
    if (
      score.version !== scorerVersion
      || !candidateIds.has(score.candidateId)
      || seen.has(score.candidateId)
      || !Number.isFinite(score.value)
      || typeof score.viable !== 'boolean'
      || !Array.isArray(score.reasonCodes)
      || score.reasonCodes.some((reason) => typeof reason !== 'string')
      || (
        score.features !== undefined
        && !validGoodProposalFeatures(
          score.features,
          context,
          candidatesById.get(score.candidateId)!,
        )
      )
      || !validGoodSemantics
      || (
        scorerVersion !== GOOD_PROPOSAL_SCORER_VERSION
        && score.features !== undefined
      )
      || (
        scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
        && !goodProposalSemantics
        && score.features !== undefined
      )
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
  return viable.reduce((best, score) =>
    score.value > best.value
      || (
        score.value === best.value
        && score.candidateId < best.candidateId
      )
      ? score
      : best)
}

/**
 * Opt-in Phase 4A policy. Good-side proposal values are exact joint
 * P(no evil aboard) under the current hard-constraint posterior. The batch
 * world-mask projection keeps the 10-player, 252-team surface inexpensive.
 *
 * All forced-policy candidates remain viable in 4A. Dominance bands and
 * seeded variation belong to 4B. Every other request delegates to the frozen
 * compatibility choice while retaining truthful scorer attribution.
 */
export function scoreGoodProposalCandidates(
  context: CandidateScoringContext,
): readonly CandidateScore[] {
  if (
    context.request.kind !== 'propose'
    || context.view.alignment !== 'good'
  ) {
    return scoreCandidates(context).map((score) => ({
      ...score,
      version: GOOD_PROPOSAL_SCORER_VERSION,
      reasonCodes: [
        ...score.reasonCodes,
        'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
      ],
    }))
  }

  const allowed = new Set(context.forced.allowedCandidateIds)
  const assessments = new Map(
    context.analysis.policyCandidateAssessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    assessments.size
    !== context.analysis.policyCandidateAssessments.length
    || assessments.size !== context.candidates.length
  ) {
    throw new Error(
      'good proposal scorer requires one unique assessment per candidate',
    )
  }
  const scored = context.candidates.map((candidate): CandidateScore => {
    if (candidate.decision.kind !== 'propose') {
      throw new Error('good proposal scorer received a mixed candidate surface')
    }
    const team = [...candidate.decision.team].sort((a, b) => a - b)
    const assessment = assessments.get(candidate.id)
    if (
      !assessment
      || assessment.team.length !== team.length
      || assessment.team.some((seat, index) => seat !== team[index])
    ) {
      throw new Error(
        `good proposal scorer assessment mismatch for ${candidate.id}`,
      )
    }
    const cleanProbability = assessment.cleanProbability
    const viable = allowed.has(candidate.id)
    return {
      version: GOOD_PROPOSAL_SCORER_VERSION,
      candidateId: candidate.id,
      value: viable ? cleanProbability : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: [
        ...(viable ? ['FORCED_POLICY_ALLOWED'] : ['FORCED_POLICY_REMOVED']),
        'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
      ],
      features: {
        version: GOOD_PROPOSAL_FEATURE_VERSION,
        semantics: 'uniform-feasible-joint',
        beliefModelVersion: assessment.beliefModelVersion,
        beliefThroughSeq: assessment.beliefThroughSeq,
        team,
        cleanProbability,
        evilCountDistribution: assessment.evilCountDistribution,
      },
    }
  })

  const viable = scored.filter((score) => score.viable)
  if (!viable.length) {
    throw new Error('good proposal scorer received no forced-policy candidates')
  }
  const bestValue = Math.max(...viable.map((score) => score.value))
  const bestIds = viable
    .filter((score) => score.value === bestValue)
    .map((score) => score.candidateId)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  return scored.map((score) => ({
    ...score,
    reasonCodes: [
      ...score.reasonCodes,
      ...(score.viable && score.value === bestValue
        ? ['GOOD_PROPOSAL_MAX_TEAM_CLEAN']
        : []),
      ...(bestIds.length > 1 && score.candidateId === bestIds[0]
        ? ['GOOD_PROPOSAL_CANONICAL_TIE_BREAK']
        : []),
    ],
  }))
}

/** Structural scorer plugin for `createComposedAgent({ scorer })`. */
export const goodProposalScorer = Object.freeze({
  version: GOOD_PROPOSAL_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-team-assessments' as const,
  score: scoreGoodProposalCandidates,
})
