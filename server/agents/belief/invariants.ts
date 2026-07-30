// Postcondition guard for the belief numeric layer.
//
// The belief math builds probability distributions that flow, unaudited, into
// decision scoring: a normalization or floating-point bug does not crash, it
// produces a subtly wrong posterior that only surfaces several layers
// downstream as a bad decision. `assertDistribution` turns that silent
// corruption into a loud, attributable failure at the site that produced it.
//
// A thrown BeliefInvariantError rides the existing degradation rails: the
// cognition pipeline catches an inference failure and degrades the decision to
// the heuristic (it never stalls the game).
//
// There is deliberately no single-value guard: every probability the belief
// layer emits belongs to a distribution and is checked as one. The strict
// predicate for a lone value over [0, 1] is `probability` in
// components/canonical-shape.ts, asked on the consuming side of untrusted
// payloads; this module asks a different question of our own arithmetic and
// answers it with a throw and a tolerance.

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
 * The sum is compensated, so the tolerance stays flat rather than widening with
 * `values.length`: the O(n) rounding a naive left-to-right sum would accumulate
 * is gone at the source, leaving only the rounding already present in the
 * caller's own masses.
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
