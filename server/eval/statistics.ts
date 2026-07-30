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

/** Two-sided 95 percent standard normal quantile, z(0.975). */
export const NORMAL_QUANTILE_95 = 1.959963984540054

/** Resamples drawn per paired bootstrap. */
export const BOOTSTRAP_RESAMPLES = 5_000

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
 * FNV-1a over the seed string into an xorshift32 stream. Named so both reports
 * derive the same uniforms from the same seed; the bootstrap itself only ever
 * sees the resulting function.
 */
export function seededRandom(seed: string): () => number {
  let state = 2166136261
  for (const character of seed) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  state = state >>> 0 || 1
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
