export const EVIL_ROLE_OBJECTIVE_SCORER_VERSION =
  'evil-oberon-role-scorer-v1'
export const EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION =
  'evil-oberon-role-seeded-band-v1'
export const EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION =
  'evil-oberon-role-score-features-v1'
export const EVIL_ROLE_OBJECTIVE_UTILITY_VERSION =
  'evil-oberon-role-score-utility-v1'

export const EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS = Object.freeze({
  viableBand: 0.04,
})

export type EvilRoleObjectiveSelectionMode =
  | 'top-role-utility'
  | 'seeded-role-utility-band'
