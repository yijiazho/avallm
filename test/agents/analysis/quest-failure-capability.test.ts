// test-lane: fast

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  questFailureCapabilityProbability,
} from '../../../server/agents/analysis/quest-failure-capability.ts'

test('quest failure capability is the evil-count tail at the threshold', () => {
  const distribution = [0.25, 0.5, 0.25]

  assert.equal(questFailureCapabilityProbability(distribution, 1), 0.75)
  assert.equal(questFailureCapabilityProbability(distribution, 2), 0.25)
  assert.equal(questFailureCapabilityProbability(distribution, 3), 0)
  assert.deepEqual(distribution, [0.25, 0.5, 0.25])
})
