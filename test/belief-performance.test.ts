import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeWarmTimings } from '../server/eval/belief-performance.ts'

test('warm timing summary uses an averaged median and nearest-rank p95', () => {
  const summary = summarizeWarmTimings(
    Array.from({ length: 20 }, (_, index) => index + 1),
  )
  assert.equal(summary.medianMs, 10.5)
  assert.equal(summary.p95Ms, 19)
})

test('warm timing summary rejects an empty sample', () => {
  assert.throws(() => summarizeWarmTimings([]), /must not be empty/)
})
