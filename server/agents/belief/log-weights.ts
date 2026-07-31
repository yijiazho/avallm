import type { HiddenWorld, WeightedWorld } from './types.ts'

export interface CappedLogLikelihood {
  value: number
  capped: boolean
}

export function capLogLikelihood(
  value: number,
  absoluteCap: number,
): CappedLogLikelihood {
  if (!Number.isFinite(value)) {
    throw new Error(`log likelihood must be finite, got ${value}`)
  }
  if (!Number.isFinite(absoluteCap) || absoluteCap <= 0) {
    throw new Error(`log likelihood cap must be positive, got ${absoluteCap}`)
  }
  const bounded = Math.max(-absoluteCap, Math.min(absoluteCap, value))
  return { value: bounded, capped: bounded !== value }
}

/**
 * Stable log-sum-exp: the probabilities a finite log-weight vector encodes.
 *
 * Domain-free on purpose. Nothing about subtracting the maximum, exponentiating
 * and dividing by the total knows or cares what the weights are attached to,
 * and the hidden world was never an input to the arithmetic; it was only the
 * thing zipped back onto the answer. Splitting the two apart is what lets a
 * second normalization policy reuse this core without inheriting the belief
 * layer's types, and what lets the arithmetic be tested as arithmetic.
 *
 * The maximum is folded rather than spread, and the weights are walked by index
 * rather than through `some` and `map`. Both are about what the array-method
 * spellings quietly tolerate, not about the arithmetic, which is unchanged.
 *
 * `Math.max(...weights)` passes one argument per element and throws a
 * RangeError past roughly 125,000 of them on this V8 (measured; it is a stack
 * limit, so it is not a fixed number). Today's largest real input is the
 * ~60,480 feasible worlds a ten-player servant view carries, which clears that
 * comfortably, so the spread was not a live bug and this is not a fix. It is
 * that an argument-count ceiling has nothing to do with normalizing a vector,
 * the fold returns the identical double for every input, and a limit nobody has
 * a reason to think about is better not present.
 *
 * The index walk exists because the spread was also, by accident, the only
 * thing rejecting a sparse weight vector. `some`, `map` and `reduce` all skip
 * array holes, but spreading one materializes it as `undefined`, which made the
 * maximum NaN, the total NaN, and tripped the invalid-total guard below. Fold
 * the maximum instead and the hole is skipped end to end: the vector passes
 * every check and comes back carrying a hole, which the caller reads as an
 * `undefined` probability sitting in a `readonly number[]`. So the rejection
 * that used to be a side effect of the spelling is now written down. Reading
 * each slot by index turns a hole into `undefined` at the guard, where
 * `Number.isFinite` rejects it like any other non-number.
 */
export function logWeightsToProbabilities(
  logWeights: readonly number[],
): readonly number[] {
  if (!logWeights.length) {
    throw new Error('log-weight normalization requires at least one weight')
  }
  let maximum = -Infinity
  for (let index = 0; index < logWeights.length; index++) {
    const weight = logWeights[index]
    if (!Number.isFinite(weight)) {
      throw new Error('log-weight normalization requires finite weights')
    }
    if (weight > maximum) maximum = weight
  }
  const relative = logWeights.map((weight) => Math.exp(weight - maximum))
  const total = relative.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('log-weight normalization produced invalid total weight')
  }
  return relative.map((weight) => weight / total)
}

/** Stable log-sum-exp normalization over feasible worlds only. */
export function normalizeLogWeights(
  worlds: readonly HiddenWorld[],
  logWeights: readonly number[],
): readonly WeightedWorld[] {
  if (!worlds.length || worlds.length !== logWeights.length) {
    throw new Error('log-weight normalization requires one weight per world')
  }
  const probabilities = logWeightsToProbabilities(logWeights)
  return worlds.map((world, index) => ({
    world,
    probability: probabilities[index],
  }))
}
