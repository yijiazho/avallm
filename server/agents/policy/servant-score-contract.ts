/**
 * The servant score family's contract: two scorer identities and the two
 * constants its layer ranks with.
 *
 * Kept beside the evil and good contracts rather than inside the family module
 * because policy/score.ts owns the scorer descriptors and score-layers/servant.ts
 * owns the layer, and both have to agree on these strings without importing
 * each other.
 */

export const SERVANT_ROLE_SCORER_VERSION =
  'servant-public-read-role-scorer-v1'
/**
 * The seeded identity selects exactly as the deterministic one does, and there
 * is no selection-mode union or factory here because there is nothing to
 * choose. Every seeded band in this codebase is the two-candidate vote band,
 * and this family is propose only, so the seeded scorer exists to carry the
 * servant refinement onto the seeded base chain rather than to vary the pick.
 */
export const SERVANT_ROLE_SEEDED_SCORER_VERSION =
  'servant-public-read-role-seeded-v1'

export const SERVANT_ROLE_UTILITY_CONSTANTS = Object.freeze({
  /**
   * Deliberately the same 0.20 the good role layer centers with, and for the
   * same reason: the adjustment is a tie-breaker on top of a joint-probability
   * base, not a competing objective. It is stated here rather than imported so
   * that retuning one family cannot silently retune the other.
   *
   * Against the measured spread of 0.22 to 0.27 this yields roughly 0.05, which
   * decides a proposal whose base gap is exactly 0.0000 (75 of 76 servant
   * proposals in the phase-4 bank) and cannot overturn a base gap wider than
   * that.
   */
  centeredAdjustmentScale: 0.20,
  /**
   * Below this spread across the survivors the public read has said nothing,
   * and the layer stamps that on every row instead of letting a float residue
   * read as a ranking. Not a selection band: the layer still takes its top
   * candidate, because on a genuinely flat board every survivor scores the
   * same and the canonical tie-break is the honest answer.
   *
   * It exists so the flatness is visible in a trace. Measured by round, this
   * layer separates 0% of round-one proposals and 100% of round-four and
   * round-five ones, and a reader of a single trace could not otherwise tell
   * which case they were looking at.
   */
  separationBand: 0.01,
})
