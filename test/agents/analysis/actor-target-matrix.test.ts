// test-lane: fast

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  actorTargetMatrixIndex,
} from '../../../server/agents/analysis/actor-target-matrix.ts'

test('actor-target matrix indexing is actor-major and dense', () => {
  assert.equal(actorTargetMatrixIndex(5, 0, 4), 4)
  assert.equal(actorTargetMatrixIndex(5, 1, 0), 5)
  assert.equal(actorTargetMatrixIndex(5, 4, 4), 24)
})
