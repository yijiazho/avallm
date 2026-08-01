// test-lane: eval
// Structural guard for the servant Merlin-confidence vote diagnostic
// (server/eval/runs/servant-merlin-vote.ts). Pins the shape and bounds, not the
// (small, noisy) accuracy relationship itself.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runServantMerlinVoteDiagnostic } from '../../server/eval/runs/servant-merlin-vote.ts'

test('servant merlin-confidence diagnostic reports bounded confidence terciles', async () => {
  const result = await runServantMerlinVoteDiagnostic({ games: 6, playerCount: 5 })

  assert.ok(result.servantVotes > 0)
  assert.ok(
    result.meanMerlinConfidence >= 0 && result.meanMerlinConfidence <= 1,
  )
  for (const slice of [
    result.byMerlinConfidence.low,
    result.byMerlinConfidence.mid,
    result.byMerlinConfidence.high,
  ]) {
    assert.ok(slice.votes >= 0)
    assert.ok(slice.voteAccuracy >= 0 && slice.voteAccuracy <= 1)
    assert.ok(
      slice.meanMerlinConfidence >= 0 && slice.meanMerlinConfidence <= 1,
    )
  }
  // Terciles are sorted by confidence, so this ordering holds by construction.
  assert.ok(
    result.byMerlinConfidence.high.meanMerlinConfidence
    >= result.byMerlinConfidence.low.meanMerlinConfidence,
  )
})
