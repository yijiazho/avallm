import { isDeepStrictEqual } from 'node:util'
import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
  type JointProbabilitySemantics,
  type SituationAnalysis,
} from '../analysis/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from './types.ts'
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

export const CANDIDATE_SCORER_VERSION = 'compatibility-scorer-v1'
export const CALIBRATION_COMPATIBILITY_SCORER_VERSION =
  'calibration-compatibility-scorer-v1'
export const GOOD_PROPOSAL_SCORER_VERSION = 'good-proposal-scorer-v1'
export const GOOD_PROPOSAL_FEATURE_VERSION = 'good-proposal-features-v1'
export const GOOD_PROPOSAL_VOTE_SCORER_VERSION =
  'good-proposal-vote-scorer-v1'
export const GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION =
  'good-proposal-vote-seeded-band-v1'
export const GOOD_VOTE_FEATURE_VERSION = 'good-vote-features-v1'
export const GOOD_VOTE_UTILITY_VERSION = 'good-vote-utility-v1'
export const ROLE_OBJECTIVE_SCORER_VERSION =
  'merlin-percival-role-scorer-v1'
export const ROLE_OBJECTIVE_SEEDED_SCORER_VERSION =
  'merlin-percival-role-seeded-band-v1'
export const ROLE_OBJECTIVE_SCORE_FEATURE_VERSION =
  'merlin-percival-role-score-features-v1'
export const ROLE_OBJECTIVE_UTILITY_VERSION =
  'merlin-percival-role-score-utility-v1'
export const EVIL_ROLE_OBJECTIVE_SCORER_VERSION =
  'evil-oberon-role-scorer-v1'
export const EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION =
  'evil-oberon-role-seeded-band-v1'
export const EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION =
  'evil-oberon-role-score-features-v1'
export const EVIL_ROLE_OBJECTIVE_UTILITY_VERSION =
  'evil-oberon-role-score-utility-v1'

export const ROLE_OBJECTIVE_UTILITY_CONSTANTS = Object.freeze({
  centeredAdjustmentScale: 0.20,
  viableBand: 0.04,
})

export const EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS = Object.freeze({
  viableBand: 0.04,
})

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
  score(context: CandidateScoringContext): readonly CandidateScore[]
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

export type EvilRoleObjectiveSelectionMode =
  | 'top-role-utility'
  | 'seeded-role-utility-band'

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
  if (
    scorerVersion === MORGANA_ROLE_SCORER_VERSION
    || scorerVersion === MORGANA_ROLE_SEEDED_SCORER_VERSION
  ) {
    const expected = scoreMorganaRoleCandidates(context)
    if (!isDeepStrictEqual(scores, expected)) {
      throw new Error('invalid Morgana role candidate score surface')
    }
    return
  }
  if (
    scorerVersion === ROLE_OBJECTIVE_SCORER_VERSION
    || scorerVersion === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  ) {
    const expected = scoreRoleObjectiveCandidates(context, {
      selectionMode:
        scorerVersion === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          ? 'seeded-composite-band'
          : 'top-composite',
    })
    if (!isDeepStrictEqual(scores, expected)) {
      throw new Error('invalid role-objective candidate score surface')
    }
    return
  }
  if (
    scorerVersion === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
    || scorerVersion === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  ) {
    const expected = scoreEvilRoleObjectiveCandidates(context, {
      selectionMode:
        scorerVersion === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          ? 'seeded-role-utility-band'
          : 'top-role-utility',
    })
    if (!isDeepStrictEqual(scores, expected)) {
      throw new Error('invalid evil role-objective candidate score surface')
    }
    return
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
      || score.roleObjectiveFeatures !== undefined
      || score.evilRoleObjectiveFeatures !== undefined
      || score.morganaRoleObjectiveFeatures !== undefined
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
  /** Private, host-derived C2 scorer input. Absent outside eligible role play. */
  roleUtility?: PrivateRoleUtilityProjection
  /** Private, host-derived D2 scorer input. */
  evilRoleUtility?: PrivateEvilRoleUtilityProjection
  /** Private, host-derived E1B Morgana policy input. */
  morganaRoleUtility?: PrivateMorganaRoleUtilityProjection
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

/**
 * Preserve the compatibility choice while asking analysis to materialize the
 * exhaustive joint team surface for paired calibration traces.
 */
export const calibrationCompatibilityScorer: CandidateScorer = Object.freeze({
  version: CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  analysisRequirement: 'joint-proposal-vote-team-assessments',
  score(context) {
    return scoreCandidates(context).map((score) => ({
      ...score,
      version: CALIBRATION_COMPATIBILITY_SCORER_VERSION,
    }))
  },
})

export function stablePolicyBucket(value: string): 0 | 1 {
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
      ? stablePolicyBucket([
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

/** Seeded Phase 4B base used by matching opt-in fallback paths. */
export const seededGoodProposalVoteScorer = createGoodProposalVoteScorer({
  selectionMode: 'seeded-band',
})

export interface RoleObjectiveScorerOptions {
  selectionMode: RoleObjectiveSelectionMode
}

function scoreRoleObjectiveCandidates(
  context: CandidateScoringContext,
  options: RoleObjectiveScorerOptions,
): readonly CandidateScore[] {
  const projection = context.roleUtility
  if (
    !projection
    || projection.version !== ROLE_UTILITY_PROJECTION_VERSION
    || (context.request.kind !== 'propose' && context.request.kind !== 'vote')
    || (context.view.role !== 'merlin' && context.view.role !== 'percival')
    || projection.role !== context.view.role
    || projection.request.kind !== context.request.kind
    || projection.request.seat !== context.request.seat
    || projection.request.round !== context.request.round
    || projection.request.proposalNum !== context.request.proposalNum
    || projection.source.beliefThroughSeq !== context.analysis.throughSeq
    || context.analysis.policyCandidateAssessments.some(
      (assessment) =>
        assessment.beliefModelVersion
          !== projection.source.beliefModelVersion,
    )
  ) {
    throw new Error('role-objective scorer requires an eligible bound utility')
  }
  const version = options.selectionMode === 'seeded-composite-band'
    ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    : ROLE_OBJECTIVE_SCORER_VERSION
  const utilityById = new Map(
    projection.assessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    utilityById.size !== projection.assessments.length
    || utilityById.size !== context.candidates.length
  ) {
    throw new Error('role-objective scorer requires a complete utility surface')
  }

  // The role layer always starts from Phase 4's deterministic, unadjusted
  // values. Its own seeded variant is the only allowed source of variation.
  const baseScores = scoreGoodProposalVoteCandidates(context, {
    selectionMode: 'top-utility',
  })
  const baseById = new Map(baseScores.map((score) => [score.candidateId, score]))
  const allowed = new Set(context.forced.allowedCandidateIds)
  const survivors = context.candidates.filter((candidate) =>
    allowed.has(candidate.id))
  if (!survivors.length) {
    throw new Error('role-objective scorer received no forced survivors')
  }
  const survivorMean = survivors.reduce((sum, candidate) => {
    const utility = utilityById.get(candidate.id)
    if (!utility) throw new Error('role-objective utility join mismatch')
    return sum + utility.roleValue
  }, 0) / survivors.length
  const preliminary = context.candidates.map((candidate) => {
    const utility = utilityById.get(candidate.id)
    const base = baseById.get(candidate.id)
    if (
      !utility
      || !base
      || !base.features
      || utility.kind !== context.request.kind
      || utility.role !== context.view.role
      || base.version !== GOOD_PROPOSAL_VOTE_SCORER_VERSION
      || (
        base.features.version !== GOOD_PROPOSAL_FEATURE_VERSION
        && base.features.version !== GOOD_VOTE_FEATURE_VERSION
      )
    ) {
      throw new Error(`role-objective scorer join mismatch for ${candidate.id}`)
    }
    const baseValue = base.features.version === GOOD_PROPOSAL_FEATURE_VERSION
      ? base.features.cleanProbability
      : base.features.baseUtility
    const roleAdjustment =
      ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
      * (utility.roleValue - survivorMean)
    return {
      candidate,
      base,
      utility,
      baseValue,
      roleAdjustment,
      combinedValue: baseValue + roleAdjustment,
    }
  })
  const allowedRows = preliminary.filter(({ candidate }) =>
    allowed.has(candidate.id))
  const maxCombined = Math.max(
    ...allowedRows.map(({ combinedValue }) => combinedValue),
  )
  const canonicalTopId = allowedRows
    .filter(({ combinedValue }) => combinedValue === maxCombined)
    .map(({ candidate }) => candidate.id)
    .sort()[0]
  const forcedSelection = context.forced.selectedCandidateId
  if (forcedSelection && !allowed.has(forcedSelection)) {
    throw new Error('role-objective scorer received invalid forced selection')
  }

  const voteRows = context.request.kind === 'vote' ? allowedRows : []
  const inViableBand =
    voteRows.length === 2
    && Math.abs(voteRows[0].combinedValue - voteRows[1].combinedValue)
      <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
  const bandActive =
    !forcedSelection
    && options.selectionMode === 'seeded-composite-band'
    && inViableBand
  if (
    options.selectionMode === 'seeded-composite-band'
    && (
      typeof context.deterministicSeed !== 'string'
      || !context.deterministicSeed.trim()
    )
  ) {
    throw new Error('seeded role-objective scorer requires the game seed')
  }
  const seedBucket = bandActive
    ? stablePolicyBucket([
        context.deterministicSeed,
        context.request.seat,
        context.request.kind,
        context.request.round,
        context.request.proposalNum,
        context.analysis.throughSeq,
      ].join(':'))
    : undefined
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'

  return preliminary.map((row): CandidateScore => {
    const forcedAllowed = allowed.has(row.candidate.id)
    const selectedBySeed =
      bandActive
      && row.candidate.decision.kind === 'vote'
      && row.candidate.decision.vote === seededVote
    const selectionAdjustment = selectedBySeed
      ? maxCombined - row.combinedValue + 1e-9
      : 0
    const viable = forcedAllowed && (
      forcedSelection
        ? row.candidate.id === forcedSelection
        : bandActive || row.candidate.id === canonicalTopId
    )
    return {
      version,
      candidateId: row.candidate.id,
      value: forcedAllowed
        ? row.combinedValue + selectionAdjustment
        : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: [
        ...(forcedAllowed ? ['FORCED_POLICY_ALLOWED'] : ['FORCED_POLICY_REMOVED']),
        ...row.base.reasonCodes.filter((reason) =>
          reason !== 'GOOD_VOTE_TOP_UTILITY'
          && reason !== 'GOOD_VOTE_SEEDED_VIABLE_BAND'
          && reason !== 'GOOD_PROPOSAL_MAX_TEAM_CLEAN'
          && reason !== 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK'),
        'PRIVATE_ROLE_OBJECTIVE_COMPOSITE',
        ...(viable ? ['PRIVATE_ROLE_OBJECTIVE_SELECTED_SET'] : []),
        ...(bandActive ? ['PRIVATE_ROLE_OBJECTIVE_SEEDED_BAND'] : []),
      ],
      features: structuredClone(row.base.features),
      roleObjectiveFeatures: {
        version: ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
        utilityVersion: ROLE_OBJECTIVE_UTILITY_VERSION,
        utilityProjectionVersion: ROLE_UTILITY_PROJECTION_VERSION,
        sourceObjectiveVersion: ROLE_OBJECTIVE_MODEL_VERSION,
        role: projection.role,
        candidateId: row.candidate.id,
        kind: context.request.kind,
        baseScorerVersion: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
        baseFeatureVersion: row.base.features.version,
        baseValue: row.baseValue,
        roleValue: row.utility.roleValue,
        survivorMeanRoleValue: survivorMean,
        roleAdjustment: row.roleAdjustment,
        combinedValue: row.combinedValue,
        selectionMode: options.selectionMode,
        viableBand: ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand,
        inViableBand,
        selectionAdjustment,
        ...(seedBucket === undefined ? {} : { seedBucket }),
        utility: structuredClone(row.utility),
      },
    }
  })
}

/** Opt-in Phase 7C2 scorer factory. Compatibility/default policy is unchanged. */
export function createRoleObjectiveScorer(
  options: RoleObjectiveScorerOptions,
): CandidateScorer {
  const selectionMode = options.selectionMode
  return Object.freeze({
    version: selectionMode === 'seeded-composite-band'
      ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : ROLE_OBJECTIVE_SCORER_VERSION,
    analysisRequirement: 'joint-proposal-vote-team-assessments' as const,
    roleUtilityRequirement: ROLE_UTILITY_PROJECTION_VERSION,
    baseScorer: selectionMode === 'seeded-composite-band'
      ? seededGoodProposalVoteScorer
      : goodProposalVoteScorer,
    score: (context: CandidateScoringContext) =>
      scoreRoleObjectiveCandidates(context, { selectionMode }),
  })
}

/** Deterministic role-policy ablation. */
export const roleObjectiveScorer = createRoleObjectiveScorer({
  selectionMode: 'top-composite',
})

/** Recommended opt-in role policy; variation remains confined to vote bands. */
export const seededRoleObjectiveScorer = createRoleObjectiveScorer({
  selectionMode: 'seeded-composite-band',
})

export interface EvilRoleObjectiveScorerOptions {
  selectionMode: EvilRoleObjectiveSelectionMode
}

function scoreEvilRoleObjectiveCandidates(
  context: CandidateScoringContext,
  options: EvilRoleObjectiveScorerOptions,
): readonly CandidateScore[] {
  const projection = context.evilRoleUtility
  if (
    !projection
    || projection.version !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    || (context.request.kind !== 'propose' && context.request.kind !== 'vote')
    || context.view.alignment !== 'evil'
    || projection.role !== context.view.role
    || projection.request.kind !== context.request.kind
    || projection.request.seat !== context.request.seat
    || projection.request.round !== context.request.round
    || projection.request.proposalNum !== context.request.proposalNum
    || projection.source.beliefThroughSeq !== context.analysis.throughSeq
  ) {
    throw new Error(
      'evil role-objective scorer requires an eligible bound utility',
    )
  }
  const version =
    options.selectionMode === 'seeded-role-utility-band'
      ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : EVIL_ROLE_OBJECTIVE_SCORER_VERSION
  const utilityById = new Map(
    projection.assessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    utilityById.size !== projection.assessments.length
    || utilityById.size !== context.candidates.length
  ) {
    throw new Error(
      'evil role-objective scorer requires a complete utility surface',
    )
  }
  const allowed = new Set(context.forced.allowedCandidateIds)
  const allowedRows = context.candidates.map((candidate) => {
    const utility = utilityById.get(candidate.id)
    if (
      !utility
      || utility.kind !== context.request.kind
      || utility.role !== context.view.role
    ) {
      throw new Error(
        `evil role-objective scorer join mismatch for ${candidate.id}`,
      )
    }
    return { candidate, utility }
  }).filter(({ candidate }) => allowed.has(candidate.id))
  if (!allowedRows.length) {
    throw new Error(
      'evil role-objective scorer received no forced survivors',
    )
  }
  const maxValue = Math.max(
    ...allowedRows.map(({ utility }) => utility.roleValue),
  )
  const canonicalTopId = allowedRows
    .filter(({ utility }) => utility.roleValue === maxValue)
    .map(({ candidate }) => candidate.id)
    .sort()[0]
  const forcedSelection = context.forced.selectedCandidateId
  if (forcedSelection && !allowed.has(forcedSelection)) {
    throw new Error(
      'evil role-objective scorer received invalid forced selection',
    )
  }
  const voteRows = context.request.kind === 'vote' ? allowedRows : []
  const inViableBand =
    voteRows.length === 2
    && Math.abs(
      voteRows[0].utility.roleValue - voteRows[1].utility.roleValue,
    ) <= EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
  const bandActive =
    !forcedSelection
    && options.selectionMode === 'seeded-role-utility-band'
    && inViableBand
  if (
    options.selectionMode === 'seeded-role-utility-band'
    && (
      typeof context.deterministicSeed !== 'string'
      || !context.deterministicSeed.trim()
    )
  ) {
    throw new Error('seeded evil role-objective scorer requires the game seed')
  }
  const seedBucket = bandActive
    ? stablePolicyBucket([
        context.deterministicSeed,
        context.request.seat,
        context.request.kind,
        context.request.round,
        context.request.proposalNum,
        context.analysis.throughSeq,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].join(':'))
    : undefined
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'

  return context.candidates.map((candidate): CandidateScore => {
    const utility = utilityById.get(candidate.id)
    if (!utility) {
      throw new Error(
        `evil role-objective utility join mismatch for ${candidate.id}`,
      )
    }
    const forcedAllowed = allowed.has(candidate.id)
    const selectedBySeed =
      bandActive
      && candidate.decision.kind === 'vote'
      && candidate.decision.vote === seededVote
    const selectionAdjustment = selectedBySeed
      ? maxValue - utility.roleValue + 1e-9
      : 0
    const viable = forcedAllowed && (
      forcedSelection
        ? candidate.id === forcedSelection
        : bandActive || candidate.id === canonicalTopId
    )
    return {
      version,
      candidateId: candidate.id,
      value: forcedAllowed
        ? utility.roleValue + selectionAdjustment
        : -Number.MAX_SAFE_INTEGER,
      viable,
      reasonCodes: [
        ...(forcedAllowed ? ['FORCED_POLICY_ALLOWED'] : ['FORCED_POLICY_REMOVED']),
        'EVIL_ROLE_FAILURE_CAPACITY',
        'EVIL_ROLE_PUBLIC_COVER',
        'EVIL_ROLE_FUTURE_OPPORTUNITY',
        ...(viable ? ['EVIL_ROLE_OBJECTIVE_SELECTED_SET'] : []),
        ...(bandActive ? ['EVIL_ROLE_OBJECTIVE_SEEDED_BAND'] : []),
      ],
      evilRoleObjectiveFeatures: {
        version: EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
        utilityVersion: EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
        utilityProjectionVersion: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
        sourceObjectiveVersion: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
        role: projection.role,
        candidateId: candidate.id,
        kind: context.request.kind,
        roleValue: utility.roleValue,
        selectionMode: options.selectionMode,
        viableBand: EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand,
        inViableBand,
        selectionAdjustment,
        ...(seedBucket === undefined ? {} : { seedBucket }),
        utility: structuredClone(utility),
      },
    }
  })
}

/** Opt-in Phase 7D2 scorer. Ineligible roles/kinds resolve via baseScorer. */
export function createEvilRoleObjectiveScorer(
  options: EvilRoleObjectiveScorerOptions,
): CandidateScorer {
  const selectionMode = options.selectionMode
  return Object.freeze({
    version:
      selectionMode === 'seeded-role-utility-band'
        ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        : EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
    evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
    // The nested chain lets one configured Phase 7 policy resolve D2 for evil,
    // C2 for Merlin/Percival, and Phase 4 for Servant/ineligible decisions.
    baseScorer:
      selectionMode === 'seeded-role-utility-band'
        ? seededRoleObjectiveScorer
        : roleObjectiveScorer,
    score: (context: CandidateScoringContext) =>
      scoreEvilRoleObjectiveCandidates(context, { selectionMode }),
  })
}

export const evilRoleObjectiveScorer = createEvilRoleObjectiveScorer({
  selectionMode: 'top-role-utility',
})

export const seededEvilRoleObjectiveScorer =
  createEvilRoleObjectiveScorer({
    selectionMode: 'seeded-role-utility-band',
  })

function scoreMorganaRoleCandidates(
  context: CandidateScoringContext,
): readonly CandidateScore[] {
  const projection = context.morganaRoleUtility
  if (
    !projection
    || projection.version !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    || context.view.role !== 'morgana'
    || (context.request.kind !== 'propose' && context.request.kind !== 'vote')
    || projection.request.kind !== context.request.kind
    || projection.request.seat !== context.request.seat
    || projection.request.round !== context.request.round
    || projection.request.proposalNum !== context.request.proposalNum
    || projection.source.beliefThroughSeq !== context.analysis.throughSeq
    || projection.candidates.length !== context.candidates.length
  ) {
    throw new Error('Morgana scorer requires an eligible bound utility')
  }
  const rows = new Map(
    projection.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  )
  const allowed = new Set(context.forced.allowedCandidateIds)
  if (
    rows.size !== context.candidates.length
    || !allowed.has(projection.selectedCandidateId)
    || (
      context.forced.selectedCandidateId !== undefined
      && context.forced.selectedCandidateId
        !== projection.selectedCandidateId
    )
  ) {
    throw new Error('Morgana scorer received an inconsistent selected set')
  }
  const version =
    projection.selectionMode
      === 'seeded-near-equal-vote-within-d2-band'
      ? MORGANA_ROLE_SEEDED_SCORER_VERSION
      : MORGANA_ROLE_SCORER_VERSION
  return context.candidates.map((candidate): CandidateScore => {
    const utility = rows.get(candidate.id)
    if (
      !utility
      || utility.forcedAllowed !== allowed.has(candidate.id)
      || utility.kind !== context.request.kind
    ) {
      throw new Error('Morgana scorer candidate join mismatch')
    }
    const selected = candidate.id === projection.selectedCandidateId
    return {
      version,
      candidateId: candidate.id,
      value: utility.forcedAllowed
        ? utility.counterfeitValue
        : -Number.MAX_SAFE_INTEGER,
      viable: utility.forcedAllowed && selected,
      reasonCodes: [
        ...(utility.forcedAllowed
          ? ['FORCED_POLICY_ALLOWED']
          : ['FORCED_POLICY_REMOVED']),
        ...(utility.inD2ViableBand
          ? ['MORGANA_D2_VIABLE_BAND']
          : ['MORGANA_D2_OUTSIDE_VIABLE_BAND']),
        ...(selected ? ['MORGANA_COUNTERFEIT_SELECTED'] : []),
        ...(projection.seedBucket === undefined
          ? []
          : ['MORGANA_COUNTERFEIT_SEEDED_VOTE_BAND']),
      ],
      morganaRoleObjectiveFeatures: {
        version: MORGANA_ROLE_SCORE_FEATURE_VERSION,
        utilityProjectionVersion:
          MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
        sourceCounterfeitObjectiveVersion:
          projection.source.morganaCounterfeitObjectiveVersion,
        sourceEvilRoleUtilityVersion:
          projection.source.evilRoleUtilityVersion,
        candidateId: candidate.id,
        kind: context.request.kind,
        d2RoleValue: utility.d2RoleValue,
        maxD2RoleValue: projection.maxD2RoleValue,
        d2BandFloor: projection.d2BandFloor,
        d2ViableBand: MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand,
        inD2ViableBand: utility.inD2ViableBand,
        counterfeitValue: utility.counterfeitValue,
        counterfeitRank: utility.counterfeitRank,
        selectionMode: projection.selectionMode,
        seededVoteCounterfeitBand:
          MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand,
        selectedByPolicy: selected,
        ...(projection.seedBucket === undefined
          ? {}
          : { seedBucket: projection.seedBucket }),
        utility: structuredClone(utility),
      },
    }
  })
}

export function createMorganaRoleScorer(options: {
  selectionMode: MorganaRoleSelectionMode
}): CandidateScorer {
  const seeded =
    options.selectionMode
      === 'seeded-near-equal-vote-within-d2-band'
  return Object.freeze({
    version: seeded
      ? MORGANA_ROLE_SEEDED_SCORER_VERSION
      : MORGANA_ROLE_SCORER_VERSION,
    morganaRoleUtilityRequirement:
      MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
    evilRoleUtilityRequirement: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
    baseScorer: seeded
      ? seededEvilRoleObjectiveScorer
      : evilRoleObjectiveScorer,
    score: scoreMorganaRoleCandidates,
  })
}

export const morganaRoleScorer = createMorganaRoleScorer({
  selectionMode: 'top-counterfeit-within-d2-band',
})

export const seededMorganaRoleScorer = createMorganaRoleScorer({
  selectionMode: 'seeded-near-equal-vote-within-d2-band',
})
