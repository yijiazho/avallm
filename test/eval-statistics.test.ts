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
  meanOf,
  median,
  nearestRank,
  pairedBootstrapRateDelta,
  rate,
  seededRandom,
  sumOf,
} from '../server/eval/statistics.ts'
import {
  diagnosisPer,
  diagnosisPercent,
  overviewPercent,
  renderDelta,
  renderRate,
} from '../server/eval/report-format.ts'

/**
 * Every TypeScript source under server/eval, recursively, minus the module that
 * legitimately owns the thing being guarded. Recursive because a fork dropped in
 * a subdirectory is exactly the fork a top-level-only scan would miss.
 */
const evalSources = (
  ...owners: string[]
): { label: string; source: string }[] => {
  const root = path.join(import.meta.dirname, '..', 'server', 'eval')
  const walk = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) return walk(absolute)
      return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : []
    })
  return walk(root)
    .map((absolute) => ({
      label: path.relative(root, absolute).replaceAll('\\', '/'),
      source: fs.readFileSync(absolute, 'latin1'),
    }))
    .filter(({ label }) => !owners.includes(label))
}

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

test('meanOf folds a projection in the same order as mean', () => {
  assert.equal(meanOf([], (value: number) => value), null)
  assert.equal(meanOf([{ n: 1 }, { n: 2 }, { n: 4 }], (item) => item.n), 7 / 3)
  // Same fold order as mean, so a caller switching between them keeps its
  // published figures down to the last bit.
  const awkward = [0.1, 0.2, 0.3, 1e-17]
  assert.equal(meanOf(awkward, (value) => value), mean(awkward))
})

test('median averages the middle pair on an even sample', () => {
  assert.equal(median([]), null)
  assert.equal(median([7]), 7)
  // The averaged middle is what separates median from nearestRank(values, 0.5):
  // 1.5 is not in the sample, and 2 (the nearest rank) is.
  assert.equal(median([1, 2]), 1.5)
  assert.equal(nearestRank([1, 2], 0.5), 1)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  // Input order must not matter, and the input must not be mutated.
  const values = [5, 1, 4, 2, 3]
  assert.equal(median(values), 3)
  assert.deepEqual(values, [5, 1, 4, 2, 3])
  assert.equal(
    median(Array.from({ length: 20 }, (_, index) => index + 1)),
    10.5,
  )
})

test('sumOf totals a projection and returns zero over nothing', () => {
  assert.equal(sumOf([], (value: number) => value), 0)
  assert.equal(sumOf([{ n: 1 }, { n: 2 }, { n: 4 }], (item) => item.n), 7)
  // Left fold, so the floating-point order is the one the reports published.
  assert.equal(
    sumOf([0.1, 0.2, 0.3], (value) => value),
    0.1 + 0.2 + 0.3,
  )
})

test('both paired reports spell a rate the same way', () => {
  // The fork this replaced rendered the same RateEstimate two ways: the
  // architecture report showed the Wilson interval and the vote-conversion
  // report dropped it. One renderer means one spelling.
  assert.equal(
    renderRate(rate(42, 180)),
    '23.3% (42/180, 95% 17.8%-30.0%)',
  )
  assert.equal(renderRate(rate(7, 30)), '23.3% (7/30, 95% 11.8%-40.9%)')
  // A rate over no trials has no interval to show and says so.
  assert.equal(renderRate(rate(0, 0)), 'n/a (0/0)')
  assert.equal(
    renderDelta({ delta: 0.177, interval95: { low: 0.139, high: 0.213 } }),
    '+17.7% (95% 13.9% to 21.3%)',
  )
  assert.equal(
    renderDelta({ delta: -0.05, interval95: { low: -0.106, high: 0.006 } }),
    '-5.0% (95% -10.6% to 0.6%)',
  )
  assert.equal(renderDelta({ delta: null, interval95: null }), 'n/a')
})

test('the two percentage conventions stay distinct and column-stable', () => {
  // Diagnosis tables: one decimal, right-aligned, 'n/a' for an empty
  // denominator so a column of rates stays a column.
  assert.equal(diagnosisPercent(1, 4), '  25.0%')
  assert.equal(diagnosisPercent(1, 0), '    n/a')
  assert.equal(diagnosisPercent(1, 4).length, diagnosisPercent(1, 0).length)
  assert.equal(diagnosisPer(7, 2), ' 3.50')
  assert.equal(diagnosisPer(7, 0), '  n/a')
  assert.equal(diagnosisPer(7, 2).length, diagnosisPer(7, 0).length)
  // Report CLI overview: whole numbers and an em dash, deliberately different.
  assert.equal(overviewPercent(1, 4), '25%')
  assert.equal(overviewPercent(1, 0), '—')
})

test('no eval module hand-rolls a published formatter', () => {
  // Same reasoning as the estimator guard below: renderRate was forked for long
  // enough to diverge, and the only reason nothing failed is that no test owned
  // the spelling. A fresh local copy of any of these is that fork returning.
  //
  // Declarations only, anchored to the start of a line, so a comment that
  // mentions a retired spelling while explaining this consolidation does not
  // redden the suite. Matching is by name, so a fork that renames its helper
  // still slips through; this is a backstop, not the contract. The contract is
  // that both reports import one renderer and the tests above pin its output.
  const names = [
    'percent',
    'pct',
    'per',
    'renderRate',
    'renderDelta',
    'renderMilliseconds',
  ]
  const declares = (source: string, name: string): boolean =>
    new RegExp(
      String.raw`^\s*(?:export\s+)?(?:const|let|function)\s+${name}\b`,
      'm',
    ).test(source)
  const offenders = evalSources('report-format.ts')
    .flatMap(({ label, source }) =>
      names
        .filter((name) => declares(source, name))
        .map((name) => `${label}: ${name}`))
  assert.deepEqual(offenders, [])
})

test('the seeded stream is pinned to the values that produced the figures', () => {
  // Every published interval came out of this exact stream: the engine's FNV-1a
  // over the seed, then xorshift32. Deliberately NOT the engine's makeRng, which
  // is mulberry32 and would move every one of them. These literals make either
  // half impossible to change by accident.
  const random = seededRandom('phase4-good-v1:compatibility:candidate:wins')
  assert.deepEqual(
    Array.from({ length: 4 }, () => random()),
    [
      0.7616844002623111,
      0.829826544970274,
      0.6454424681141973,
      0.6656277221627533,
    ],
  )
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
  // with no test that could tell them apart, so a copy-paste is what this
  // catches. It matches the z literal and the xorshift shift sequence verbatim,
  // which is precisely a copy-paste and nothing cleverer: a reimplementation
  // that renames the variable or writes 1.96 walks straight past. Treat it as a
  // backstop for the cheapest way to reintroduce the fork, not as a contract.
  //
  // The FNV constants are deliberately not markers. mechanical-data.ts folds
  // them to hash seeds into dataset splits, which is a string hash rather than
  // this estimator, and statistics.ts no longer spells them at all now that it
  // shares the engine's fnv1a.
  const marks = ['1.959963984540054', 'state << 13', 'state >>> 17']
  const offenders = evalSources('statistics.ts')
    .filter(({ source }) => marks.some((mark) => source.includes(mark)))
    .map(({ label }) => label)
  assert.deepEqual(offenders, [])
})

test('no eval module re-declares the estimator input shape', () => {
  // vote-direction.ts used to declare VoteRateCount, a field-for-field twin of
  // RateCount, as the return type of voteRateCount. Every value it produced was
  // already being handed to rate() or used as a paired-bootstrap selector, so
  // the two names described one concept and structural typing hid the coupling
  // completely: nothing failed, and nothing would have failed if one of them had
  // later grown a field or renamed a denominator.
  //
  // The estimator's input shape therefore has exactly one declaration. A module
  // that needs it imports RateCount rather than spelling it again.
  const offenders = evalSources('statistics.ts')
    .filter(({ source }) => /^\s*successes\s*:\s*number\b/m.test(source))
    .map(({ label }) => label)
  assert.deepEqual(offenders, [])
})
