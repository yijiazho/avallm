// The one statistics core behind every published evaluation number.
//
// architecture-report.ts and vote-conversion-report.ts are paired reports: they
// summarize the same corpus through two lenses and their figures get cited side
// by side in docs/. Commit ede7c78 gave them one matched-table law; the
// estimator underneath it stayed forked, so a correction applied to one (a
// continuity correction, a different z, a change to the resampling scheme) left
// the other publishing the old number with no test failing. Both now import
// from here, and test/eval-statistics.test.ts pins the interval against
// hand-computed values so the estimator has a contract of its own.
//
// Everything here is pure and total: no clock, no ambient randomness, no I/O.
// The bootstrap takes its uniform stream as an argument rather than reaching
// for Math.random, so a report's intervals are a function of its seed alone.

import { fnv1a } from '../../shared/prng.ts'

/** Two-sided 95 percent standard normal quantile, z(0.975). */
export const NORMAL_QUANTILE_95 = 1.959963984540054

/** Resamples drawn per paired bootstrap. */
export const BOOTSTRAP_RESAMPLES = 5_000

/*
 * Log-loss clipping bounds. These are NOT tolerances.
 *
 * A tolerance is slack a comparison may spend; these are the distance a
 * probability is held away from an endpoint so Math.log stays finite. A
 * degenerate posterior really does emit exactly 0, and log(0) would make the
 * whole score -Infinity, so the clip decides what a confidently wrong
 * prediction costs rather than absorbing rounding. That is why they live here
 * and not in the agent tree's probability-arithmetic.ts, whose header spends a
 * paragraph on why a second tolerance must not quietly join the first: these
 * are not that, and folding them in would make both harder to read.
 *
 * The two values are deliberately reported rather than reconciled. They were
 * written independently, at different magnitudes, for the same job; naming them
 * is what made that visible. Unifying them is a real change to a published
 * number, since the clip sets the floor on a degenerate row's log loss
 * (-27.6 at 1e-12 against -34.5 at 1e-15), so it wants a decision and a rerun,
 * not a tidy-up. Until then each call site keeps the value it was measured
 * with.
 */

/** One-sided floor under the true class's mass in the multiclass log loss. */
export const MULTICLASS_LOG_LOSS_CLIP = 1e-12

/** Two-sided clip on a binary probability before its log loss. */
export const BINARY_LOG_LOSS_CLIP = 1e-15

export interface RateEstimate {
  successes: number
  trials: number
  rate: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface RateDeltaEstimate {
  delta: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface RateCount {
  successes: number
  trials: number
}

export function mean(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

/**
 * Median with the middle pair averaged on an even sample, so a two-sample
 * median sits between the observations rather than picking one arbitrarily.
 * Unlike nearestRank this can report a value the corpus never produced, which
 * is why the two are separate functions rather than nearestRank(values, 0.5).
 * Returns null for an empty sample.
 */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2
}

/** Left fold of a projected field. Total of an empty set is zero, not null. */
export function sumOf<T>(
  items: readonly T[],
  select: (item: T) => number,
): number {
  return items.reduce((total, item) => total + select(item), 0)
}

/**
 * Mean of a projected field, without materializing the projection. Same fold
 * order as mean(), so a caller that switches between them keeps its figures.
 */
export function meanOf<T>(
  items: readonly T[],
  select: (item: T) => number,
): number | null {
  return items.length ? sumOf(items, select) / items.length : null
}

/**
 * Wilson score interval, no continuity correction. Chosen over the normal
 * approximation because these reports routinely publish rates over a handful of
 * trials, where the Wald interval runs off the end of [0, 1].
 */
export function rate(successes: number, trials: number): RateEstimate {
  if (!trials) {
    return { successes, trials, rate: null, interval95: null }
  }
  const estimate = successes / trials
  const z = NORMAL_QUANTILE_95
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (estimate + z2 / (2 * trials)) / denominator
  const radius = z * Math.sqrt(
    estimate * (1 - estimate) / trials
    + z2 / (4 * trials * trials),
  ) / denominator
  return {
    successes,
    trials,
    rate: estimate,
    interval95: {
      low: Math.max(0, center - radius),
      high: Math.min(1, center + radius),
    },
  }
}

export interface MeanEstimate {
  observations: number
  mean: number | null
  standardError: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

/**
 * Mean of a continuous sample with its normal 95% interval.
 *
 * The counterpart to `rate` for quantities that are not proportions, and it
 * lives here for the same reason `rate` does: the first continuous metric to
 * need one was about to spell the z quantile a second time, which is exactly
 * the fork this module exists to prevent.
 *
 * Variance carries the n-1 correction, because these are draws from a wider
 * population of games rather than a whole population. A single observation
 * reports its mean and no interval, which is the truthful answer: one draw
 * bounds nothing.
 */
export function meanEstimate(values: readonly number[]): MeanEstimate {
  if (!values.length) {
    return { observations: 0, mean: null, standardError: null, interval95: null }
  }
  const center = values.reduce((sum, value) => sum + value, 0) / values.length
  if (values.length === 1) {
    return {
      observations: 1,
      mean: center,
      standardError: null,
      interval95: null,
    }
  }
  const variance = values.reduce(
    (sum, value) => sum + (value - center) ** 2,
    0,
  ) / (values.length - 1)
  const standardError = Math.sqrt(variance / values.length)
  const radius = NORMAL_QUANTILE_95 * standardError
  return {
    observations: values.length,
    mean: center,
    standardError,
    interval95: { low: center - radius, high: center + radius },
  }
}

/**
 * Nearest-rank percentile: the smallest observed value at or above the given
 * probability. Reports an observation rather than interpolating between two, so
 * a published percentile is always a number the corpus actually produced.
 * Returns null for an empty sample.
 */
export function nearestRank(
  values: readonly number[],
  probability: number,
): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(
    0,
    Math.ceil(probability * ordered.length) - 1,
  )]
}

/**
 * The engine's FNV-1a over the seed string, into an xorshift32 stream. Named so
 * both reports derive the same uniforms from the same seed; the bootstrap itself
 * only ever sees the resulting function.
 *
 * The stream is xorshift32 rather than the engine's mulberry32 (`makeRng`)
 * because these are published intervals: every figure in docs/ was produced by
 * this generator, and swapping it would silently move all of them. Only the hash
 * is shared. test/eval-statistics.test.ts pins the first draws as literals so
 * any future change to either half has to be deliberate.
 *
 * The shared hash is not a drop-in for every string: it folds UTF-16 code units
 * where the inline loop it replaced folded code points, so the two disagree on
 * astral characters. Seeds here are `bank:baseline:candidate:metric`, built only
 * from bank and variant identifiers that are code literals, so no seed reaches
 * that difference and no untrusted string reaches a seed at all.
 */
export function seededRandom(seed: string): () => number {
  // fnv1a can land on zero and xorshift is stuck at zero forever.
  let state = fnv1a(seed) || 1
  return (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

/**
 * Game-paired bootstrap over a rate difference. Count selectors may expose
 * per-game denominators, so quest- and vote-level rates retain deal pairing:
 * a resample draws whole (baseline, candidate) pairs, never one arm's games
 * independently of the other's.
 *
 * `random` must return uniforms in [0, 1). Pass `seededRandom(seed)` for a
 * report whose intervals must be reproducible from its seed.
 */
export function pairedBootstrapRateDelta<T>(
  pairs: readonly Readonly<{ baseline: T; candidate: T }>[],
  select: (value: T) => RateCount,
  random: () => number,
): RateDeltaEstimate {
  const aggregate = (
    selected: readonly T[],
  ): RateCount => selected.reduce<RateCount>(
    (total, value) => {
      const count = select(value)
      return {
        successes: total.successes + count.successes,
        trials: total.trials + count.trials,
      }
    },
    { successes: 0, trials: 0 },
  )
  const baseline = aggregate(pairs.map((pair) => pair.baseline))
  const candidate = aggregate(pairs.map((pair) => pair.candidate))
  if (!pairs.length || !baseline.trials || !candidate.trials) {
    return { delta: null, interval95: null }
  }
  const delta =
    candidate.successes / candidate.trials
    - baseline.successes / baseline.trials
  const samples: number[] = []
  for (let repetition = 0; repetition < BOOTSTRAP_RESAMPLES; repetition++) {
    const selected: Array<(typeof pairs)[number]> = []
    for (let index = 0; index < pairs.length; index++) {
      selected.push(pairs[Math.floor(random() * pairs.length)])
    }
    const sampledBaseline = aggregate(
      selected.map((pair) => pair.baseline),
    )
    const sampledCandidate = aggregate(
      selected.map((pair) => pair.candidate),
    )
    if (!sampledBaseline.trials || !sampledCandidate.trials) continue
    samples.push(
      sampledCandidate.successes / sampledCandidate.trials
      - sampledBaseline.successes / sampledBaseline.trials,
    )
  }
  return {
    delta,
    interval95: samples.length
      ? {
          low: nearestRank(samples, 0.025)!,
          high: nearestRank(samples, 0.975)!,
        }
      : null,
  }
}
