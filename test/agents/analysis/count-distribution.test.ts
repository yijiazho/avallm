// test-lane: fast

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validCountDistribution,
} from '../../../server/agents/analysis/count-distribution.ts'

test('count distribution validation owns shape, mass, and normalization', () => {
  assert.equal(validCountDistribution([0.25, 0.5, 0.25], 2), true)
  assert.equal(
    validCountDistribution([0.5, 0.5 + Number.EPSILON], 1),
    true,
  )
  assert.equal(validCountDistribution([0.25, 0.75], 2), false)
  assert.equal(validCountDistribution([0.25, 0.5, 0.3], 2), false)
  assert.equal(validCountDistribution([0.25, -0.5, 1.25], 2), false)
  assert.equal(validCountDistribution([0.25, Number.NaN, 0.75], 2), false)

  const sparse = Array<number>(3)
  sparse[0] = 0.5
  sparse[2] = 0.5
  assert.equal(validCountDistribution(sparse, 2), false)
})
