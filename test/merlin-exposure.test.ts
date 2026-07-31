// test-lane: fast
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
  compareMerlinExposure,
  measureMerlinExposure,
  scoreMerlinExposure,
  seedIndex,
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

// The pooled headline must be a BALANCED panel. Exposure rises with rounds, so
// averaging each game over however many readings it happened to produce lets a
// policy that wins its quests faster read as leaking less, which inverts what
// the metric is for.
test('the headline is balanced by depth, not by whatever each game produced', async () => {
  const artifacts = await Promise.all(
    ['bal-a', 'bal-b', 'bal-c', 'bal-d'].map((seed) => play(7, seed)),
  )
  const { scored, summary } = measureMerlinExposure(artifacts)
  assert.ok(scored.length >= 3)
  const depths = scored.map((game) => game.samples.length)
  assert.equal(summary.balancedDepth, Math.min(...depths))
  assert.equal(summary.balancedLift.observations, scored.length)
  // Recompute the panel independently: every game contributes exactly
  // balancedDepth readings, so no game's length can weight its own mean.
  const expected = scored.map((game) => {
    const window = game.samples.slice(0, summary.balancedDepth)
    return window.reduce((sum, sample) => sum + sample.lift, 0) / window.length
  })
  const mean = expected.reduce((sum, value) => sum + value, 0) / expected.length
  assert.ok(Math.abs((summary.balancedLift.mean ?? NaN) - mean) < 1e-12)
  // The unbalanced figure is kept, and must be labelled rather than removed:
  // it uses the whole corpus and is the right thing when depths already match.
  assert.equal(summary.clusteredLift.observations, scored.length)
  if (new Set(depths).size > 1) {
    assert.notEqual(summary.balancedLift.mean, summary.clusteredLift.mean)
  }
})

// A run that quietly lost most of its readings must not present tight intervals
// over the remainder as though it were complete.
test('skipped readings are counted, not silently dropped', async () => {
  const { scored, summary } = measureMerlinExposure([await play(7, 'skip')])
  assert.equal(
    summary.skippedReadings,
    scored.reduce((sum, game) => sum + game.skippedReadings, 0),
  )
  // This corpus should lose nothing; the assertion is that the count exists and
  // is truthful, so a future regression shows up as a number rather than as
  // silence.
  assert.equal(summary.skippedReadings, 0)
})

// The comparison pairs on the DEAL, which is the dominant variance source, and
// matches depth within each pair, because two arms diverge and one can outlive
// the other by a quest.
test('a comparison pairs on the seed and matches depth within each pair', async () => {
  // The same deal played twice is what a bench produces for two arms: identical
  // seed, different artifact id.
  const left = await play(7, 'pairing')
  const right = { ...structuredClone(left), id: `${left.id}-arm2` }
  const index = seedIndex([left, right])
  const a = scoreMerlinExposure(left)!
  const b = scoreMerlinExposure(right)!
  const same = compareMerlinExposure([a], [b], index)
  assert.equal(same.pairs, 1)
  assert.equal(same.unpaired, 0)
  assert.equal(same.liftDelta.mean, 0, 'a game against itself must differ by 0')

  // Depth matching: truncating one arm must not charge the other for readings
  // its partner never took. Exposure rises with rounds, so an unmatched compare
  // would report a spurious positive here.
  const shortened = { ...b, samples: b.samples.slice(0, 3) }
  const matched = compareMerlinExposure([a], [shortened], index)
  assert.equal(matched.pairs, 1)
  assert.equal(
    matched.liftDelta.mean,
    0,
    'the same readings truncated to a common depth must still differ by 0',
  )

  // A candidate whose deal the baseline never played is dropped, not joined to
  // whatever happened to sit at the same index.
  const orphan = await play(7, 'orphan')
  const wider = seedIndex([left, right, orphan])
  const dropped = compareMerlinExposure(
    [a],
    [b, scoreMerlinExposure(orphan)!],
    wider,
  )
  assert.equal(dropped.pairs, 1)
  assert.equal(dropped.unpaired, 1)
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
