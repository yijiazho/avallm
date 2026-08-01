// test-lane: eval
// Structural guard for the cover-effect diagnostic
// (server/eval/runs/cover-effect.ts). Pins shape and bounds, not the (expected)
// direction of the density-vs-accuracy relationship.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runCoverEffectDiagnostic } from '../../server/eval/runs/cover-effect.ts'

test('cover-effect diagnostic reports bounded hit-rates by decoy density', () => {
  const result = runCoverEffectDiagnostic({ seedsPer: 10 })

  assert.ok(result.shots > 0)
  assert.ok(result.meanDecoyDensity >= 1)
  assert.ok(result.byDecoyDensity.length > 0)
  let totalShots = 0
  for (const slice of result.byDecoyDensity) {
    assert.ok(['1', '2', '3+'].includes(slice.decoyDensity))
    assert.ok(slice.shots > 0)
    assert.ok(slice.assassinHitRate >= 0 && slice.assassinHitRate <= 1)
    assert.ok(
      slice.meanTrueMerlinConfidence >= 0
      && slice.meanTrueMerlinConfidence <= 1,
    )
    totalShots += slice.shots
  }
  assert.equal(totalShots, result.shots)
})
