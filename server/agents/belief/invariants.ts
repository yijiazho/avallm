// Postcondition guards for the belief numeric layer.
//
// The belief math builds probability distributions that flow, unaudited, into
// decision scoring: a normalization or floating-point bug does not crash, it
// produces a subtly wrong posterior that only surfaces several layers
// downstream as a bad decision. These guards turn that silent corruption into a
// loud, attributable failure at the exact site that produced it.
//
// identity.ts already performs these same checks ad hoc on the CONSUMING side
// (normalized world total, complementary alignment marginals). This module is
// where the PRODUCING sites (exact.ts marginals and assessTeams) get the same
// coverage from one shared definition, so the invariant has a single home
// rather than a scattering of inline abs-difference comparisons.
//
// A thrown BeliefInvariantError rides the existing degradation rails: the
// cognition pipeline catches an inference failure and degrades the decision to
// the heuristic (it never stalls the game), exactly as it already does for the
// structurally identical throws in identity.ts.
//
// There is deliberately no single-value guard here, and adding one back would
// be a second answer to a question the tree already answers once. This module
// briefly carried an assertProbability alongside assertDistribution. It had no
// production caller, because there is no site that needs it: every probability
// the belief layer emits belongs to a distribution and is checked as one. A
// seat's alignment split is a two-element distribution, its role spread is a
// distribution over the cast, and a team's cleanProbability is index 0 of the
// evil-count distribution that assertDistribution already covers. The scalar
// case simply does not occur on the producing side.
//
// The question "is this one value a probability" belongs to `probability` in
// components/canonical-shape.ts, and it is asked on the CONSUMING side, of
// untrusted payloads, where the right answer is a strict predicate over [0, 1]
// with no slack. This module asks a different question of our own arithmetic
// and answers it with a throw and a tolerance. Keeping both under one roof
// invited exactly the drift canonical-shape.ts's header warns about: two
// spellings of one concept, differing in strictness, with nothing at the call
// site to say which contract was in force.
//
// The tolerance below never reaches that strict guard. Producers clamp what
// they emit (clampProbability in exact.ts, and the uniform kernel divides
// counts), so an out-of-range mass is a throw here rather than a value that
// passes this check and is later refused at the admission boundary.

import {
  addProbability,
  PROBABILITY_TOLERANCE,
  type CompensatedProbability,
} from '../components/probability-arithmetic.ts'

/** A belief distribution violated its own numeric contract. */
export class BeliefInvariantError extends Error {}

/**
 * A discrete distribution: every entry a valid probability mass, and the whole
 * summing to 1 up to tolerance. Returns the input so callers can assert inline.
 *
 * This used to widen the sum tolerance to `tolerance * values.length`, because
 * normalizing n worlds accumulates O(n) rounding steps and a flat 1e-12 would
 * false-trip a 10-player weighted posterior whose thousands of masses are each
 * individually exact. That reasoning was right about the problem and settled
 * for absorbing it. The sum is compensated now, so the O(n) term is gone at the
 * source and the flat tolerance is honest: what is left is the rounding already
 * present in the caller's own masses, which is bounded by one ulp of their
 * total no matter how many there are.
 *
 * Dropping the widening makes this guard roughly n times stricter, which is the
 * point of a postcondition. The scaled form still exists as accumulatedTolerance
 * in components/probability-arithmetic.ts, for the validators that check a total
 * they did not sum themselves and so cannot compensate.
 */
export function assertDistribution(
  values: readonly number[],
  label: string,
  tolerance: number = PROBABILITY_TOLERANCE,
): readonly number[] {
  const total: CompensatedProbability = { sum: 0, compensation: 0 }
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!Number.isFinite(value) || value < -tolerance) {
      throw new BeliefInvariantError(
        `${label}[${index}] is not a probability mass: ${value}`,
      )
    }
    addProbability(total, value)
  }
  // Finiteness is checked on the total, not just per element, and it has to be
  // checked explicitly rather than left to the comparison below. Every element
  // here is finite, but a sum of finite elements can still overflow, and once
  // it does the compensation term takes an Infinity minus Infinity and becomes
  // NaN. `Math.abs(NaN - 1) > tolerance` is false, so the tolerance check alone
  // would admit the most corrupted input this guard exists to reject. The naive
  // sum this replaced was accidentally safe there, since Infinity propagated
  // into the comparison and failed it.
  const sum = total.sum + total.compensation
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > tolerance) {
    throw new BeliefInvariantError(`${label} must sum to 1, got ${sum}`)
  }
  return values
}
