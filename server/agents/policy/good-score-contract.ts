export const CANDIDATE_SCORER_VERSION = 'compatibility-scorer-v1'
export const CALIBRATION_COMPATIBILITY_SCORER_VERSION =
  'calibration-compatibility-scorer-v1'
export const GOOD_PROPOSAL_SCORER_VERSION = 'good-proposal-scorer-v1'
export const GOOD_PROPOSAL_FEATURE_VERSION = 'good-proposal-features-v1'
export const GOOD_PROPOSAL_VOTE_SCORER_VERSION =
  'good-proposal-vote-scorer-v1'
export const GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION =
  'good-proposal-vote-seeded-band-v1'
export const GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION =
  'good-proposal-vote-board-swing-v1'
export const GOOD_VOTE_FEATURE_VERSION = 'good-vote-features-v1'
export const GOOD_VOTE_UTILITY_VERSION = 'good-vote-utility-v1'
export const GOOD_VOTE_BOARD_SWING_UTILITY_VERSION =
  'good-vote-utility-board-swing-v1'
export const ROLE_OBJECTIVE_SCORER_VERSION =
  'merlin-percival-role-scorer-v1'
export const ROLE_OBJECTIVE_SEEDED_SCORER_VERSION =
  'merlin-percival-role-seeded-band-v1'
export const ROLE_OBJECTIVE_SCORE_FEATURE_VERSION =
  'merlin-percival-role-score-features-v1'
export const ROLE_OBJECTIVE_UTILITY_VERSION =
  'merlin-percival-role-score-utility-v1'

export type GoodVoteSelectionMode = 'top-utility' | 'seeded-band'

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
  utilityVersion: GoodVoteUtilityVersion
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
  seedBucket?: 0 | 1
}

export const ROLE_OBJECTIVE_UTILITY_CONSTANTS = Object.freeze({
  centeredAdjustmentScale: 0.20,
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
  /**
   * NB-013. Not a tuned weight: a failed quest costs the good side exactly one
   * board slot, which is what a successful one gains, so valuing a vote by the
   * board swing it risks rather than by success alone makes this `1`. The
   * symmetric utility leaves the failure branch worth zero, which is what made
   * the vote objective permissive at an information-poor seat.
   */
  failedQuestCost: 1,
})

export type GoodVoteUtilityVersion =
  | typeof GOOD_VOTE_UTILITY_VERSION
  | typeof GOOD_VOTE_BOARD_SWING_UTILITY_VERSION

export const GOOD_VOTE_UTILITY_VERSIONS: readonly GoodVoteUtilityVersion[] =
  Object.freeze([
    GOOD_VOTE_UTILITY_VERSION,
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  ])

export function isGoodVoteUtilityVersion(
  value: unknown,
): value is GoodVoteUtilityVersion {
  return GOOD_VOTE_UTILITY_VERSIONS.includes(value as GoodVoteUtilityVersion)
}

/**
 * Everything the good-side vote value function reads. Board state arrives as
 * the two match-point flags rather than as a score, because that is all the
 * stake term uses and it is what an archived trace can restate.
 */
export interface GoodVoteValueInputs {
  readonly currentCleanProbability: number
  readonly bestAlternativeCleanProbability: number
  readonly matchPointGood: boolean
  readonly matchPointEvil: boolean
  readonly futureQuestsRemain: boolean
  readonly rejectionsBeforeHammer: number
}

export interface GoodVoteValue {
  readonly stake: number
  readonly alternativeRealization: number
  readonly hammerPenalty: number
  readonly informationBonus: number
  /**
   * What the approve branch gives up for the chance the team is dirty. Zero
   * under the symmetric utility, which is the defect NB-013 names.
   *
   * Deliberately not a recorded feature. Trace admission replays a decision and
   * compares the whole run for deep equality, so every archived field is part of
   * a format that pre-existing artifacts have to match. This one is derivable
   * from `stake`, `currentCleanProbability`, and the declared utility version,
   * all of which are already recorded, so archiving it would have broken every
   * stored trace to publish a number a reader can compute.
   */
  readonly dirtyApprovalCost: number
  readonly approveUtility: number
  readonly rejectUtility: number
}

/**
 * The one definition of the good-side vote value function.
 *
 * Three call sites need this arithmetic to agree exactly: the score layer that
 * produces the vote features, the scorer contract that validates them, and the
 * trace admission that restates them from an archived artifact. Admission
 * compares to `1e-12`, so three copies of the formula were three chances to
 * drift, and NB-013's second utility version would have made three copies six.
 *
 * The two versions differ in what a quest is worth. Both already price
 * rejecting a clean team, which costs one proposal, through
 * `alternativeRealization` and `hammerPenalty`. Neither the symmetric version
 * nor anything else priced approving a dirty team, which can cost a quest and
 * the game: the failure branch was simply worth zero. `board-swing` values each
 * branch by the board slot it risks, `P(clean) - P(dirty)`, so the costly error
 * finally costs something. That is the asymmetry NB-013 asks for, and it is
 * asymmetric in the error directions rather than in the branches: a wrong
 * approval gives up a slot, a wrong rejection gives up a proposal.
 *
 * Both branches are rescaled together on purpose. Pricing the failure branch of
 * only the approve side leaves the two branches on different scales, and the
 * measured effect was a policy that rejected nearly every clean team (NB-013's
 * progress-log entry records the numbers).
 *
 * Known simplification: the swing uses `1 - P(clean)`, the chance the team seats
 * any evil at all. On the one two-fail quest that 7-or-more-player tables deal,
 * a lone evil seat cannot fail the quest, so that case is priced as though it
 * could. Refining it needs the evil-count distribution and the quest's
 * `failsRequired` recorded in the features, which is deferred until this arm
 * earns a promotion.
 */
export function goodVoteValue(
  inputs: GoodVoteValueInputs,
  utilityVersion: GoodVoteUtilityVersion,
): GoodVoteValue {
  const constants = GOOD_VOTE_UTILITY_CONSTANTS
  const stake = 1
    + (inputs.matchPointGood ? constants.matchPointStakeBonus : 0)
    + (inputs.matchPointEvil ? constants.matchPointStakeBonus : 0)
  const alternativeRealization =
    constants.alternativeRealizationBase
    + constants.alternativeRealizationPerRejection
      * inputs.rejectionsBeforeHammer
  const hammerPenalty =
    constants.hammerPenaltyScale * (1 - inputs.rejectionsBeforeHammer / 4)
    + (inputs.rejectionsBeforeHammer === 1 ? constants.nextHammerPenalty : 0)
  const informationBonus = inputs.futureQuestsRemain
    ? constants.informationBonusScale * (1 - inputs.currentCleanProbability)
    : 0
  const swing = (probability: number): number =>
    utilityVersion === GOOD_VOTE_BOARD_SWING_UTILITY_VERSION
      ? probability - constants.failedQuestCost * (1 - probability)
      : probability
  const dirtyApprovalCost =
    stake * (inputs.currentCleanProbability - swing(
      inputs.currentCleanProbability,
    ))
  return Object.freeze({
    stake,
    alternativeRealization,
    hammerPenalty,
    informationBonus,
    dirtyApprovalCost,
    approveUtility:
      stake * swing(inputs.currentCleanProbability) + informationBonus,
    rejectUtility:
      stake
      * swing(inputs.bestAlternativeCleanProbability)
      * alternativeRealization
      - hammerPenalty,
  })
}

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

export { stablePolicyBucket } from './deterministic-policy.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
  type JointProbabilitySemantics,
} from '../analysis/types.ts'
