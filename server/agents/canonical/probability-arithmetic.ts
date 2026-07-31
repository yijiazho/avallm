/**
 * Numeric arithmetic shared by every layer that carries a probability: the
 * tolerance a comparison is allowed to spend, the unit-interval clamp, the
 * count-lattice check, the log-space pair that turns bounded log likelihoods
 * into masses, and the one selection margin that has to agree between the layer
 * that writes it and the admission that replays it. Belief, analysis, policy,
 * score layers, admission, and communication are all in scope, on the same
 * argument canonical-shape.ts makes next door: a constant that is weaker or
 * looser at one call site than another is a hole at that site only.
 *
 * canonical-shape.ts owns the shared *predicates*, and ARCH016 scans the tree
 * for private copies of them. That scan reads return types, and its own doc
 * comment records the exclusion: a helper returning a number never enters the
 * predicate set. So nothing scanned this half of the same problem, and the
 * duplication went where nobody was looking. When this module was written the
 * tree held 83 raw tolerance literals across 14 files against the single named
 * constant, six copies of the unit clamp under two different names plus five
 * more spelled inline, and four private `close` comparators, one of which had
 * dropped the constant and written `1e-12` by hand. ARCH017 is the numeric
 * collector that closes that gap; see tools/architecture-fitness.mjs.
 *
 * The two tolerances are deliberately not one value, and unifying them is the
 * tempting wrong move: it would either loosen a strict check or break a passing
 * one, and either way it would erase the evidence of where real drift is. They
 * are named for what distinguishes them instead, so a call site has to say
 * which contract it wanted.
 *
 * This module imports one predicate and nothing else. Keeping it a near-leaf is
 * what lets belief, analysis, policy, and admission all depend on it without
 * closing a cycle back through any of them.
 */

import { probability } from './canonical-shape.ts'

/**
 * One computed value against one other computed value.
 *
 * The overwhelming majority of comparisons in this layer are of this shape: a
 * validator recomputes a quantity from the same inputs the producer used and
 * checks the two agree. Both sides run the same operations in the same order,
 * so the honest expectation is exact equality and this is slack for a division
 * round trip, not for accumulated error.
 */
export const PROBABILITY_TOLERANCE = 1e-12

/*
 * There is deliberately no second, looser tolerance for accumulated sums.
 *
 * Two have been tried and both were removed. A flat 1e-9 came first, sized for
 * "a worst case the call site cannot see". Then a scaled accumulatedTolerance
 * (PROBABILITY_TOLERANCE per term), which was the better frame and survived
 * about a day: it existed for validators that check a total they did not sum
 * and so cannot compensate, and on inspection every one of its seven call sites
 * ran the reduce itself. There were no instances of the case it was written
 * for.
 *
 * So the rule is the one below rather than a constant: if a comparison needs
 * more than PROBABILITY_TOLERANCE, the summation is the thing to fix. Every
 * total in this tree is now built with stableProbabilitySum or addProbability
 * and compares at the single-value tolerance regardless of length, measured
 * exact through 60,480 terms and 1.1e-16 at 3.6M. A future site that genuinely
 * receives a pre-summed total it cannot recompute would need slack again, and
 * should say so at the call site rather than reintroduce a shared constant that
 * six other sites quietly inherit.
 */

/**
 * The amount a seeded selection is lifted above the best base value, so the
 * seeded candidate is strictly the maximum rather than tied with it.
 *
 * Not a tolerance. It is a policy constant that happens to be small, and it
 * lives here because it has to be the same number in six modules at once: the
 * good and evil score layers and the compatibility scorer write it into
 * `selectionAdjustment`, and the good-vote contract and composed-trace
 * admission recompute it to decide whether a trace is host reconstructable. A
 * drift between producer and replayer there rejects otherwise valid traces, and
 * nothing about the two spellings would say why.
 */
export const SEEDED_SELECTION_MARGIN = 1e-9

/**
 * How far a replayed `selectionAdjustment` may sit from the recomputed one.
 *
 * Tighter than PROBABILITY_TOLERANCE because it is not a probability
 * comparison at all: the replayer performs the identical subtraction on the
 * identical doubles, so agreement is expected to the last bit and this exists
 * only to keep the comparison from being a bare `!==` on a float.
 */
export const SELECTION_ADJUSTMENT_REPLAY_TOLERANCE = 1e-15

/**
 * A running total plus the rounding it has already thrown away.
 *
 * Public because the grouped projections in `belief/identity.ts` accumulate
 * into one of these per hypothesis while streaming the world list, which no
 * whole-array sum can express.
 */
export interface CompensatedProbability {
  sum: number
  compensation: number
}

/**
 * One Neumaier compensated addition.
 *
 * The naive alternative is not merely less pretty. A ten-player servant view
 * enumerates up to 60,480 feasible worlds, and adding 1/N of them left to right
 * lands as far as 1.6e-12 from 1, which is past PROBABILITY_TOLERANCE: the
 * strict check rejects a belief that is correct. Compensation brings the same
 * sum to within one machine epsilon, so the caller's probabilities survive
 * without rounding, renormalizing, or widening the tolerance.
 *
 * Below roughly 20,000 terms naive addition stays inside the strict tolerance,
 * so most totals in the tree would pass either way. That is a property of how
 * many worlds a given seat's private information leaves standing, which is not
 * visible at the summing call site. Compensating every probability total that
 * faces a strict comparison is what keeps the answer from depending on it.
 */
export function addProbability(
  accumulator: CompensatedProbability,
  addend: number,
): void {
  const next = accumulator.sum + addend
  accumulator.compensation +=
    Math.abs(accumulator.sum) >= Math.abs(addend)
      ? (accumulator.sum - next) + addend
      : (addend - next) + accumulator.sum
  accumulator.sum = next
}

/** Compensated total of a bounded probability support. */
export function stableProbabilitySum<T>(
  values: Iterable<T>,
  probabilityOf: (value: T) => number,
): number {
  const accumulator: CompensatedProbability = {
    sum: 0,
    compensation: 0,
  }
  for (const value of values) {
    addProbability(accumulator, probabilityOf(value))
  }
  return accumulator.sum + accumulator.compensation
}

/**
 * A log likelihood held inside a symmetric bound, and whether the bound bit.
 *
 * The `capped` flag is not decoration. A likelihood factor records the clamp it
 * applied in its provenance, so the belief snapshot can say a contribution was
 * limited rather than silently reporting the limited value as the model's own
 * opinion.
 */
export interface CappedLogLikelihood {
  value: number
  capped: boolean
}

/**
 * Clamp a log likelihood to +/- absoluteCap.
 *
 * The log-space sibling of clampProbability, and here for the same reason: it
 * is the one place a factor's contribution is bounded, and a second copy with a
 * different idea about a non-finite input or a nonpositive cap would be a hole
 * at that factor only. Unlike the probability clamps it rejects rather than
 * saturates, because an infinite log likelihood means the factor priced a world
 * at zero and that is a modelling failure to surface, not a value to round.
 */
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
 * and dividing by the total knows or cares what the weights are attached to.
 * The belief layer zips hidden worlds back onto the result; a second caller
 * with a different domain gets to reuse the arithmetic without inheriting that
 * type, which is what put this here rather than beside the worlds.
 *
 * The maximum is folded rather than spread, and the weights are walked by index
 * rather than through `some` and `map`. Both are about what the array-method
 * spellings quietly tolerate, not about the arithmetic, which is unchanged.
 *
 * `Math.max(...weights)` passes one argument per element and throws a
 * RangeError past roughly 125,000 of them on this V8 (measured; it is a stack
 * limit, so it is not a fixed number). Today's largest real input is the
 * ~60,480 feasible worlds a ten-player servant view carries, which clears that
 * comfortably, so the spread was not a live bug. It is that an argument-count
 * ceiling has nothing to do with normalizing a vector, the fold returns the
 * identical double for every input, and a limit nobody has a reason to think
 * about is better not present.
 *
 * The index walk exists because the spread was also, by accident, the only
 * thing rejecting a sparse weight vector. `some`, `map` and `reduce` all skip
 * array holes, but spreading one materializes it as `undefined`, which made the
 * maximum NaN, the total NaN, and tripped the invalid-total guard below. Fold
 * the maximum instead and the hole is skipped end to end: the vector passes
 * every check and comes back carrying a hole, which the caller reads as an
 * `undefined` probability sitting in a `readonly number[]`. So the rejection
 * that used to be a side effect of the spelling is now written down.
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

/** The closed unit interval, for a value already known to be a number. */
export const clampProbability = (value: number): number =>
  Math.max(0, Math.min(1, value))

/**
 * As clampProbability, but a non-finite input becomes 0 rather than NaN.
 *
 * A separate name because it is a separate contract, and only one caller wants
 * it: `policy/plan.ts` clamps feature values that arrived through an untrusted
 * trace, where NaN means "the producer sent nothing usable" and 0 is the safe
 * reading. Everywhere else NaN reaching a clamp is a bug that should stay
 * visible, so the plain clamp lets it through as NaN.
 */
export const clampProbabilityOrZero = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/** Two probabilities agree to PROBABILITY_TOLERANCE. */
export const closeProbability = (left: number, right: number): boolean =>
  Math.abs(left - right) <= PROBABILITY_TOLERANCE

/**
 * Denominator-scaled machine epsilons for a count-space comparison.
 *
 * Sixteen of them admits an ordinary division round trip while keeping a
 * one-world snapshot effectively exact. Scaling with the denominator is the
 * whole point: the check happens after multiplying a probability back up by the
 * world count, so the tolerance has to grow with the same factor the value did.
 * In probability space it is a constant 16 machine epsilons, roughly 3.6e-15,
 * which is tighter than PROBABILITY_TOLERANCE at every table size.
 */
export const COUNT_LATTICE_ULP_MULTIPLIER = 16

export const countLatticeTolerance = (worldCount: number): number =>
  COUNT_LATTICE_ULP_MULTIPLIER * Number.EPSILON * worldCount

/**
 * The integer world count a uniform marginal encodes, or undefined if it is not
 * on the lattice at all.
 *
 * A uniform posterior over N feasible worlds can only produce marginals of the
 * form k/N for an integer k, so the right question about one is "which k" and
 * not "is it within a decimal slack of something". Granting a fixed 1e-12 to a
 * value that is exactly 1 or exactly 0 admits payloads that are not marginals
 * of any world set; recovering k and comparing integers admits exactly the ones
 * that are. This was written once, correctly, in `analysis/observer.ts`, with
 * the argument in a comment; the same check elsewhere in the tree was a flat
 * literal until that comment was taken at its word.
 */
export function latticeCount(
  value: unknown,
  worldCount: number,
): number | undefined {
  if (!probability(value)) return undefined
  const scaled = value * worldCount
  const nearest = Math.round(scaled)
  return Math.abs(scaled - nearest) <= countLatticeTolerance(worldCount)
    ? nearest
    : undefined
}
