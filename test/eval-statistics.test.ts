// Contract for the one statistics core behind every published evaluation
// number (server/eval/statistics.ts).
//
// architecture-report.ts and vote-conversion-report.ts used to carry
// byte-identical copies of the Wilson interval, the nearest-rank percentile and
// the paired bootstrap, so a correction to one silently left the other
// publishing the old figure. The estimator now lives in one module, and this
// file gives it a contract of its own: the interval is pinned against
// hand-computed values so a change to z, a continuity correction, or a
// different resampling scheme has to be deliberate.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  BOOTSTRAP_RESAMPLES,
  NORMAL_QUANTILE_95,
  mean,
  nearestRank,
  pairedBootstrapRateDelta,
  rate,
  seededRandom,
} from '../server/eval/statistics.ts'

const interval = (successes: number, trials: number) => {
  const estimate = rate(successes, trials)
  assert.ok(estimate.interval95, `${successes}/${trials} has no interval`)
  return estimate.interval95
}

test('the Wilson interval matches hand-computed textbook values', () => {
  // Standard published two-sided 95 percent Wilson score intervals, no
  // continuity correction, rounded to four decimals. These are the numbers to
  // check by hand against a table or a stats package.
  const rounded = (value: number): number =>
    Number(value.toFixed(4))

  const half = interval(1, 2)
  assert.equal(rounded(half.low), 0.0945)
  assert.equal(rounded(half.high), 0.9055)

  const none = interval(0, 10)
  assert.equal(rounded(none.low), 0)
  assert.equal(rounded(none.high), 0.2775)

  const even = interval(5, 10)
  assert.equal(rounded(even.low), 0.2366)
  assert.equal(rounded(even.high), 0.7634)

  const all = interval(10, 10)
  assert.equal(rounded(all.low), 0.7225)
  assert.equal(rounded(all.high), 1)

  // Full precision, so a change that survives rounding to four decimals still
  // reddens this file rather than moving a published figure quietly.
  assert.deepEqual(half, {
    low: 0.09453120573423074,
    high: 0.9054687942657693,
  })
  assert.deepEqual(none, { low: 0, high: 0.2775327998628892 })
  assert.deepEqual(even, {
    low: 0.236593090512564,
    high: 0.7634069094874361,
  })
})

test('the Wilson interval agrees with an independent closed form', () => {
  // Algebraically the same interval, arranged so no subexpression is shared
  // with the implementation:
  //   (2np + z^2 +- z*sqrt(z^2 + 4np(1-p))) / (2(n + z^2))
  const z = NORMAL_QUANTILE_95
  const z2 = z * z
  const independent = (successes: number, trials: number) => {
    const proportion = successes / trials
    const root = z * Math.sqrt(z2 + 4 * trials * proportion * (1 - proportion))
    const denominator = 2 * (trials + z2)
    return {
      low: (2 * trials * proportion + z2 - root) / denominator,
      high: (2 * trials * proportion + z2 + root) / denominator,
    }
  }
  for (let trials = 1; trials <= 40; trials++) {
    for (let successes = 0; successes <= trials; successes++) {
      const actual = interval(successes, trials)
      const expected = independent(successes, trials)
      assert.ok(
        Math.abs(actual.low - Math.max(0, expected.low)) < 1e-15
        && Math.abs(actual.high - Math.min(1, expected.high)) < 1e-15,
        `${successes}/${trials}: ${JSON.stringify(actual)} vs `
        + JSON.stringify(expected),
      )
      assert.ok(actual.low >= 0 && actual.high <= 1)
      assert.ok(actual.low <= actual.high)
    }
  }
})

test('the Wilson interval brackets the point estimate', () => {
  // The endpoints are the roots of (p - phat)^2 = z^2 p(1-p)/n, so phat lies
  // strictly between them for every real input. At phat exactly 0 or 1 the
  // rounded endpoint can land an epsilon the wrong side of the estimate, hence
  // the tolerance rather than a bare comparison.
  for (let trials = 1; trials <= 40; trials++) {
    for (let successes = 0; successes <= trials; successes++) {
      const estimate = rate(successes, trials)
      assert.equal(estimate.rate, successes / trials)
      assert.ok(
        estimate.interval95!.low - estimate.rate! < 1e-15
        && estimate.rate! - estimate.interval95!.high < 1e-15,
        `${successes}/${trials}: ${JSON.stringify(estimate)}`,
      )
    }
  }
})

test('a rate over no trials reports no estimate rather than NaN', () => {
  assert.deepEqual(rate(0, 0), {
    successes: 0,
    trials: 0,
    rate: null,
    interval95: null,
  })
})

test('the nearest-rank percentile reports an observed value', () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1)
  assert.equal(nearestRank(values, 0.95), 19)
  assert.equal(nearestRank(values, 0.5), 10)
  assert.equal(nearestRank(values, 0.025), 1)
  assert.equal(nearestRank(values, 0.975), 20)
  // Order of the input must not matter, and the smallest rank is reachable.
  assert.equal(nearestRank([5, 1, 4, 2, 3], 0.01), 1)
  assert.equal(nearestRank([5, 1, 4, 2, 3], 1), 5)
  assert.equal(nearestRank([], 0.5), null)
  // It never interpolates: every answer is a member of the sample.
  for (const probability of [0.025, 0.1, 0.33, 0.5, 0.9, 0.975]) {
    assert.ok(values.includes(nearestRank(values, probability)!))
  }
})

test('mean is null over an empty sample', () => {
  assert.equal(mean([]), null)
  assert.equal(mean([1, 2, 4]), 7 / 3)
  assert.equal(mean([2]), 2)
})

test('the seeded stream is a pure function of its seed', () => {
  const draw = (seed: string): number[] => {
    const random = seededRandom(seed)
    return Array.from({ length: 8 }, () => random())
  }
  assert.deepEqual(draw('bank:a:b:wins'), draw('bank:a:b:wins'))
  assert.notDeepEqual(draw('bank:a:b:wins'), draw('bank:a:b:votes'))
  for (const value of draw('bank:a:b:wins')) {
    assert.ok(value >= 0 && value < 1)
  }
  // The empty seed must still produce a usable stream: the FNV hash can land on
  // zero, and xorshift is stuck there forever.
  assert.ok(new Set(draw('')).size > 1)
})

test('the paired bootstrap draws only from the injected stream', () => {
  // Deliberately heterogeneous per-pair deltas (+1, -1, 0, +1, -0.5), so which
  // pairs a resample happens to draw genuinely moves the quantiles.
  const count = (successes: number, trials: number) => ({ successes, trials })
  const pairs = [
    { baseline: count(0, 2), candidate: count(2, 2) },
    { baseline: count(2, 2), candidate: count(0, 2) },
    { baseline: count(1, 2), candidate: count(1, 2) },
    { baseline: count(0, 4), candidate: count(4, 4) },
    { baseline: count(3, 4), candidate: count(1, 4) },
  ]
  const select = (value: { successes: number; trials: number }) => value
  const run = (random: () => number) =>
    pairedBootstrapRateDelta(pairs, select, random)

  // Pooled 6/14 baseline against 8/14 candidate.
  const seeded = run(seededRandom('pair-seed'))
  assert.equal(seeded.delta, 1 / 7)
  assert.deepEqual(seeded, run(seededRandom('pair-seed')))
  assert.notDeepEqual(seeded, run(seededRandom('other-seed')))

  // A stream that always names the first pair collapses every resample onto it,
  // so the interval has zero width at that pair's own delta. This is the whole
  // point of injecting the stream: nothing else can move the answer.
  let calls = 0
  const first = run(() => {
    calls++
    return 0
  })
  assert.equal(calls, BOOTSTRAP_RESAMPLES * pairs.length)
  assert.deepEqual(first.interval95, { low: 1, high: 1 })
})

test('the paired bootstrap declines input it cannot resample', () => {
  const select = (value: { successes: number; trials: number }) => value
  const empty = pairedBootstrapRateDelta([], select, seededRandom('x'))
  assert.deepEqual(empty, { delta: null, interval95: null })

  const noTrials = pairedBootstrapRateDelta(
    [{
      baseline: { successes: 0, trials: 0 },
      candidate: { successes: 1, trials: 2 },
    }],
    select,
    seededRandom('x'),
  )
  assert.deepEqual(noTrials, { delta: null, interval95: null })
})

test('no eval module carries a second copy of the estimator', () => {
  // The fork this module replaced was invisible: two byte-identical estimators
  // with no test that could tell them apart. Any reappearance of the z literal
  // or the xorshift stream outside statistics.ts is that fork coming back. The
  // FNV constants are not markers: mechanical-data.ts hashes seeds into dataset
  // splits with them, which is a string hash and not this estimator.
  const marks = ['1.959963984540054', 'state << 13', 'state >>> 17']
  const root = path.join(import.meta.dirname, '..', 'server', 'eval')
  const offenders = fs.readdirSync(root)
    .filter((file) => file.endsWith('.ts') && file !== 'statistics.ts')
    .filter((file) => {
      const source = fs.readFileSync(path.join(root, file), 'latin1')
      return marks.some((mark) => source.includes(mark))
    })
  assert.deepEqual(offenders, [])
})
