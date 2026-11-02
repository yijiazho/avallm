// test-lane: fast
// The post-game projection is a second hidden-information chokepoint: it must
// be unreachable before gameOver and, after it, complete and deeply frozen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../server/engine/game.ts'
import { viewFor, viewForPostgame } from '../../server/engine/view.ts'
import { createHeuristicAgent } from '../../server/agents/heuristic.ts'
import { runGame } from '../../server/sim/runner.ts'
import type { AvalonAgent } from '../../server/agents/types.ts'
import type { Game, PlayerView, Seat } from '../../server/engine/types.ts'
import type { PostgameView } from '../../server/engine/view.ts'

type IsAssignable<A, B> = A extends B ? true : false

async function finishedGame(seed = 'postgame-view'): Promise<Game> {
  const game = createGame({
    seed,
    playerCount: 7,
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createHeuristicAgent({ seed, seat: player.seat }),
    ]),
  )
  await runGame({ game, agents })
  return game
}

test('viewForPostgame refuses every phase before gameOver', async () => {
  const game = createGame({ seed: 'postgame-early', playerCount: 5 })
  assert.throws(() => viewForPostgame(game, 0), /gameOver/)
})

test('after gameOver the projection carries every role, event, and the outcome', async () => {
  const game = await finishedGame()
  assert.equal(game.phase, 'gameOver')
  assert.ok(game.outcome)

  for (const player of game.players) {
    const view: PostgameView = viewForPostgame(game, player.seat)
    const live: PlayerView = viewFor(game, player.seat)

    assert.equal(view.seat, player.seat)
    assert.equal(view.name, player.name)
    assert.equal(view.role, player.role)
    assert.equal(view.alignment, player.alignment)
    assert.deepEqual(view.privateInfo, live.privateInfo)
    assert.equal(view.playerCount, game.config.playerCount)
    assert.deepEqual(view.rolesInPlay, game.config.roles.slice().sort())

    for (const other of game.players) {
      const projected = view.players[other.seat]
      assert.ok(projected)
      assert.equal(projected.role, other.role)
      assert.equal(projected.alignment, other.alignment)
      assert.equal(projected.name, other.name)
    }

    assert.deepEqual(view.quests, live.quests)
    assert.deepEqual(view.proposals, live.proposals)
    assert.deepEqual(view.transcript, live.transcript)
    assert.equal(view.events.length, game.log.length)
    assert.deepEqual(
      view.events.map((event) => event.seq),
      game.log.map((event) => event.seq),
    )
    assert.deepEqual(view.outcome, game.outcome)

    // The whole snapshot is frozen at runtime, including nested arrays.
    assert.ok(Object.isFrozen(view), 'view is frozen')
    assert.ok(Object.isFrozen(view.players), 'players array is frozen')
    assert.ok(Object.isFrozen(view.players[0]), 'player object is frozen')
    assert.ok(Object.isFrozen(view.events), 'events array is frozen')
    assert.ok(Object.isFrozen(view.quests), 'quests array is frozen')
    assert.ok(Object.isFrozen(view.proposals), 'proposals array is frozen')
    assert.ok(Object.isFrozen(view.transcript), 'transcript array is frozen')
    assert.ok(Object.isFrozen(view.outcome), 'outcome is frozen')
  }
})

test('PostgameView is not assignable to PlayerView', () => {
  const notPlayerView: IsAssignable<PostgameView, PlayerView> = false
  assert.equal(notPlayerView, false)
})
