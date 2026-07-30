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

import { PROBABILITY_TOLERANCE } from '../components/probability-arithmetic.ts'

/** A belief distribution violated its own numeric contract. */
export class BeliefInvariantError extends Error {}

/**
 * A single probability must be finite and within [0, 1] up to tolerance.
 * Returns the value so callers can assert inline.
 */
export function assertProbability(
  value: number,
  label: string,
  tolerance: number = PROBABILITY_TOLERANCE,
): number {
  if (!Number.isFinite(value) || value < -tolerance || value > 1 + tolerance) {
    throw new BeliefInvariantError(`${label} is not a probability: ${value}`)
  }
  return value
}

/**
 * A discrete distribution: every entry a valid probability mass, and the whole
 * summing to 1 up to tolerance. Returns the input so callers can assert inline.
 *
 * The sum tolerance scales with the number of terms. Normalizing n worlds
 * accumulates up to O(n) rounding steps, so a flat 1e-12 would false-trip a
 * 10-player weighted posterior whose thousands of masses are each individually
 * exact. A genuine normalization bug misses by a whole fraction, orders of
 * magnitude above this ceiling, so the scaling never hides a real defect.
 */
export function assertDistribution(
  values: readonly number[],
  label: string,
  tolerance: number = PROBABILITY_TOLERANCE,
): readonly number[] {
  let sum = 0
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!Number.isFinite(value) || value < -tolerance) {
      throw new BeliefInvariantError(
        `${label}[${index}] is not a probability mass: ${value}`,
      )
    }
    sum += value
  }
  const sumTolerance = tolerance * Math.max(1, values.length)
  if (Math.abs(sum - 1) > sumTolerance) {
    throw new BeliefInvariantError(`${label} must sum to 1, got ${sum}`)
  }
  return values
}
