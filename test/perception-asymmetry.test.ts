// Contract tests for the shared perception-asymmetry reducer, the first
// extracted piece of the one-layer opponent-model consolidation
// (docs/design-perception-primitive.md). The reducer's job is narrow: fold a
// stream of items into per-subject probability mass, optionally split by a
// bounded behavioral overlay, in input order. These pin that behaviour and, in
// particular, that the accumulation order matches a hand-rolled reduction, which
// is what lets the role modules keep byte-identical payloads while sharing it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accumulateSubjectMass,
  certaintyDifferential,
  conditionalOverlayIndex,
  EMPTY_SUBJECT_MASS,
  partitionBySubject,
  teamEvilCountDistribution,
  type PerceptionOverlaySample,
} from '../server/agents/analysis/perception-asymmetry.ts'
import { stableProbabilitySum } from '../server/agents/components/probability-arithmetic.ts'

test('accumulates probability mass per subject key in input order', () => {
  const items = [
    { subject: 1, p: 0.1 },
    { subject: 2, p: 0.2 },
    { subject: 1, p: 0.3 },
    { subject: 2, p: 0.4 },
  ]
  const totals = accumulateSubjectMass(
    items,
    (item) => item.subject,
    (item) => item.p,
  )
  assert.equal(totals.size, 2)
  assert.equal(totals.get(1)?.mass, 0.1 + 0.3)
  assert.equal(totals.get(2)?.mass, 0.2 + 0.4)
  // No overlay function supplied: overlay masses stay zero.
  assert.equal(totals.get(1)?.overlayAvailableMass, 0)
  assert.equal(totals.get(1)?.overlayWeightedMass, 0)
})

test('folds in the same order and to the same bits as a manual reduction', () => {
  // Values chosen so the running sum is order-sensitive at the last ULP.
  const items = Array.from({ length: 64 }, (_, index) => ({
    subject: 0,
    p: (index % 7) * 1e-3 + 1e-16,
  }))
  const totals = accumulateSubjectMass(
    items,
    (item) => item.subject,
    (item) => item.p,
  )
  let manual = 0
  for (const item of items) manual += item.p
  // Strict equality, not tolerance: identical operands in identical order.
  assert.equal(totals.get(0)?.mass, manual)
})

test('splits mass by overlay availability and weights only available items', () => {
  const overlay = new Map<string, PerceptionOverlaySample>([
    ['a', { available: true, index: 0.5 }],
    ['b', { available: false, index: 0.9 }],
    ['c', { available: true, index: 0.25 }],
  ])
  const items = [
    { subject: 7, id: 'a', p: 0.2 },
    { subject: 7, id: 'b', p: 0.3 },
    { subject: 7, id: 'c', p: 0.4 },
  ]
  const totals = accumulateSubjectMass(
    items,
    (item) => item.subject,
    (item) => item.p,
    (item) => overlay.get(item.id)!,
  )
  const aggregate = totals.get(7)!
  assert.equal(aggregate.mass, 0.2 + 0.3 + 0.4)
  // 'b' is unavailable, so it contributes to neither overlay mass.
  assert.equal(aggregate.overlayAvailableMass, 0.2 + 0.4)
  assert.equal(aggregate.overlayWeightedMass, 0.2 * 0.5 + 0.4 * 0.25)
})

test('skips items whose subject key is undefined', () => {
  const items = [
    { subject: 1 as number | undefined, p: 0.5 },
    { subject: undefined, p: 0.25 },
    { subject: 1 as number | undefined, p: 0.25 },
  ]
  const totals = accumulateSubjectMass(
    items,
    (item) => item.subject,
    (item) => item.p,
  )
  assert.equal(totals.size, 1)
  assert.equal(totals.get(1)?.mass, 0.75)
})

test('conditionalOverlayIndex is the guarded ratio, null without coverage', () => {
  assert.equal(conditionalOverlayIndex(EMPTY_SUBJECT_MASS), null)
  assert.equal(
    conditionalOverlayIndex({
      mass: 1,
      overlayAvailableMass: 0,
      overlayWeightedMass: 0,
    }),
    null,
  )
  assert.equal(
    conditionalOverlayIndex({
      mass: 1,
      overlayAvailableMass: 0.6,
      overlayWeightedMass: 0.3,
    }),
    0.5,
  )
})

test('partitionBySubject groups items in input order per bucket', () => {
  const items = [
    { m: 2, p: 0.1 },
    { m: 5, p: 0.2 },
    { m: 2, p: 0.3 },
    { m: 5, p: 0.4 },
  ]
  const { buckets } = partitionBySubject(items, (i) => i.m, (i) => i.p)
  assert.deepEqual(buckets.get(2), [{ m: 2, p: 0.1 }, { m: 2, p: 0.3 }])
  assert.deepEqual(buckets.get(5), [{ m: 5, p: 0.2 }, { m: 5, p: 0.4 }])
  assert.equal(buckets.has(0), false)
})

test('partitionBySubject mass uses compensated summation, not a naive fold', () => {
  // A large base plus many sub-ULP terms: naive += drops the small terms, while
  // the compensated sum keeps them, so the two diverge. The sawDivergence check
  // asserts the inputs actually distinguish the two summations, which is what
  // makes the mass === compensated assertion able to fail if the primitive ever
  // switched to a naive fold (it would then return the naive value instead).
  const items = Array.from({ length: 1000 }, (_, index) => ({
    m: index % 2,
    p: index === 0 ? 1 : 1e-17,
  }))
  const { buckets, mass } = partitionBySubject(items, (i) => i.m, (i) => i.p)
  let sawDivergence = false
  for (const [key, bucket] of buckets) {
    const naive = bucket.reduce((sum, i) => sum + i.p, 0)
    const compensated = stableProbabilitySum(bucket, (i) => i.p)
    if (naive !== compensated) sawDivergence = true
    assert.equal(mass.get(key), compensated)
  }
  assert.ok(sawDivergence, 'test inputs must distinguish naive from compensated')
})

test('partitionBySubject lets keyOf reject an illegal item by throwing', () => {
  const items = [{ m: 1, p: 0.5 }, { m: -1, p: 0.5 }]
  assert.throws(
    () => partitionBySubject(items, (i) => {
      if (i.m < 0) throw new Error('illegal')
      return i.m
    }, (i) => i.p),
    /illegal/,
  )
})

test('teamEvilCountDistribution buckets team evil counts by mass, index 0..len', () => {
  const worlds = [
    { evil: new Set([1]), p: 0.5 },
    { evil: new Set([1, 2]), p: 0.3 },
    { evil: new Set<number>(), p: 0.2 },
  ]
  const dist = teamEvilCountDistribution(
    worlds,
    [1, 2],
    (w, seat) => w.evil.has(seat),
    (w) => w.p,
  )
  // Zero evil on team -> 0.2; one -> 0.5; both -> 0.3.
  assert.equal(dist.length, 3)
  assert.deepEqual(dist, [0.2, 0.5, 0.3])
})

test('teamEvilCountDistribution counts only team seats and preserves raw mass', () => {
  // An evil seat off-team must not raise the count; the fold stays unnormalized.
  const worlds = [{ evil: new Set([9]), p: 0.4 }, { evil: new Set([0]), p: 0.1 }]
  const dist = teamEvilCountDistribution(worlds, [0, 1], (w, s) => w.evil.has(s), (w) => w.p)
  assert.deepEqual(dist, [0.4, 0.1, 0])
})

test('certaintyDifferential pins alignments the private belief knows and the table does not', () => {
  // seat0: privately certain-evil, publicly open -> evil pin (the servant-pins-
  // minion case). seat1: privately certain-good, publicly open -> good pin.
  // seat2: privately uncertain -> no pin. seat3: publicly certain already -> no
  // private advantage even though private agrees.
  const rows = certaintyDifferential(
    [1, 0, 0.5, 1],
    [0.4, 0.4, 0.4, 1],
  )
  assert.deepEqual(rows.map((row) => row.privatePin), ['evil', 'good', null, null])
})

test('certaintyDifferential gives no pin when the public read is already certain', () => {
  // Public 0 and public 1 are both certainty boundaries: nothing to add.
  const rows = certaintyDifferential([1, 0], [0, 1])
  assert.deepEqual(rows.map((row) => row.privatePin), [null, null])
})

test('certaintyDifferential rejects misaligned marginals', () => {
  assert.throws(() => certaintyDifferential([1, 0], [0.5]), /aligned marginals/)
})

test('EMPTY_SUBJECT_MASS reads as an all-zero accumulation', () => {
  assert.deepEqual({ ...EMPTY_SUBJECT_MASS }, {
    mass: 0,
    overlayAvailableMass: 0,
    overlayWeightedMass: 0,
  })
})
