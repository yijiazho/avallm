// test-lane: eval
// Structural guard for the per-role leading-indicator scorecard
// (server/eval/runs/role-scorecard.ts). Pins the shape and bounds of the
// assembled signals, not exact values (which vary with engine/heuristic
// changes), over a small composed self-play run.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runRoleScorecard } from '../../server/eval/runs/role-scorecard.ts'

test('role scorecard assembles valid per-role indicators over composed self-play', async () => {
  const scorecard = await runRoleScorecard({
    games: 6,
    playerCount: 5,
    assassinSeedsPer: 10,
  })

  assert.equal(scorecard.games, 6)
  assert.equal(scorecard.playerCount, 5)
  // The 5-player cast is a fixed five roles, each seated every game.
  assert.equal(scorecard.perRole.length, 5)
  for (const role of scorecard.perRole) {
    assert.ok(role.instances > 0)
    assert.ok(
      role.voteAccuracy === null
      || (role.voteAccuracy >= 0 && role.voteAccuracy <= 1),
    )
    assert.ok(
      Number.isSafeInteger(role.forcedPlayViolations)
      && role.forcedPlayViolations >= 0,
    )
  }
  assert.ok(scorecard.perRole.some((role) => role.role === 'merlin'))

  assert.ok(
    scorecard.merlin.assassinatedRate >= 0
    && scorecard.merlin.assassinatedRate <= 1,
  )

  assert.ok(scorecard.assassin.predictions > 0)
  assert.ok(scorecard.assassin.hitRate >= 0 && scorecard.assassin.hitRate <= 1)
  assert.ok(scorecard.assassin.meanBrier >= 0)
  assert.ok(Number.isFinite(scorecard.assassin.meanLogLoss))
})
