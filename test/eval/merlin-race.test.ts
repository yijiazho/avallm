// test-lane: eval
// Structural guard for the Merlin-identification race diagnostic
// (server/eval/runs/merlin-race.ts). Pins shape and bounds, not the (expected
// but sample-dependent) direction of the assassin's lead.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runMerlinRaceDiagnostic } from '../../server/eval/runs/merlin-race.ts'

test('merlin race diagnostic reports bounded per-round confidences', async () => {
  const result = await runMerlinRaceDiagnostic({ games: 6, playerCount: 5 })

  assert.ok(result.byRound.length > 0)
  assert.ok(result.assassinAheadRate >= 0 && result.assassinAheadRate <= 1)
  let previousRound = 0
  for (const round of result.byRound) {
    assert.ok(round.round > previousRound) // ascending, resolved-quest order
    previousRound = round.round
    assert.ok(round.samples > 0)
    for (const confidence of [
      round.servantBeliefConfidence,
      round.assassinBeliefConfidence,
      round.assassinPosteriorConfidence,
    ]) {
      assert.ok(confidence >= 0 && confidence <= 1)
    }
    assert.ok(round.assassinAheadRate >= 0 && round.assassinAheadRate <= 1)
  }
})
