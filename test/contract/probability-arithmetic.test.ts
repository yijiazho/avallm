// test-lane: contract
// Contract tests for the shared probability arithmetic.
//
// The sibling of test/canonical-shape.test.ts, and it exists for the same
// reason one layer down. Those guards were consolidated and ARCH016 keeps them
// consolidated; the numeric helpers beside them were not, because ARCH016 reads
// return types and a helper that returns a number never entered its set. So the
// duplication moved: against one named tolerance constant the tree held 83 raw
// tolerance literals across 14 files, six copies of the unit clamp under two
// names plus five more spelled inline, and four private `close` comparators,
// one of which had lost the constant and written `1e-12` by hand.
//
// The two tolerances below are deliberately different numbers. Unifying them
// would either loosen a strict check or break a passing one, so they carry
// separate names saying what each is for, and the tests pin the gap rather than
// the values alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import {
  addProbability,
  capLogLikelihood,
  clampProbability,
  clampProbabilityOrZero,
  closeProbability,
  COUNT_LATTICE_ULP_MULTIPLIER,
  countLatticeTolerance,
  latticeCount,
  logWeightsToProbabilities,
  PROBABILITY_TOLERANCE,
  SEEDED_SELECTION_MARGIN,
  SELECTION_ADJUSTMENT_REPLAY_TOLERANCE,
  stableProbabilitySum,
} from '../../server/agents/canonical/probability-arithmetic.ts'
import { CANONICAL_ROLE_ORDER } from '../../server/agents/canonical/canonical-shape.ts'
// Architecture fitness is an executable JavaScript tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as architectureModule from '../../tools/architecture-fitness.mjs'
import { repoUrl } from '../support/repo-root.ts'

const { SHARED_ARITHMETIC_HELPER_NAMES, SHARED_ARITHMETIC_HELPER_SYNONYMS } =
  architectureModule as {
    SHARED_ARITHMETIC_HELPER_NAMES: readonly string[]
    SHARED_ARITHMETIC_HELPER_SYNONYMS: readonly {
      readonly name: string
      readonly helpers: readonly string[]
    }[]
  }

const ARITHMETIC_SOURCE =
  'server/agents/canonical/probability-arithmetic.ts'

/** The value exports, pinned by name so a rename is a visible failure. */
const CONSTANT_NAMES = [
  'COUNT_LATTICE_ULP_MULTIPLIER',
  'PROBABILITY_TOLERANCE',
  'SEEDED_SELECTION_MARGIN',
  'SELECTION_ADJUSTMENT_REPLAY_TOLERANCE',
]

test('one probability tolerance, and the two non-probability ones around it', () => {
  // There is exactly one tolerance a probability comparison may spend. Two
  // looser companions have been tried and removed, a flat 1e-9 and a
  // term-scaled accumulatedTolerance, both because the sites reaching for them
  // owned their own summation and could compensate instead. A new constant
  // between PROBABILITY_TOLERANCE and the seeded margin is the regression this
  // pins against: it would be a second budget six call sites inherit silently.
  // The export list itself is pinned by CONSTANT_NAMES below, which is what
  // actually fails if a third probability tolerance reappears.
  // A replayed selection adjustment is recomputed from identical doubles, so it
  // is held tighter than any probability comparison.
  assert.ok(
    SELECTION_ADJUSTMENT_REPLAY_TOLERANCE < PROBABILITY_TOLERANCE,
    'the replay tolerance must be tighter than a probability comparison',
  )
  // Not a tolerance at all. It has to exceed the tolerance the replayer then
  // compares with, or a seeded adjustment would be indistinguishable from zero.
  assert.ok(
    SEEDED_SELECTION_MARGIN > SELECTION_ADJUSTMENT_REPLAY_TOLERANCE,
    'the seeded margin must survive its own replay check',
  )
})

test('the clamps differ only in what they do with a non-finite input', () => {
  for (const value of [0, 0.5, 1, -0.25, 1.25, -0, 1e-30]) {
    assert.equal(
      clampProbability(value),
      clampProbabilityOrZero(value),
      `finite ${value} must clamp the same either way`,
    )
  }
  assert.equal(clampProbability(-0.25), 0)
  assert.equal(clampProbability(1.25), 1)

  // The whole of the difference, and the reason the variant has its own name:
  // policy/plan.ts clamps feature values that arrived through an untrusted
  // trace, where a non-finite value means the producer sent nothing usable.
  // Everywhere else NaN reaching a clamp is a bug that should stay visible.
  assert.ok(Number.isNaN(clampProbability(Number.NaN)))
  assert.equal(clampProbability(Number.POSITIVE_INFINITY), 1)
  assert.equal(clampProbability(Number.NEGATIVE_INFINITY), 0)
  assert.equal(clampProbabilityOrZero(Number.NaN), 0)
  assert.equal(clampProbabilityOrZero(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampProbabilityOrZero(Number.NEGATIVE_INFINITY), 0)
})

test('closeProbability spends exactly the single-value tolerance', () => {
  assert.equal(closeProbability(0.5, 0.5), true)
  assert.equal(closeProbability(0.5, 0.5 + PROBABILITY_TOLERANCE), true)
  assert.equal(closeProbability(0.5, 0.5 + 1e-11), false)
  // Not the accumulated regime. A sum check that reached for this comparator
  // would be three orders of magnitude stricter than the site it replaced.
  assert.equal(
    closeProbability(1, 1 + 1e-9),
    false,
    'the comparator must not quietly grant a looser, accumulated-sized slack',
  )
  // NaN is not close to anything, which is what makes the comparator safe in an
  // AND-chain over untrusted values: an unusable payload fails closed.
  assert.equal(closeProbability(Number.NaN, 0.5), false)
  assert.equal(closeProbability(0.5, Number.NaN), false)
})

test('capLogLikelihood bounds a contribution and says when it bit', () => {
  assert.deepEqual(capLogLikelihood(3, 1.5), { value: 1.5, capped: true })
  assert.deepEqual(capLogLikelihood(-3, 1.5), { value: -1.5, capped: true })
  assert.deepEqual(capLogLikelihood(-1, 1.5), { value: -1, capped: false })
  // Exactly at the bound is not capped: the provenance would otherwise report a
  // clamp on a contribution the model produced unaltered.
  assert.deepEqual(capLogLikelihood(1.5, 1.5), { value: 1.5, capped: false })

  // It rejects where the probability clamps saturate. An infinite log
  // likelihood means a factor priced a world at zero, which is a modelling
  // failure to surface rather than a value to round to the bound.
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => capLogLikelihood(value, 1.5), /must be finite/)
  }
  for (const cap of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => capLogLikelihood(0, cap), /cap must be positive/)
  }
})

test('log-sum-exp normalizes without overflowing and rejects a non-vector', () => {
  // The stability the max-subtraction buys: exp(1000) is Infinity on its own,
  // so a normalizer that did not shift first would return NaN here.
  assert.ok(Number.isFinite(Math.exp(1_000)) === false)
  const large = logWeightsToProbabilities([1_000, 999])
  assert.ok(Math.abs(large[0] + large[1] - 1) < PROBABILITY_TOLERANCE)
  assert.ok(large[0] > large[1])
  // Equal weights are the uniform distribution, exactly.
  assert.deepEqual([...logWeightsToProbabilities([7, 7, 7, 7])], Array(4).fill(0.25))

  // The fold pin. `Math.max(...weights)` throws past roughly 125,000 arguments
  // on this V8, so a length above that is what separates the fold from the
  // spread. Real inputs are far smaller (a ten-player servant view tops out
  // near 60,480 feasible worlds), so this guards the implementation, not a case
  // the belief layer reaches.
  const wide = Array.from({ length: 200_000 }, (_, index) => -index / 10_000)
  assert.throws(() => Math.max(...wide), RangeError)
  const spread = logWeightsToProbabilities(wide)
  assert.equal(spread.length, wide.length)
  assert.ok(spread.every((probability) => probability > 0))
  assert.ok(Math.abs(
    spread.reduce((sum, probability) => sum + probability, 0) - 1,
  ) < 1e-9)

  assert.throws(() => logWeightsToProbabilities([]), /at least one weight/)
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(
      () => logWeightsToProbabilities([0, bad]),
      /finite weights/,
    )
  }
  // A hole is not a weight. Every array method here skips one, so folding the
  // maximum instead of spreading it removed the accident that used to reject a
  // sparse vector, and the guard has to say so on its own.
  const sparse: number[] = [0, 0, -1]
  delete sparse[1]
  assert.throws(() => logWeightsToProbabilities(sparse), /finite weights/)
})

test('latticeCount recovers the integer count or refuses the value', () => {
  // A uniform posterior over N worlds can only produce k/N, so the question is
  // which k. Every exact ratio round trips.
  for (const worldCount of [1, 2, 3, 7, 126, 58_080, 151_200]) {
    for (const k of [0, 1, worldCount - 1, worldCount]) {
      assert.equal(
        latticeCount(k / worldCount, worldCount),
        k,
        `${k}/${worldCount}`,
      )
    }
  }

  // The point of the count-space form over a fixed decimal slack: a one-world
  // snapshot is effectively exact rather than granted 1e-12 of room.
  assert.equal(latticeCount(1 - 1e-13, 1), undefined)
  assert.equal(latticeCount(0.5, 1), undefined)
  // And a value between two lattice points is refused at any size.
  assert.equal(latticeCount(0.5 / 126 + 1 / 126, 126), undefined)

  assert.equal(latticeCount(Number.NaN, 4), undefined)
  assert.equal(latticeCount(1.5, 4), undefined)
  assert.equal(latticeCount(-0.25, 4), undefined)
  assert.equal(latticeCount('0.5', 4), undefined)
})

test('the count-lattice tolerance scales with its denominator', () => {
  assert.equal(countLatticeTolerance(1), COUNT_LATTICE_ULP_MULTIPLIER * Number.EPSILON)
  assert.equal(
    countLatticeTolerance(1024),
    countLatticeTolerance(1) * 1024,
    'the tolerance must track the factor the value was scaled by',
  )
  // Which is what makes it a constant number of machine epsilons back in
  // probability space, and therefore tighter than PROBABILITY_TOLERANCE at
  // every table size rather than looser at the big ones.
  for (const worldCount of [1, 126, 151_200, 3_628_800]) {
    assert.ok(
      countLatticeTolerance(worldCount) / worldCount < PROBABILITY_TOLERANCE,
      `a fixed decimal slack is looser than the lattice check at ${worldCount}`,
    )
  }
})

// The measured case the compensated sum exists for, and the reason it is not a
// matter of taste. A ten-player servant view enumerates up to 60,480 feasible
// worlds; a real one in the bench enumerates 58,080. Adding 1/58,080 of them
// left to right misses 1 by more than PROBABILITY_TOLERANCE, so the strict
// normalization check rejects a belief that is exactly right.
test('naive summation breaks the strict tolerance at real world counts', () => {
  const worldCount = 58_080
  const share = 1 / worldCount
  const worlds = Array<number>(worldCount).fill(share)

  let naive = 0
  for (const value of worlds) naive += value
  assert.ok(
    Math.abs(naive - 1) > PROBABILITY_TOLERANCE,
    `naive summation was within tolerance at ${worldCount} worlds, so this `
    + 'test no longer demonstrates anything',
  )

  const compensated = stableProbabilitySum(worlds, (value) => value)
  assert.ok(
    Math.abs(compensated - 1) <= PROBABILITY_TOLERANCE,
    'compensated summation must satisfy the strict tolerance',
  )
  // And by a wide margin, not by a hair: one machine epsilon rather than the
  // 1e-12 the tolerance grants.
  assert.ok(Math.abs(compensated - 1) <= Number.EPSILON)
})

test('the compensated accumulator is the whole-sequence sum, term by term', () => {
  // The grouped projections in belief/identity.ts stream worlds into one
  // accumulator per hypothesis, so the incremental form has to agree with the
  // batch form exactly or the two halves of a projection would disagree.
  const values = Array.from({ length: 5_000 }, (_, index) => 1 / (index + 1))
  const total = stableProbabilitySum(values, (value) => value)
  const accumulator = { sum: 0, compensation: 0 }
  for (const value of values) addProbability(accumulator, value)
  assert.equal(accumulator.sum + accumulator.compensation, total)

  assert.equal(stableProbabilitySum([], (value: number) => value), 0)
  assert.equal(stableProbabilitySum([0.25], (value) => value), 0.25)
})

// The bound analysis/observer.ts deletes three float comparisons on the
// strength of. Every value it feeds to latticeCount is within
// COUNT_LATTICE_ULP_MULTIPLIER machine epsilons of its k/N, and a seat carries
// at most one marginal per canonical role, so once the integer counts agree the
// float sums cannot disagree by anything the tolerance would notice.
test('lattice-admitted marginals sum to 1 inside the strict tolerance', () => {
  const roleSlots = CANONICAL_ROLE_ORDER.length
  let worst = 0
  for (const worldCount of [126, 420, 15_120, 58_080, 60_480, 3_628_800]) {
    // Push every marginal to the edge of what latticeCount will admit, all in
    // the same direction so nothing cancels. The edge is a fixed 16 machine
    // epsilons in probability space at every world count, which is why the
    // resulting bound does not grow with the table.
    const edge = 0.99 * countLatticeTolerance(worldCount) / worldCount
    const counts = Array<number>(roleSlots).fill(
      Math.floor(worldCount / roleSlots),
    )
    counts[0] += worldCount - counts.reduce((sum, count) => sum + count, 0)
    const marginals = counts.map((count) => count / worldCount + edge)
    for (const [index, marginal] of marginals.entries()) {
      assert.equal(
        latticeCount(marginal, worldCount),
        counts[index],
        `${counts[index]}/${worldCount} at the tolerance edge`,
      )
    }
    let naive = 0
    for (const marginal of marginals) naive += marginal
    worst = Math.max(worst, Math.abs(naive - 1))
    assert.ok(
      Math.abs(naive - 1) <= PROBABILITY_TOLERANCE,
      `worst-case lattice edge at ${worldCount} worlds left ${naive - 1}`,
    )
  }
  // Not a coincidence of the chosen sizes: the slack is orders of magnitude,
  // which is what makes deleting the float comparison safe rather than lucky.
  assert.ok(
    worst * 10 <= PROBABILITY_TOLERANCE,
    `only ${(PROBABILITY_TOLERANCE / worst).toFixed(1)}x of headroom`,
  )
})

function serverSources(directory: string): string[] {
  const entries = readdirSync(repoUrl(`${directory}/`), {
    withFileTypes: true,
  })
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? serverSources(`${directory}/${entry.name}`)
      : entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : [])
}

// The derived half, exactly as canonical-shape.test.ts derives the guard list.
// ARCH017 scans for the names in SHARED_ARITHMETIC_HELPER_NAMES, so a helper
// exported here without being listed there is a helper nobody scans for. The
// rule's own exact-name arm deliberately skips a declaration that spells a
// helper's name exactly, on the argument that it reads as the shared one; that
// argument only holds while something else rejects the exact spelling, and this
// is that something else.
test('no server module keeps a private copy of a shared numeric helper', () => {
  const source = readFileSync(
    repoUrl(ARITHMETIC_SOURCE),
    'utf8',
  )
  // Callable exports only, on the same reasoning canonical-shape.test.ts gives:
  // banning a name across the tree is defensible for a helper, where a second
  // definition means a second contract, and not for a plain value.
  // The generic arm exists for stableProbabilitySum, whose declaration reads
  // `function stableProbabilitySum<T>(`. Without it a generic helper could be
  // exported here and never enter the scanned set, which is the one hole this
  // test is for.
  const exported = [...source.matchAll(
    /^export (?:const (\w+) = \(|function (\w+)(?:<[^>]*>)?\()/gm,
  )].map((match) => match[1] ?? match[2]!).sort()
  assert.deepEqual(exported, [...SHARED_ARITHMETIC_HELPER_NAMES].sort())

  // The constants are pinned separately, because a second `PROBABILITY_TOLERANCE`
  // is exactly what analysis/observer.ts had: its own tolerance constant under
  // an affixed name, holding the same value, beside the better idea.
  const constants = [...source.matchAll(
    /^export const ([A-Z][A-Z0-9_]*) = /gm,
  )].map((match) => match[1]!).sort()
  assert.deepEqual(constants, [...CONSTANT_NAMES].sort())

  const offenders: string[] = []
  for (const file of serverSources('server')) {
    if (file === ARITHMETIC_SOURCE) continue
    const text = readFileSync(repoUrl(file), 'utf8')
    for (const name of [...SHARED_ARITHMETIC_HELPER_NAMES, ...CONSTANT_NAMES]) {
      const declaration = new RegExp(
        `^(?:export )?(?:async )?(?:const|let|var|function) ${name}\\b`,
        'm',
      )
      if (declaration.test(text)) offenders.push(`${file}: ${name}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('every arithmetic synonym points at a helper that still exists', () => {
  assert.ok(SHARED_ARITHMETIC_HELPER_SYNONYMS.length > 0, 'the table is empty')
  const names = SHARED_ARITHMETIC_HELPER_SYNONYMS.map((entry) => entry.name)
  assert.equal(new Set(names).size, names.length, 'a repeated synonym')
  for (const entry of SHARED_ARITHMETIC_HELPER_SYNONYMS) {
    assert.ok(entry.helpers.length > 0, `${entry.name} names no helper`)
    for (const helper of entry.helpers) {
      assert.ok(
        SHARED_ARITHMETIC_HELPER_NAMES.includes(helper),
        `${entry.name} points at ${helper}, which is not a shared helper`,
      )
    }
    assert.equal(
      SHARED_ARITHMETIC_HELPER_NAMES.includes(entry.name),
      false,
      `${entry.name} is a helper name, not a synonym for one`,
    )
  }
})

// The consolidation is a chokepoint only while the consumers keep using it, and
// the count is the cheap proof that the scan is looking at something.
test('the shared arithmetic actually has consumers across the layers', () => {
  const consumers = serverSources('server').filter(
    (file) =>
      file !== ARITHMETIC_SOURCE
      && readFileSync(repoUrl(file), 'utf8')
        .includes('probability-arithmetic.ts'),
  )
  assert.ok(consumers.length >= 15, `only found ${consumers.length} consumers`)
  for (const layer of ['belief', 'analysis', 'policy', 'admission']) {
    assert.ok(
      consumers.some((file) => file.startsWith(`server/agents/${layer}/`)),
      `no consumer in ${layer}, so the module is not layer-wide after all`,
    )
  }
})
