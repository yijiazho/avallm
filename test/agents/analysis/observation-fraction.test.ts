// test-lane: fast

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  observationFraction,
  validObservationFraction,
} from '../../../server/agents/analysis/observation-fraction.ts'

test('observation fractions preserve counts and represent no data as null', () => {
  assert.deepEqual(observationFraction(0, 0), {
    numerator: 0,
    denominator: 0,
    index: null,
  })
  assert.deepEqual(observationFraction(2, 5), {
    numerator: 2,
    denominator: 5,
    index: 0.4,
  })
})

test('observation fraction validation owns the shared count and ratio laws', () => {
  assert.equal(validObservationFraction(observationFraction(2, 5)), true)
  assert.equal(validObservationFraction({
    numerator: 1,
    denominator: 3,
    index: 1 / 3 + Number.EPSILON,
  }), true)
  assert.equal(validObservationFraction({
    numerator: 0,
    denominator: 0,
    index: 0,
  }), false)
  assert.equal(validObservationFraction({
    numerator: 1,
    denominator: 0,
    index: null,
  }), false)
  assert.equal(validObservationFraction({
    numerator: 1,
    denominator: 2,
    index: 0.6,
  }), false)
  assert.equal(validObservationFraction({
    numerator: 1,
    denominator: 2,
    index: 0.5,
    extra: true,
  }), false)
  for (const value of [
    { numerator: -1, denominator: 2, index: 0 },
    { numerator: 3, denominator: 2, index: 1 },
    { numerator: 1.5, denominator: 2, index: 0.75 },
    { numerator: 1, denominator: Number.MAX_SAFE_INTEGER + 1, index: 0 },
  ]) {
    assert.equal(validObservationFraction(value), false)
  }
})

test('observation fraction validation applies caller-owned denominator bounds', () => {
  const value = observationFraction(1, 6)
  assert.equal(validObservationFraction(value), true)
  assert.equal(validObservationFraction(value, { maxDenominator: 5 }), false)
})
