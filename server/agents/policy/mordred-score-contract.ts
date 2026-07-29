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
