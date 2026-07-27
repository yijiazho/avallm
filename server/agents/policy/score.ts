import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
  type JointProbabilitySemantics,
  type SituationAnalysis,
} from '../analysis/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from './types.ts'

export const CANDIDATE_SCORER_VERSION = 'compatibility-scorer-v1'
export const GOOD_PROPOSAL_SCORER_VERSION = 'good-proposal-scorer-v1'
export const GOOD_PROPOSAL_FEATURE_VERSION = 'good-proposal-features-v1'
export const GOOD_PROPOSAL_VOTE_SCORER_VERSION =
  'good-proposal-vote-scorer-v1'
export const GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION =
  'good-proposal-vote-seeded-band-v1'
export const GOOD_VOTE_FEATURE_VERSION = 'good-vote-features-v1'
export const GOOD_VOTE_UTILITY_VERSION = 'good-vote-utility-v1'

export const GOOD_VOTE_UTILITY_CONSTANTS = Object.freeze({
  matchPointStakeBonus: 0.5,
  alternativeRealizationBase: 0.72,
  alternativeRealizationPerRejection: 0.07,
  hammerPenaltyScale: 0.18,
  nextHammerPenalty: 0.12,
  informationBonusScale: 0.03,
  viableBand: 0.04,
})

export const GOOD_PROPOSAL_REASON_CODES = [
  'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
  'GOOD_PROPOSAL_MAX_TEAM_CLEAN',
  'GOOD_PROPOSAL_CANONICAL_TIE_BREAK',
  'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
] as const
export type GoodProposalReasonCode =
  typeof GOOD_PROPOSAL_REASON_CODES[number]

export const GOOD_VOTE_REASON_CODES = [
  'GOOD_VOTE_CURRENT_TEAM_JOINT_CLEAN',
  'GOOD_VOTE_BEST_ALTERNATIVE_JOINT_CLEAN',
  'GOOD_VOTE_BOARD_STAKES',
  'GOOD_VOTE_PROPOSAL_RUNWAY',
  'GOOD_VOTE_HAMMER_RISK',
  'GOOD_VOTE_INFORMATION_FUTURE_QUEST',
  'GOOD_VOTE_TOP_UTILITY',
  'GOOD_VOTE_SEEDED_VIABLE_BAND',
  'GOOD_POLICY_OUT_OF_SCOPE_COMPATIBILITY',
] as const

export type GoodVoteSelectionMode = 'top-utility' | 'seeded-band'

/**
 * The score's decision-ready posterior projection. Phase 4A deliberately
 * names whether the joint posterior is uniform-feasible or factor-weighted.
 */
export interface GoodProposalFeatures {
  version: typeof GOOD_PROPOSAL_FEATURE_VERSION
  semantics: JointProbabilitySemantics
  beliefModelVersion: string
  beliefThroughSeq: number
  team: readonly number[]
  cleanProbability: number
  evilCountDistribution: readonly number[]
}

export interface GoodVoteFeatures {
  version: typeof GOOD_VOTE_FEATURE_VERSION
  utilityVersion: typeof GOOD_VOTE_UTILITY_VERSION
  situationVersion: typeof GOOD_VOTE_SITUATION_VERSION
  semantics: JointProbabilitySemantics
  beliefModelVersion: string
  beliefThroughSeq: number
  currentTeam: readonly number[]
  currentCleanProbability: number
  currentEvilCountDistribution: readonly number[]
  bestAlternativeCandidateId: string
  bestAlternativeTeam: readonly number[]
  bestAlternativeCleanProbability: number
  bestAlternativeEvilCountDistribution: readonly number[]
  boardScore: Readonly<{ good: number; evil: number }>
  proposalNumber: number
  rejectionsBeforeHammer: number
  futureQuestsRemain: boolean
  stake: number
  alternativeRealization: number
  hammerPenalty: number
  informationBonus: number
  approveUtility: number
  rejectUtility: number
  baseUtility: number
  selectionAdjustment: number
  selectionMode: GoodVoteSelectionMode
  viableBand: number
  inViableBand: boolean
  /** Present only for seeded-band selection while the choice is in-band. */
  seedBucket?: 0 | 1
}

export interface CandidateScore {
  version: string
  candidateId: string
  value: number
  viable: boolean
  reasonCodes: readonly string[]
  features?: GoodProposalFeatures | GoodVoteFeatures
}

export type ScorerAnalysisRequirement =
  | 'joint-proposal-team-assessments'
  | 'joint-proposal-vote-team-assessments'

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
    || features.semantics !== assessment.probabilitySemantics
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

const canonicalTeam = (team: readonly number[]): readonly number[] =>
  [...team].sort((left, right) => left - right)

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameDistribution(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length
    && left.every(
      (value, index) => Math.abs(value - right[index]) <= 1e-12,
    )
}

interface GoodVoteUtility {
  currentTeam: readonly number[]
  currentCleanProbability: number
  currentEvilCountDistribution: readonly number[]
  bestAlternativeCandidateId: string
  bestAlternativeTeam: readonly number[]
  bestAlternativeCleanProbability: number
  bestAlternativeEvilCountDistribution: readonly number[]
  futureQuestsRemain: boolean
  stake: number
  alternativeRealization: number
  hammerPenalty: number
  informationBonus: number
  approveUtility: number
  rejectUtility: number
}

function goodVoteUtility(context: CandidateScoringContext): GoodVoteUtility {
  const projection = context.analysis.goodVote
  const surface = context.hypotheticalTeamCandidates
  if (
    context.request.kind !== 'vote'
    || context.view.alignment !== 'good'
    || !projection
    || projection.version !== GOOD_VOTE_SITUATION_VERSION
    || !['uniform-feasible-joint', 'weighted-joint'].includes(
      projection.probabilitySemantics,
    )
    || projection.beliefModelVersion !== context.analysis.goodVote?.beliefModelVersion
    || projection.beliefThroughSeq !== context.analysis.throughSeq
    || !surface?.length
    || !context.view.currentTeam?.length
  ) {
    throw new Error('good vote scorer requires a complete vote projection')
  }

  const expected = new Map<string, readonly number[]>()
  for (const candidate of surface) {
    if (candidate.decision.kind !== 'propose' || expected.has(candidate.id)) {
      throw new Error('good vote scorer received an invalid team surface')
    }
    expected.set(candidate.id, canonicalTeam(candidate.decision.team))
  }
  const assessments = new Map(
    context.analysis.policyCandidateAssessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    assessments.size !== context.analysis.policyCandidateAssessments.length
    || assessments.size !== expected.size
  ) {
    throw new Error('good vote scorer requires one assessment per legal team')
  }
  for (const [candidateId, team] of expected) {
    const assessment = assessments.get(candidateId)
    if (
      !assessment
      || !sameNumbers(assessment.team, team)
      || assessment.beliefModelVersion !== projection.beliefModelVersion
      || assessment.beliefThroughSeq !== projection.beliefThroughSeq
      || assessment.probabilitySemantics
        !== projection.probabilitySemantics
    ) {
      throw new Error(`good vote assessment mismatch for ${candidateId}`)
    }
  }

  const currentTeam = canonicalTeam(context.view.currentTeam)
  const currentMatches = [...expected.entries()].filter(
    ([, team]) => sameNumbers(team, currentTeam),
  )
  if (
    currentMatches.length !== 1
    || projection.currentCandidateId !== currentMatches[0][0]
    || !sameNumbers(projection.currentTeam.team, currentTeam)
  ) {
    throw new Error('good vote current-team join mismatch')
  }
  const alternatives = [...assessments.values()]
    .filter(
      (assessment) => assessment.candidateId !== projection.currentCandidateId,
    )
    .sort((left, right) =>
      right.cleanProbability - left.cleanProbability
      || (
        left.candidateId < right.candidateId
          ? -1
          : left.candidateId > right.candidateId ? 1 : 0
      ))
  const best = alternatives[0]
  if (
    !best
    || projection.bestAlternative.candidateId !== best.candidateId
    || !sameNumbers(projection.bestAlternative.team, best.team)
    || Math.abs(
      projection.bestAlternative.cleanProbability - best.cleanProbability,
    ) > 1e-12
    || !sameDistribution(
      projection.bestAlternative.evilCountDistribution,
      best.evilCountDistribution,
    )
    || Math.abs(
      projection.currentTeam.cleanProbability
      - context.analysis.currentTeam!.cleanProbability,
    ) > 1e-12
    || !sameDistribution(
      projection.currentTeam.evilCountDistribution,
      context.analysis.currentTeam!.evilCountDistribution,
    )
  ) {
    throw new Error('good vote best-alternative join mismatch')
  }

  const constants = GOOD_VOTE_UTILITY_CONSTANTS
  const futureQuestsRemain =
    context.view.round < context.view.quests.length
    && !context.analysis.matchPoint.good
    && !context.analysis.matchPoint.evil
  const stake = 1
    + (context.analysis.matchPoint.good ? constants.matchPointStakeBonus : 0)
    + (context.analysis.matchPoint.evil ? constants.matchPointStakeBonus : 0)
  const alternativeRealization =
    constants.alternativeRealizationBase
    + (
      constants.alternativeRealizationPerRejection
      * context.analysis.rejectionsBeforeHammer
    )
  const hammerPenalty =
    constants.hammerPenaltyScale
    * (1 - context.analysis.rejectionsBeforeHammer / 4)
    + (
      context.analysis.rejectionsBeforeHammer === 1
        ? constants.nextHammerPenalty
        : 0
    )
  const informationBonus = futureQuestsRemain
    ? (
        constants.informationBonusScale
        * (1 - projection.currentTeam.cleanProbability)
      )
    : 0
  return {
    currentTeam,
    currentCleanProbability: projection.currentTeam.cleanProbability,
    currentEvilCountDistribution:
      projection.currentTeam.evilCountDistribution,
    bestAlternativeCandidateId: projection.bestAlternative.candidateId,
    bestAlternativeTeam: projection.bestAlternative.team,
    bestAlternativeCleanProbability:
      projection.bestAlternative.cleanProbability,
    bestAlternativeEvilCountDistribution:
      projection.bestAlternative.evilCountDistribution,
    futureQuestsRemain,
    stake,
    alternativeRealization,
    hammerPenalty,
    informationBonus,
    approveUtility:
      stake * projection.currentTeam.cleanProbability + informationBonus,
    rejectUtility:
      stake * best.cleanProbability * alternativeRealization - hammerPenalty,
  }
}

function validGoodVoteFeatures(
  features: GoodVoteFeatures,
  context: CandidateScoringContext,
  candidate: PolicyCandidate,
): boolean {
  if (
    candidate.decision.kind !== 'vote'
    || features.version !== GOOD_VOTE_FEATURE_VERSION
    || features.utilityVersion !== GOOD_VOTE_UTILITY_VERSION
    || features.situationVersion !== GOOD_VOTE_SITUATION_VERSION
    || features.semantics
      !== context.analysis.goodVote?.probabilitySemantics
  ) {
    return false
  }
  let expected: GoodVoteUtility
  try {
    expected = goodVoteUtility(context)
  } catch {
    return false
  }
  const baseUtility = candidate.decision.vote === 'approve'
    ? expected.approveUtility
    : expected.rejectUtility
  return (
    features.beliefModelVersion
      === context.analysis.goodVote!.beliefModelVersion
    && features.beliefThroughSeq === context.analysis.throughSeq
    && sameNumbers(features.currentTeam, expected.currentTeam)
    && Math.abs(
      features.currentCleanProbability - expected.currentCleanProbability,
    ) <= 1e-12
    && sameDistribution(
      features.currentEvilCountDistribution,
      expected.currentEvilCountDistribution,
    )
    && features.bestAlternativeCandidateId
      === expected.bestAlternativeCandidateId
    && sameNumbers(
      features.bestAlternativeTeam,
      expected.bestAlternativeTeam,
    )
    && Math.abs(
      features.bestAlternativeCleanProbability
      - expected.bestAlternativeCleanProbability,
    ) <= 1e-12
    && sameDistribution(
      features.bestAlternativeEvilCountDistribution,
      expected.bestAlternativeEvilCountDistribution,
    )
    && features.boardScore.good === context.analysis.score.good
    && features.boardScore.evil === context.analysis.score.evil
    && features.proposalNumber === context.analysis.proposalNumber
    && features.rejectionsBeforeHammer
      === context.analysis.rejectionsBeforeHammer
    && features.futureQuestsRemain === expected.futureQuestsRemain
    && Math.abs(features.stake - expected.stake) <= 1e-12
    && Math.abs(
      features.alternativeRealization - expected.alternativeRealization,
    ) <= 1e-12
    && Math.abs(features.hammerPenalty - expected.hammerPenalty) <= 1e-12
    && Math.abs(features.informationBonus - expected.informationBonus) <= 1e-12
    && Math.abs(features.approveUtility - expected.approveUtility) <= 1e-12
    && Math.abs(features.rejectUtility - expected.rejectUtility) <= 1e-12
    && Math.abs(features.baseUtility - baseUtility) <= 1e-12
    && features.viableBand === GOOD_VOTE_UTILITY_CONSTANTS.viableBand
    && features.inViableBand === (
      Math.abs(expected.approveUtility - expected.rejectUtility)
      <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
    )
    && Number.isFinite(features.selectionAdjustment)
    && (
      features.seedBucket === undefined
      || features.seedBucket === 0
      || features.seedBucket === 1
    )
  )
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
    (
      scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
    )
    && context.request.kind === 'propose'
    && context.view.alignment === 'good'
  const goodVoteSemantics =
    (
      scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
      || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
    )
    && context.request.kind === 'vote'
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
    const candidate = candidatesById.get(score.candidateId)
    const validFeatures = score.features === undefined
      || (
        candidate !== undefined
        && (
          score.features.version === GOOD_PROPOSAL_FEATURE_VERSION
            ? validGoodProposalFeatures(score.features, context, candidate)
            : score.features.version === GOOD_VOTE_FEATURE_VERSION
              ? validGoodVoteFeatures(score.features, context, candidate)
              : false
        )
      )
    const validVoteSemantics = !goodVoteSemantics || (
      score.features?.version === GOOD_VOTE_FEATURE_VERSION
      && score.value === (
        forcedAllowed
          ? score.features.baseUtility + score.features.selectionAdjustment
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
      || !validFeatures
      || !validGoodSemantics
      || !validVoteSemantics
      || (
        score.features !== undefined
        && !goodProposalSemantics
        && !goodVoteSemantics
      )
      || (
        goodProposalSemantics
        && score.features?.version !== GOOD_PROPOSAL_FEATURE_VERSION
      )
      || (
        goodVoteSemantics
        && score.features?.version !== GOOD_VOTE_FEATURE_VERSION
      )
      || (
        (
          scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
          || scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
          || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        )
        && !goodProposalSemantics
        && !goodVoteSemantics
        && score.features !== undefined
      )
      || (score.viable && !allowed.has(score.candidateId))
    ) {
      throw new Error(`invalid candidate score for ${score.candidateId}`)
    }
    seen.add(score.candidateId)
  }
  if (goodVoteSemantics) {
    const voteScores = scores.map((score) => ({
      score,
      features: score.features as GoodVoteFeatures,
    }))
    const allowedVoteScores = voteScores.filter(({ score }) =>
      allowed.has(score.candidateId))
    const maxBase = Math.max(
      ...allowedVoteScores.map(({ features }) => features.baseUtility),
    )
    const topId = allowedVoteScores
      .filter(({ features }) => features.baseUtility === maxBase)
      .map(({ score }) => score.candidateId)
      .sort()[0]
    const selectionMode: GoodVoteSelectionMode =
      scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        ? 'seeded-band'
        : 'top-utility'
    const bandActive =
      selectionMode === 'seeded-band'
      && allowedVoteScores.length > 1
      && allowedVoteScores.every(({ features }) => features.inViableBand)
    const expectedSeedBucket = bandActive
      ? stableBucket([
          context.deterministicSeed,
          context.request.seat,
          context.request.kind,
          context.request.round,
          context.request.proposalNum,
          context.analysis.throughSeq,
        ].join(':'))
      : undefined
    const expectedSeededVote =
      expectedSeedBucket === 0 ? 'approve' : 'reject'
    if (
      voteScores.some(({ score, features }) =>
        features.selectionMode !== selectionMode
        || features.viableBand !== GOOD_VOTE_UTILITY_CONSTANTS.viableBand
        || (!allowed.has(score.candidateId) && score.viable)
        || (
          selectionMode === 'top-utility'
          && (
            features.selectionAdjustment !== 0
            || features.seedBucket !== undefined
            || score.viable !== (score.candidateId === topId)
          )
        )
        || (
          selectionMode === 'seeded-band'
          && !bandActive
          && (
            features.selectionAdjustment !== 0
            || features.seedBucket !== undefined
            || score.viable !== (score.candidateId === topId)
          )
        )
        || (
          bandActive
          && (
            !allowed.has(score.candidateId)
            || !score.viable
            || features.seedBucket !== expectedSeedBucket
            || Math.abs(
              features.selectionAdjustment
              - (
                (
                  candidatesById.get(score.candidateId)?.decision.kind
                    === 'vote'
                  && candidatesById.get(score.candidateId)?.decision.vote
                    === expectedSeededVote
                )
                  ? maxBase - features.baseUtility + 1e-9
                  : 0
              ),
            ) > 1e-15
          )
        ))
    ) {
      throw new Error('invalid good vote selection semantics')
    }
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
  /** The game seed supplied to this composed agent. */
  deterministicSeed: string
  request: DecisionRequest
  view: PlayerView
  analysis: SituationAnalysis
  candidates: readonly PolicyCandidate[]
  /** Candidate-generation-owned legal proposal surface used by good votes. */
  hypotheticalTeamCandidates?: readonly PolicyCandidate[]
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
        semantics: assessment.probabilitySemantics,
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

function stableBucket(value: string): 0 | 1 {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2 as 0 | 1
}

export interface GoodProposalVoteScorerOptions {
  selectionMode: GoodVoteSelectionMode
}

function scoreGoodProposalVoteCandidates(
  context: CandidateScoringContext,
  options: GoodProposalVoteScorerOptions,
): readonly CandidateScore[] {
  const version = options.selectionMode === 'seeded-band'
    ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
    : GOOD_PROPOSAL_VOTE_SCORER_VERSION
  if (
    context.request.kind === 'propose'
    && context.view.alignment === 'good'
  ) {
    return scoreGoodProposalCandidates(context).map((score) => ({
      ...score,
      version,
    }))
  }
  if (
    context.request.kind !== 'vote'
    || context.view.alignment !== 'good'
  ) {
    return scoreCandidates(context).map((score) => ({
      ...score,
      version,
      reasonCodes: [
        ...score.reasonCodes,
        'GOOD_POLICY_OUT_OF_SCOPE_COMPATIBILITY',
      ],
    }))
  }

  const utility = goodVoteUtility(context)
  const allowed = new Set(context.forced.allowedCandidateIds)
  const baseByVote = {
    approve: utility.approveUtility,
    reject: utility.rejectUtility,
  } as const
  const allowedCandidates = context.candidates.filter(
    (candidate) => allowed.has(candidate.id),
  )
  if (
    context.candidates.length !== 2
    || context.candidates.some((candidate) => candidate.decision.kind !== 'vote')
    || !allowedCandidates.length
  ) {
    throw new Error('good vote scorer requires the complete vote surface')
  }
  const maxBase = Math.max(
    ...allowedCandidates.map((candidate) =>
      baseByVote[(candidate.decision as Extract<
        typeof candidate.decision,
        { kind: 'vote' }
      >).vote]),
  )
  const topId = allowedCandidates
    .filter((candidate) =>
      baseByVote[(candidate.decision as Extract<
        typeof candidate.decision,
        { kind: 'vote' }
      >).vote] === maxBase)
    .map((candidate) => candidate.id)
    .sort()[0]
  const inViableBand =
    Math.abs(utility.approveUtility - utility.rejectUtility)
    <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
  const bandActive =
    options.selectionMode === 'seeded-band'
    && inViableBand
    && allowedCandidates.length > 1
  if (
    options.selectionMode === 'seeded-band'
    && (
      typeof context.deterministicSeed !== 'string'
      || !context.deterministicSeed.trim()
    )
  ) {
    throw new Error('seeded good vote scorer requires the game seed')
  }
  const seedBucket = bandActive
    ? stableBucket([
        context.deterministicSeed,
        context.request.seat,
        context.request.kind,
        context.request.round,
        context.request.proposalNum,
        context.analysis.throughSeq,
      ].join(':'))
    : undefined
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'

  return context.candidates.map((candidate): CandidateScore => {
    if (candidate.decision.kind !== 'vote') {
      throw new Error('good vote scorer received a mixed candidate surface')
    }
    const baseUtility = baseByVote[candidate.decision.vote]
    const selectedBySeed =
      bandActive && candidate.decision.vote === seededVote
    const selectionAdjustment = selectedBySeed
      ? maxBase - baseUtility + 1e-9
      : 0
    const forcedAllowed = allowed.has(candidate.id)
    const viable = forcedAllowed && (
      bandActive || candidate.id === topId
    )
    return {
      version,
      candidateId: candidate.id,
      value: forcedAllowed
        ? baseUtility + selectionAdjustment
        : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: [
        ...(forcedAllowed ? ['FORCED_POLICY_ALLOWED'] : ['FORCED_POLICY_REMOVED']),
        'GOOD_VOTE_CURRENT_TEAM_JOINT_CLEAN',
        'GOOD_VOTE_BEST_ALTERNATIVE_JOINT_CLEAN',
        'GOOD_VOTE_BOARD_STAKES',
        'GOOD_VOTE_PROPOSAL_RUNWAY',
        'GOOD_VOTE_HAMMER_RISK',
        ...(utility.informationBonus > 0
          ? ['GOOD_VOTE_INFORMATION_FUTURE_QUEST']
          : []),
        ...(bandActive
          ? ['GOOD_VOTE_SEEDED_VIABLE_BAND']
          : viable ? ['GOOD_VOTE_TOP_UTILITY'] : []),
      ],
      features: {
        version: GOOD_VOTE_FEATURE_VERSION,
        utilityVersion: GOOD_VOTE_UTILITY_VERSION,
        situationVersion: GOOD_VOTE_SITUATION_VERSION,
        semantics: context.analysis.goodVote!.probabilitySemantics,
        beliefModelVersion:
          context.analysis.goodVote!.beliefModelVersion,
        beliefThroughSeq: context.analysis.throughSeq,
        currentTeam: utility.currentTeam,
        currentCleanProbability: utility.currentCleanProbability,
        currentEvilCountDistribution:
          utility.currentEvilCountDistribution,
        bestAlternativeCandidateId:
          utility.bestAlternativeCandidateId,
        bestAlternativeTeam: utility.bestAlternativeTeam,
        bestAlternativeCleanProbability:
          utility.bestAlternativeCleanProbability,
        bestAlternativeEvilCountDistribution:
          utility.bestAlternativeEvilCountDistribution,
        boardScore: { ...context.analysis.score },
        proposalNumber: context.analysis.proposalNumber,
        rejectionsBeforeHammer:
          context.analysis.rejectionsBeforeHammer,
        futureQuestsRemain: utility.futureQuestsRemain,
        stake: utility.stake,
        alternativeRealization: utility.alternativeRealization,
        hammerPenalty: utility.hammerPenalty,
        informationBonus: utility.informationBonus,
        approveUtility: utility.approveUtility,
        rejectUtility: utility.rejectUtility,
        baseUtility,
        selectionAdjustment,
        selectionMode: options.selectionMode,
        viableBand: GOOD_VOTE_UTILITY_CONSTANTS.viableBand,
        inViableBand,
        ...(seedBucket === undefined ? {} : { seedBucket }),
      },
    }
  })
}

/**
 * Opt-in Phase 4B policy factory. Top-utility mode is the deterministic vote
 * ablation; seeded-band mode varies only near-equivalent forced survivors.
 */
export function createGoodProposalVoteScorer(
  options: GoodProposalVoteScorerOptions,
): CandidateScorer {
  const selectionMode = options.selectionMode
  return Object.freeze({
    version: selectionMode === 'seeded-band'
      ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      : GOOD_PROPOSAL_VOTE_SCORER_VERSION,
    analysisRequirement: 'joint-proposal-vote-team-assessments' as const,
    score: (context: CandidateScoringContext) =>
      scoreGoodProposalVoteCandidates(context, { selectionMode }),
  })
}

/** Deterministic Phase 4B ablation. Compatibility remains the default. */
export const goodProposalVoteScorer = createGoodProposalVoteScorer({
  selectionMode: 'top-utility',
})
