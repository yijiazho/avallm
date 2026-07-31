// Merlin exposure: the continuous form of the assassination channel.
//
// The load-carrying test here is the anchor. On an opening board, before anyone
// has acted, the assassin knows exactly what the deal told it and nothing more,
// so lift must read EXACTLY zero for every cast. The first draft of the metric
// read `+0.067` there, because it divided by the posterior's target-list length
// and that list carries every non-self seat including the partners the assassin
// already knows are evil. Nothing else in the module would have caught it: the
// numbers stayed plausible, ordered, and tightly bounded while silently
// measuring how many partners a cast lets the assassin see.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame } from '../server/engine/game.ts'
import { runGame } from '../server/sim/runner.ts'
import { createAgent } from '../server/agents/registry.ts'
import { toArtifact } from '../server/eval/artifact.ts'
import {
  MERLIN_EXPOSURE_VERSION,
  measureMerlinExposure,
  scoreMerlinExposure,
  summarizeMerlinExposure,
} from '../server/eval/merlin-exposure.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Role, Seat } from '../server/engine/types.ts'

const NO_TALK = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
} as const

const CASTS: Readonly<Record<number, readonly Role[]>> = {
  5: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  7: [
    'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon',
  ],
  9: [
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'morgana', 'assassin', 'mordred',
  ],
}

async function play(
  playerCount: number,
  seed: string,
  roles: readonly Role[] = CASTS[playerCount],
): Promise<GameArtifact> {
  const game = createGame({
    seed,
    playerCount,
    roles: [...roles],
    talk: NO_TALK,
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createAgent({ type: 'heuristic' }, { seed, seat: player.seat }),
    ]),
  )
  const result = await runGame({ game, agents })
  return toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })
}

// THE ANCHOR. Every cast, exactly zero, no tolerance slack beyond float dust.
test('an opening board reads exactly the prior, in every cast', async () => {
  for (const playerCount of [5, 7, 9]) {
    const artifact = await play(playerCount, `anchor-${playerCount}`)
    const scored = scoreMerlinExposure(artifact)
    assert.ok(scored, `${playerCount}p must be scoreable`)
    const opening = scored.samples[0]
    assert.equal(opening.questsResolved, 0)
    assert.ok(
      Math.abs(opening.lift) < 1e-12,
      `${playerCount}p opening lift was ${opening.lift}, must be zero: before `
      + 'anyone acts the assassin knows only what the deal told it',
    )
    assert.ok(
      Math.abs(opening.exposure - opening.prior) < 1e-12,
      `${playerCount}p opening exposure must equal its own prior`,
    )
    // The candidate count is the feasible-Merlin count, so it excludes both the
    // assassin itself and the partners it was dealt. Getting this wrong is what
    // the anchor above catches, and this states the reason in the open.
    assert.ok(
      opening.candidates < playerCount,
      'the assassin is never its own Merlin candidate',
    )
    assert.equal(opening.prior, 1 / opening.candidates)
  }
})

test('the metric is undefined, not zero, without a Merlin or an assassin', async () => {
  const noMerlin = await play(
    5,
    'no-merlin',
    ['servant', 'servant', 'servant', 'minion', 'oberon'],
  )
  assert.equal(
    scoreMerlinExposure(noMerlin),
    undefined,
    'a cast with no Merlin has nothing to expose; a zero would read as safety',
  )
  const { scored, summary } = measureMerlinExposure([noMerlin])
  assert.equal(scored.length, 0)
  assert.equal(summary.games, 0)
  assert.equal(summary.clusteredLift.mean, null)
})

test('a scored game reads once at the open and once per resolved quest', async () => {
  const artifact = await play(7, 'series')
  const scored = scoreMerlinExposure(artifact)
  assert.ok(scored)
  const quests = artifact.log.filter(
    (event) => event.type === 'questResult',
  ).length
  assert.ok(quests >= 3, 'a finished game resolves at least three quests')
  assert.equal(scored.samples.length, quests + 1)
  assert.deepEqual(
    scored.samples.map((sample) => sample.questsResolved),
    Array.from({ length: quests + 1 }, (_, index) => index),
  )
  for (const sample of scored.samples) {
    assert.ok(sample.exposure >= 0 && sample.exposure <= 1)
    assert.ok(sample.candidates >= 1)
    assert.equal(sample.prior, 1 / sample.candidates)
    assert.ok(Math.abs(sample.lift - (sample.exposure - sample.prior)) < 1e-12)
  }
})

// The precision claim has to be honest or the metric is worse than the binary
// it replaces: it would look decisive while being correlated noise.
test('the pooled interval is clustered by game, not by reading', async () => {
  const artifacts = await Promise.all(
    [0, 1, 2, 3, 4, 5].map((index) => play(7, `cluster-${index}`)),
  )
  const scored = artifacts.flatMap((artifact) => {
    const game = scoreMerlinExposure(artifact)
    return game ? [game] : []
  })
  assert.ok(scored.length >= 4)
  const summary = summarizeMerlinExposure(scored)
  assert.equal(summary.version, MERLIN_EXPOSURE_VERSION)
  // One observation per GAME, not per reading. If this ever counts readings the
  // interval shrinks by roughly the square root of the readings per game while
  // the underlying uncertainty has not changed at all.
  assert.equal(summary.clusteredLift.observations, scored.length)
  assert.ok(
    summary.samples > summary.clusteredLift.observations,
    'this fixture must have more readings than games or it proves nothing',
  )
  // A round slice holds exactly one reading per game, so those are independent
  // and their denominators must equal the number of games still in that round.
  for (const slice of summary.byRound) {
    assert.equal(
      slice.lift.observations,
      scored.filter((game) =>
        game.samples.some(
          (sample) => sample.questsResolved === slice.questsResolved,
        )).length,
    )
  }
})

// Retroactivity is the point of reading artifacts rather than replaying policy:
// every run already archived can be re-scored for this without a new game.
test('scoring is a pure function of the archived artifact', async () => {
  const artifact = await play(7, 'retro')
  const first = scoreMerlinExposure(artifact)
  const second = scoreMerlinExposure(structuredClone(artifact))
  assert.deepEqual(first, second)
  assert.ok(first)
  assert.equal(first.merlinSeat, artifact.players.findIndex(
    (player) => player.role === 'merlin',
  ))
  assert.equal(first.assassinSeat, artifact.players.findIndex(
    (player) => player.role === 'assassin',
  ))
  // The contrast that motivates the metric: the binary is defined only on the
  // subset that reaches an execution, this is defined on the whole game.
  assert.equal(first.reachedShot, artifact.log.some(
    (event) => event.type === 'assassination',
  ))
  assert.ok(first.samples.length > (first.reachedShot ? 1 : 0))
})
