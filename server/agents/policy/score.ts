import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
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
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type MorganaRoleCandidateUtility,
  type MorganaRoleSelectionMode,
  type PrivateMorganaRoleUtilityProjection,
} from '../analysis/morgana-role-utility.ts'
import {
  CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
  type GoodVoteSelectionMode,
} from './good-score-contract.ts'
import { compareCandidateIds } from './candidates.ts'
import { calculateCompatibilityBase } from './compatibility-score.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
  type EvilRoleObjectiveSelectionMode,
} from './evil-score-contract.ts'
export {
  CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_REASON_CODES,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_REASON_CODES,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  goodVoteValue,
  isGoodVoteUtilityVersion,
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

/**
 * Scorer identities for the Mordred and Assassin specializations and for the
 * full-role terminal that composes the whole stack. These live here beside the
 * descriptors that carry them rather than in per-family contract modules: a
 * concrete family already imports this module for its descriptor, and this
 * module imports nothing from `score-layers/`, so there is no cycle for a
 * separate constants module to break.
 */
export const MORDRED_BLINDNESS_ROLE_SCORER_VERSION =
  'mordred-blindness-role-scorer-v1'
export const MORDRED_BLINDNESS_ROLE_SEEDED_SCORER_VERSION =
  'mordred-blindness-role-seeded-vote-band-v1'

export const MORDRED_BLINDNESS_ROLE_UTILITY_CONSTANTS = Object.freeze({
  seededVoteBand: 0.04,
})

export type MordredBlindnessRoleSelectionMode =
  | 'top-opportunity-within-d2-band'
  | 'seeded-near-equal-vote-within-d2-band'

export const ASSASSIN_MERLIN_TARGET_SCORER_VERSION =
  'assassin-merlin-target-scorer-v1'

/**
 * Byte ceiling on a caller-supplied score surface.
 *
 * This bound used to apply only when the scorer declared one of six built-in
 * role version strings, which inverted the threat model: validateCandidateScores
 * runs exclusively on custom scorers (custom-scoring, and decision-frame only
 * under authority 'custom'), so the versions that skipped the cap were precisely
 * the ones the host does not vouch for. A plugin declaring any other version was
 * unbounded, and the native score-layer ceiling that would otherwise catch it
 * lives on a path custom scorers never take.
 *
 * Same value as MAX_SCORE_LAYER_SURFACE_JSON_BYTES, deliberately duplicated
 * rather than imported: this module imports nothing from score-layer/ (see the
 * scorer-identity note above), and pulling the ceiling in from there would add
 * that edge. score-surface-bounds.test.ts pins the two constants equal so the
 * copies cannot drift.
 */
export const MAX_CANDIDATE_SCORE_SURFACE_JSON_BYTES = 1_048_576

export const FULL_ROLE_POLICY_SCORER_VERSION =
  'full-role-policy-scorer-v1'
export const FULL_ROLE_STACK_ATTRIBUTION_REASON =
  'FULL_ROLE_STACK_ATTRIBUTION'

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

/**
 * The single viable candidate a scorer surface elects: highest value, ties
 * broken by the lower candidate id.
 */
export function selectTopViableScore(
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
  /**
   * NB-013. `symmetric` leaves approving a dirty team worth zero rather than
   * negative, which is the measured Phase 4B behavior. `board-swing` values each
   * branch by the board slot it risks. Only the deterministic top-utility mode
   * has a board-swing twin so far, because that is the arm the gate compares
   * against; a seeded twin waits on the result.
   */
  voteValue?: 'symmetric' | 'board-swing'
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

const BOARD_SWING_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
    analysisRequirement: 'joint-proposal-vote-team-assessments',
  })

/**
 * Opt-in Phase 4B policy factory. Top-utility mode is the deterministic vote
 * ablation; seeded-band mode varies only near-equivalent forced survivors.
 * NB-013's weighted vote value is a separate recorded identity, because a
 * different value function is a different policy and must not be able to report
 * itself as the arm that was measured without it.
 */
export function createGoodProposalVoteScorer(
  options: GoodProposalVoteScorerOptions,
): CandidateScorer {
  if (options.voteValue === 'board-swing') {
    if (options.selectionMode !== 'top-utility') {
      throw new Error(
        'the board-swing vote value has no seeded-band twin yet',
      )
    }
    return BOARD_SWING_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR
  }
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

/** NB-013 candidate: the Phase 4B ablation with the dirty branch priced. */
export const boardSwingGoodProposalVoteScorer =
  BOARD_SWING_GOOD_PROPOSAL_VOTE_SCORER_DESCRIPTOR

/**
 * Resolve a role-scorer factory's two-mode dispatch: the seeded descriptor when
 * the requested mode is the seeded one, otherwise the deterministic descriptor.
 * The generic keeps `seededMode` bound to the option's own mode union.
 */
function pickBySelectionMode<M extends string>(
  selectionMode: M,
  seededMode: M,
  deterministic: CandidateScorer,
  seeded: CandidateScorer,
): CandidateScorer {
  return selectionMode === seededMode ? seeded : deterministic
}

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
  return pickBySelectionMode(
    options.selectionMode,
    'seeded-composite-band',
    ROLE_OBJECTIVE_SCORER_DESCRIPTOR,
    SEEDED_ROLE_OBJECTIVE_SCORER_DESCRIPTOR,
  )
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
  return pickBySelectionMode(
    options.selectionMode,
    'seeded-role-utility-band',
    EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR,
    SEEDED_EVIL_ROLE_OBJECTIVE_SCORER_DESCRIPTOR,
  )
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
  return pickBySelectionMode(
    options.selectionMode,
    'seeded-near-equal-vote-within-d2-band',
    MORGANA_ROLE_SCORER_DESCRIPTOR,
    SEEDED_MORGANA_ROLE_SCORER_DESCRIPTOR,
  )
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
  return pickBySelectionMode(
    options.selectionMode,
    'seeded-near-equal-vote-within-d2-band',
    MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR,
    SEEDED_MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR,
  )
}

export const mordredBlindnessRoleScorer =
  MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR

export const seededMordredBlindnessRoleScorer =
  SEEDED_MORDRED_BLINDNESS_ROLE_SCORER_DESCRIPTOR

const ASSASSIN_MERLIN_TARGET_SCORER_DESCRIPTOR: CandidateScorer =
  Object.freeze({
    version: ASSASSIN_MERLIN_TARGET_SCORER_VERSION,
    baseScorer: evilRoleObjectiveScorer,
  })

/** Opt-in E3B scorer. Ineligible or degraded runs use the D2 base chain. */
export const assassinMerlinTargetScorer =
  ASSASSIN_MERLIN_TARGET_SCORER_DESCRIPTOR

/**
 * One role-independent scorer identity for the complete deterministic role
 * stack. Concrete applicability remains owned by registered score layers.
 */
export const fullRolePolicyScorer: CandidateScorer = Object.freeze({
  version: FULL_ROLE_POLICY_SCORER_VERSION,
  baseScorer: morganaRoleScorer,
})
