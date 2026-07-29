import { isDeepStrictEqual } from 'node:util'
import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
  type JointProbabilitySemantics,
  type SituationAnalysis,
} from '../analysis/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from './types.ts'
import type {
  DecisionCandidateBoundary,
} from './decision-layer/types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
  type RoleUtilityAssessment,
} from '../analysis/role-utility.ts'
import { ROLE_OBJECTIVE_MODEL_VERSION } from '../analysis/role-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  type EvilRoleUtilityAssessment,
  type PrivateEvilRoleUtilityProjection,
} from '../analysis/evil-role-utility.ts'
import { EVIL_ROLE_OBJECTIVE_MODEL_VERSION } from '../analysis/evil-objective-types.ts'
import {
  MORGANA_ROLE_SCORE_FEATURE_VERSION,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_CONSTANTS,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type MorganaRoleCandidateUtility,
  type MorganaRoleSelectionMode,
  type PrivateMorganaRoleUtilityProjection,
} from '../analysis/morgana-role-utility.ts'
import {
  CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_REASON_CODES,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_REASON_CODES,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  stablePolicyBucket,
  type GoodProposalFeatures,
  type GoodProposalReasonCode,
  type GoodVoteFeatures,
  type GoodVoteSelectionMode,
} from './good-score-contract.ts'
import { compareCandidateIds } from './candidates.ts'
import { calculateCompatibilityBase } from './compatibility-score.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
  type EvilRoleObjectiveSelectionMode,
} from './evil-score-contract.ts'
import {
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
  type MordredBlindnessRoleSelectionMode,
} from './mordred-score-contract.ts'
export {
  CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_REASON_CODES,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_REASON_CODES,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  stablePolicyBucket,
  type GoodProposalFeatures,
  type GoodProposalReasonCode,
  type GoodVoteFeatures,
  type GoodVoteSelectionMode,
} from './good-score-contract.ts'

export {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
  type EvilRoleObjectiveSelectionMode,
} from './evil-score-contract.ts'

export {
  MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
  MORDRED_BLINDNESS_ROLE_UTILITY_CONSTANTS,
  type MordredBlindnessRoleSelectionMode,
} from './mordred-score-contract.ts'

export interface CandidateScore {
  version: string
  candidateId: string
  value: number
  viable: boolean
  reasonCodes: readonly string[]
  features?: GoodProposalFeatures | GoodVoteFeatures
  /** Private role-policy attribution. Never projected into public speech. */
  roleObjectiveFeatures?: RoleObjectiveScoreFeatures
  /** Private evil/Oberon role-policy attribution. Never enters speech. */
  evilRoleObjectiveFeatures?: EvilRoleObjectiveScoreFeatures
  /** Private Morgana specialization attribution. Never enters speech. */
  morganaRoleObjectiveFeatures?: MorganaRoleObjectiveScoreFeatures
}

export type ScorerAnalysisRequirement =
  | 'joint-proposal-team-assessments'
  | 'joint-proposal-vote-team-assessments'

export interface CandidateScorer {
  version: string
  analysisRequirement?: ScorerAnalysisRequirement
  /** Activates the private C1 objective and the versioned C2 scorer input. */
  roleUtilityRequirement?: typeof ROLE_UTILITY_PROJECTION_VERSION
  /** Activates the private D1 objective and versioned D2 scorer input. */
  evilRoleUtilityRequirement?: typeof EVIL_ROLE_UTILITY_PROJECTION_VERSION
  /** Activates the private E1A/D2-bound Morgana policy input. */
  morganaRoleUtilityRequirement?: typeof MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  /** Truthful fallback used when this opt-in scorer is inapplicable/degraded. */
  baseScorer?: CandidateScorer
  /**
   * Only caller-supplied scorer plugins execute through this compatibility
   * seam. Built-in scorer identities are data-only descriptors resolved by
   * the native score-layer registry.
   */
  score?: (context: CandidateScoringContext) => readonly CandidateScore[]
}

export interface CustomCandidateScorer extends CandidateScorer {
  score(context: CandidateScoringContext): readonly CandidateScore[]
}

export function isCustomCandidateScorer(
  scorer: CandidateScorer,
): scorer is CustomCandidateScorer {
  return typeof scorer.score === 'function'
}

export type RoleObjectiveSelectionMode =
  | 'top-composite'
  | 'seeded-composite-band'

export interface RoleObjectiveScoreFeatures {
  version: typeof ROLE_OBJECTIVE_SCORE_FEATURE_VERSION
  utilityVersion: typeof ROLE_OBJECTIVE_UTILITY_VERSION
  utilityProjectionVersion: typeof ROLE_UTILITY_PROJECTION_VERSION
  sourceObjectiveVersion: typeof ROLE_OBJECTIVE_MODEL_VERSION
  role: 'merlin' | 'percival'
  candidateId: string
  kind: 'propose' | 'vote'
  baseScorerVersion: typeof GOOD_PROPOSAL_VOTE_SCORER_VERSION
  baseFeatureVersion:
    | typeof GOOD_PROPOSAL_FEATURE_VERSION
    | typeof GOOD_VOTE_FEATURE_VERSION
  baseValue: number
  roleValue: number
  survivorMeanRoleValue: number
  roleAdjustment: number
  combinedValue: number
  selectionMode: RoleObjectiveSelectionMode
  viableBand: number
  inViableBand: boolean
  selectionAdjustment: number
  seedBucket?: 0 | 1
  /** Exact/proxy inputs copied from the host-validated private projection. */
  utility: RoleUtilityAssessment
}

export interface EvilRoleObjectiveScoreFeatures {
  version: typeof EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION
  utilityVersion: typeof EVIL_ROLE_OBJECTIVE_UTILITY_VERSION
  utilityProjectionVersion: typeof EVIL_ROLE_UTILITY_PROJECTION_VERSION
  sourceObjectiveVersion: typeof EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  role: EvilRoleUtilityAssessment['role']
  candidateId: string
  kind: 'propose' | 'vote'
  roleValue: number
  selectionMode: EvilRoleObjectiveSelectionMode
  viableBand: number
  inViableBand: boolean
  selectionAdjustment: number
  seedBucket?: 0 | 1
  utility: EvilRoleUtilityAssessment
}

export interface MorganaRoleObjectiveScoreFeatures {
  version: typeof MORGANA_ROLE_SCORE_FEATURE_VERSION
  utilityProjectionVersion: typeof MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  sourceCounterfeitObjectiveVersion: string
  sourceEvilRoleUtilityVersion: string
  candidateId: string
  kind: 'propose' | 'vote'
  d2RoleValue: number
  maxD2RoleValue: number
  d2BandFloor: number
  d2ViableBand: number
  inD2ViableBand: boolean
  counterfeitValue: number
  counterfeitRank: number
  selectionMode: MorganaRoleSelectionMode
  seededVoteCounterfeitBand: number
  selectedByPolicy: boolean
  seedBucket?: 0 | 1
  utility: MorganaRoleCandidateUtility
}

function plainDetachedData(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const array = Array.isArray(value)
  if (
    array
      ? (
          Object.keys(value).length !== value.length
          || Array.from(
            { length: value.length },
            (_, index) => Object.hasOwn(value, index),
          ).some((present) => !present)
        )
      : Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = descriptors[key]
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !plainDetachedData(descriptor.value, seen)
    ) return false
  }
  seen.delete(value)
  return true
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
      || compareCandidateIds(left.candidateId, right.candidateId))
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
  if (
    !plainDetachedData(scores)
    || (
      (
        scorerVersion === ROLE_OBJECTIVE_SCORER_VERSION
        || scorerVersion === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        || scorerVersion === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
        || scorerVersion === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        || scorerVersion === MORGANA_ROLE_SCORER_VERSION
        || scorerVersion === MORGANA_ROLE_SEEDED_SCORER_VERSION
      )
      && Buffer.byteLength(JSON.stringify(scores), 'utf8') > 1_048_576
    )
  ) {
    throw new Error('invalid candidate score surface: unsafe detached data')
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
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
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
      score.features?.version === GOOD_PROPOSAL_FEATURE_VERSION
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
      || (
        score.roleObjectiveFeatures !== undefined
        && scorerVersion !== ROLE_OBJECTIVE_SCORER_VERSION
        && scorerVersion !== ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      || (
        score.evilRoleObjectiveFeatures !== undefined
        && scorerVersion !== EVIL_ROLE_OBJECTIVE_SCORER_VERSION
        && scorerVersion !== EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      || (
        score.morganaRoleObjectiveFeatures !== undefined
        && scorerVersion !== MORGANA_ROLE_SCORER_VERSION
        && scorerVersion !== MORGANA_ROLE_SEEDED_SCORER_VERSION
      )
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
      .sort(compareCandidateIds)[0]
    const selectionMode: GoodVoteSelectionMode =
      scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        ? 'seeded-band'
        : 'top-utility'
    const bandActive =
      selectionMode === 'seeded-band'
      && allowedVoteScores.length > 1
      && allowedVoteScores.every(({ features }) => features.inViableBand)
    const expectedSeedBucket = bandActive
      ? stablePolicyBucket([
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
    const isExpectedSeededVote = (candidateId: string): boolean => {
      const decision = candidatesById.get(candidateId)?.decision
      return decision?.kind === 'vote' && decision.vote === expectedSeededVote
    }
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
                  isExpectedSeededVote(score.candidateId)
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
    context.candidateBoundary.selectedCandidateId
    && !viable.some(
      (score) =>
        score.candidateId === context.candidateBoundary.selectedCandidateId,
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
  /** Private, host-derived C2 scorer input. Absent outside eligible role play. */
  roleUtility?: PrivateRoleUtilityProjection
  /** Private, host-derived D2 scorer input. */
  evilRoleUtility?: PrivateEvilRoleUtilityProjection
  /** Private, host-derived E1B Morgana policy input. */
  morganaRoleUtility?: PrivateMorganaRoleUtilityProjection
  /** Hard candidate authority after universal and strategic policy. */
  candidateBoundary: DecisionCandidateBoundary
  /** Universal forced policy remains a separate attribution surface. */
  forced: ForcedPolicyResult
  compatibilityCandidateId?: string
}

/** Historical compatibility surface for external/custom scorer fallback. */
export function compatibilityCandidateScores(
  context: CandidateScoringContext,
): readonly CandidateScore[] {
  return calculateCompatibilityBase({
    candidates: context.candidates,
    allowedCandidateIds: context.candidateBoundary.survivorCandidateIds,
    compatibilityCandidateId: context.compatibilityCandidateId,
  }).map((row) => ({
    version: CANDIDATE_SCORER_VERSION,
    ...row,
  }))
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
        && compareCandidateIds(score.candidateId, best.candidateId) < 0
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
/** Structural scorer plugin for `createComposedAgent({ scorer })`. */
export const goodProposalScorer: CandidateScorer = Object.freeze({
  version: GOOD_PROPOSAL_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-team-assessments' as const,
})

/**
 * Preserve the compatibility choice while asking analysis to materialize the
 * exhaustive joint team surface for paired calibration traces.
 */
export const calibrationCompatibilityScorer: CandidateScorer = Object.freeze({
  version: CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-vote-team-assessments',
  score(context: CandidateScoringContext) {
    return compatibilityCandidateScores(context).map((score) => ({
      ...score,
      version: CALIBRATION_COMPATIBILITY_SCORER_VERSION,
    }))
  },
})

export interface GoodProposalVoteScorerOptions {
  selectionMode: GoodVoteSelectionMode
}

const GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR: CandidateScorer = Object.freeze({
  version: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-vote-team-assessments',
})

const SEEDED_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
    analysisRequirement: 'joint-proposal-vote-team-assessments',
  })

/**
 * Opt-in Phase 4B policy factory. Top-utility mode is the deterministic vote
 * ablation; seeded-band mode varies only near-equivalent forced survivors.
 */
export function createGoodProposalVoteScorer(
  options: GoodProposalVoteScorerOptions,
): CandidateScorer {
  return options.selectionMode === 'seeded-band'
    ? SEEDED_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR
    : GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR
}

/** Deterministic Phase 4B ablation. Compatibility remains the default. */
export const goodProposalVoteScorer =
  GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR

/** Seeded Phase 4B base used by matching opt-in fallback paths. */
export const seededGoodProposalVoteScorer =
  SEEDED_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR

export interface RoleObjectiveScorerOptions {
  selectionMode: RoleObjectiveSelectionMode
}

const ROLE_OBJECTIVE_SCORER_DESCRIPTOR: CandidateScorer = Object.freeze({
  version: ROLE_OBJECTIVE_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-vote-team-assessments',
  roleUtilityRequirement: ROLE_UTILITY_PROJECTION_VERSION,
  baseScorer: goodProposalVoteScorer,
})

const SEEDED_ROLE_OBJECTIVE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    analysisRequirement: 'joint-proposal-vote-team-assessments',
    roleUtilityRequirement: ROLE_UTILITY_PROJECTION_VERSION,
    baseScorer: seededGoodProposalVoteScorer,
  })

/** Opt-in Phase 7C2 scorer factory. Compatibility/default policy is unchanged. */
export function createRoleObjectiveScorer(
  options: RoleObjectiveScorerOptions,
): CandidateScorer {
  return options.selectionMode === 'seeded-composite-band'
    ? SEEDED_ROLE_OBJECTIVE_SCORER_DESCRIPTOR
    : ROLE_OBJECTIVE_SCORER_DESCRIPTOR
}

/** Deterministic role-policy ablation. */
export const roleObjectiveScorer = ROLE_OBJECTIVE_SCORER_DESCRIPTOR

/** Recommended opt-in role policy; variation remains confined to vote bands. */
export const seededRoleObjectiveScorer =
  SEEDED_ROLE_OBJECTIVE_SCORER_DESCRIPTOR

export interface EvilRoleObjectiveScorerOptions {
  selectionMode: EvilRoleObjectiveSelectionMode
}

const EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR: CandidateScorer = Object.freeze({
  version: EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  baseScorer: roleObjectiveScorer,
})

const SEEDED_EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
    evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
    baseScorer: seededRoleObjectiveScorer,
  })

/** Opt-in Phase 7D2 scorer. Ineligible roles/kinds resolve via baseScorer. */
export function createEvilRoleObjectiveScorer(
  options: EvilRoleObjectiveScorerOptions,
): CandidateScorer {
  return options.selectionMode === 'seeded-role-utility-band'
    ? SEEDED_EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR
    : EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR
}

export const evilRoleObjectiveScorer =
  EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR

export const seededEvilRoleObjectiveScorer =
  SEEDED_EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR

const MORGANA_ROLE_SCORER_DESCRIPTOR: CandidateScorer = Object.freeze({
  version: MORGANA_ROLE_SCORER_VERSION,
  morganaRoleUtilityRequirement: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  baseScorer: evilRoleObjectiveScorer,
})

const SEEDED_MORGANA_ROLE_SCORER_DESCRIPTOR: CandidateScorer = Object.freeze({
  version: MORGANA_ROLE_SEEDED_SCORER_VERSION,
  morganaRoleUtilityRequirement: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  baseScorer: seededEvilRoleObjectiveScorer,
})

export function createMorganaRoleScorer(options: {
  selectionMode: MorganaRoleSelectionMode
}): CandidateScorer {
  return options.selectionMode
      === 'seeded-near-equal-vote-within-d2-band'
    ? SEEDED_MORGANA_ROLE_SCORER_DESCRIPTOR
    : MORGANA_ROLE_SCORER_DESCRIPTOR
}

export const morganaRoleScorer = MORGANA_ROLE_SCORER_DESCRIPTOR

export const seededMorganaRoleScorer =
  SEEDED_MORGANA_ROLE_SCORER_DESCRIPTOR

const MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: MORDRED_BLINDNESS_ROLE_SCORER_VERSION,
    baseScorer: evilRoleObjectiveScorer,
  })

const SEEDED_MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION,
    baseScorer: seededEvilRoleObjectiveScorer,
  })

export function createMordredBlindnessRoleScorer(options: {
  selectionMode: MordredBlindnessRoleSelectionMode
}): CandidateScorer {
  return options.selectionMode
      === 'seeded-near-equal-vote-within-d2-band'
    ? SEEDED_MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR
    : MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR
}

export const mordredBlindnessRoleScorer =
  MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR

export const seededMordredBlindnessRoleScorer =
  SEEDED_MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR
