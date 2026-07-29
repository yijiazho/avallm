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

export { stablePolicyBucket } from './deterministic-policy.ts'
