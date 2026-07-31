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
  conditionalOverlayIndex,
  EMPTY_SUBJECT_MASS,
  type PerceptionOverlaySample,
} from '../server/agents/analysis/perception-asymmetry.ts'

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

test('EMPTY_SUBJECT_MASS reads as an all-zero accumulation', () => {
  assert.deepEqual({ ...EMPTY_SUBJECT_MASS }, {
    mass: 0,
    overlayAvailableMass: 0,
    overlayWeightedMass: 0,
  })
})
