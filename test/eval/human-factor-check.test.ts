// test-lane: eval
//
// The frozen record of what human play says about our two behavioural factors.
//
// These assertions are not checking arithmetic. They are pinning the findings
// that BELIEF-003 and BELIEF-004 rest on, so that if the fixture is
// regenerated, re-distilled, or replaced with a larger corpus, the claims those
// register entries make either survive or fail loudly. A factor decision
// justified by a number nobody re-derives is a decision that quietly rots.
//
// The seating decisions themselves live in
// `server/agents/belief/factor-manifest.ts`, whose own suite pins that every
// factor states its evidence and its revisit condition. This file is where the
// evidence half is actually recomputed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadHumanGames,
  proposalDiagnostic,
  voteDiagnostic,
} from '../../server/eval/runs/human-factor-check.ts'

const games = loadHumanGames()

test('the human corpus is the shape its provenance claims', () => {
  assert.equal(games.length, 20)
  const proposals = games.reduce((n, game) => n + game.proposals.length, 0)
  const ballots = games.reduce(
    (n, game) => n + game.proposals.reduce(
      (m, proposal) => m + (proposal.votes?.length ?? 0), 0), 0)
  assert.equal(proposals, 148)
  assert.equal(ballots, 696)
  for (const game of games) {
    assert.equal(game.playerCount, 6)
    // Six players is two evil, and it is why no result here can speak to
    // Oberon, Mordred, or a two-Fail quest.
    assert.equal(game.evilSeats.length, 2)
    assert.equal(game.roleBySeat.length, 6)
    for (const proposal of game.proposals) {
      assert.ok(proposal.team.length > 0)
      assert.ok(proposal.leader >= 0 && proposal.leader < 6)
    }
  }
})

test('BELIEF-004: the proposal signal is real and non-diagnostic', () => {
  const result = proposalDiagnostic(games)

  // Evil leaders do camouflage. The sign this factor took from the strategy
  // brief is the sign humans play, and the authored 0.5/0.6 is close.
  assert.ok(
    result.evilLed.oddsLift > 0.4 && result.evilLed.oddsLift < 0.7,
    `evil-led odds lift ${result.evilLed.oddsLift}`,
  )

  // And so do good leaders, by deduction rather than cover, at the same rate.
  assert.ok(
    result.goodLed.oddsLift > 0.4 && result.goodLed.oddsLift < 0.7,
    `good-led odds lift ${result.goodLed.oddsLift}`,
  )

  // Which is the whole finding: the factor prices good at 1.00 and evil at
  // 0.5-0.6, so it needs this ratio near 0.55. Near 1.00 a clean team
  // identifies a leader who was trying, which every leader does.
  assert.ok(
    Math.abs(result.diagnosticRatio - 1) < 0.25,
    `diagnostic ratio ${result.diagnosticRatio} should be near 1`,
  )
  assert.ok(
    result.diagnosticRatio > 0.8,
    'a ratio well below 1 would mean the factor discriminates and BELIEF-004 '
    + 'should be reopened',
  )
})

test('BELIEF-003: evil votes are confirmed and good votes are discarded', () => {
  const result = voteDiagnostic(games)

  // The factor's one claim, and it holds: evil approves a team it can sink far
  // more readily than one it cannot.
  assert.ok(
    result.evil.oddsRatio > 2,
    `evil odds ratio ${result.evil.oddsRatio} should be well above 1`,
  )

  // The assumption the factor makes about good voters, and it does not hold.
  // "A constant for them cancels" needs this to be 1.00.
  assert.ok(
    result.good.oddsRatio < 0.35,
    `good odds ratio ${result.good.oddsRatio} should be far below the 1.00 the `
    + 'factor assumes',
  )

  // And the good signal is the larger of the two, measured as distance from
  // the no-information point on a log-odds scale. This is the reason
  // BELIEF-003 is worth doing before the factor is seated at all.
  assert.ok(
    Math.abs(Math.log(result.good.oddsRatio))
      > Math.abs(Math.log(result.evil.oddsRatio)),
    'good votes should carry more signal than evil votes',
  )

  // Not a Merlin artifact, which is the obvious objection: Merlin sees evil
  // outright, so its ballots would discriminate perfectly whatever anyone
  // else does. Seats that genuinely do not know still discriminate strongly.
  const servant = result.goodByRole['servant']
  assert.ok(servant, 'the corpus must contain servant ballots')
  assert.ok(
    servant.oddsRatio < 0.4,
    `servant-only odds ratio ${servant.oddsRatio} should still be well below 1`,
  )
})
