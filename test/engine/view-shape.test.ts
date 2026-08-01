// test-lane: contract
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDecision, createGame, expectedDecisions } from '../../server/engine/game.ts'
import { viewFor, viewForSpectator } from '../../server/engine/view.ts'
import type { Game, PlayerView } from '../../server/engine/types.ts'

const OPTIONAL_VIEW_KEYS = [
  'currentTeam',
  'discussionRound',
  'discussionPostRevision',
  'outcome',
] as const
type OptionalViewKey = typeof OPTIONAL_VIEW_KEYS[number]

function views(game: Game): readonly PlayerView[] {
  return [viewFor(game, 0), viewForSpectator(game)]
}

function assertOwns(view: PlayerView, keys: readonly OptionalViewKey[]): void {
  for (const key of keys) {
    assert.equal(Object.hasOwn(view, key), true, `expected view to own ${key}`)
  }
}

function assertOmits(view: PlayerView, keys: readonly OptionalViewKey[]): void {
  for (const key of keys) {
    assert.equal(Object.hasOwn(view, key), false, `expected view to omit ${key}`)
  }
}

function voteAll(game: Game, vote: 'approve' | 'reject'): void {
  for (const player of game.players) {
    applyDecision(game, player.seat, { kind: 'vote', vote })
  }
}

function failCurrentQuest(game: Game): void {
  const evil = game.players.find((player) => player.alignment === 'evil')
  assert.ok(evil)
  const teamSize = game.quests[game.round - 1]!.teamSize
  const team = [
    evil.seat,
    ...game.players
      .map((player) => player.seat)
      .filter((seat) => seat !== evil.seat)
      .slice(0, teamSize - 1),
  ].sort((a, b) => a - b)

  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  voteAll(game, 'approve')
  for (const seat of game.currentTeam!) {
    applyDecision(game, seat, {
      kind: 'quest',
      card: seat === evil.seat ? 'fail' : 'success',
    })
  }
}

test('engine-owned resettable state remains present through phase transitions', () => {
  const game = createGame({
    seed: 'owned-engine-state',
    playerCount: 5,
    talk: { maxRounds: 1, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })

  assert.equal(Object.hasOwn(game, 'discussion'), true)
  assert.equal(Object.hasOwn(game, 'currentTeam'), true)
  assert.equal(game.discussion, undefined)
  assert.equal(game.currentTeam, undefined)
  assert.equal(Object.hasOwn(game, 'outcome'), false)

  const team = [game.leaderSeat, (game.leaderSeat + 1) % 5].sort((a, b) => a - b)
  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  assert.ok(game.discussion)
  assert.deepEqual(game.currentTeam, team)

  while (game.phase === 'discussion') {
    const [request] = expectedDecisions(game)
    assert.ok(request?.kind === 'discuss')
    applyDecision(game, request.seat, { kind: 'discuss', say: '' })
  }
  assert.equal(game.discussion, undefined)
  assert.equal(Object.hasOwn(game, 'discussion'), true)

  applyDecision(game, game.leaderSeat, { kind: 'finalize', stick: true })
  voteAll(game, 'reject')
  assert.equal(game.currentTeam, undefined)
  assert.equal(Object.hasOwn(game, 'currentTeam'), true)
})

test('player and spectator views omit inactive optional fields', () => {
  const game = createGame({
    seed: 'omitted-view-state',
    playerCount: 5,
    talk: { maxRounds: 1, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })

  for (const view of views(game)) assertOmits(view, OPTIONAL_VIEW_KEYS)

  const team = [game.leaderSeat, (game.leaderSeat + 1) % 5].sort((a, b) => a - b)
  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  for (const view of views(game)) {
    assertOwns(view, ['currentTeam', 'discussionRound', 'discussionPostRevision'])
    assertOmits(view, ['outcome'])
  }

  while (game.phase === 'discussion') {
    const [request] = expectedDecisions(game)
    assert.ok(request?.kind === 'discuss')
    applyDecision(game, request.seat, { kind: 'discuss', say: '' })
  }
  for (const view of views(game)) {
    assertOwns(view, ['currentTeam'])
    assertOmits(view, ['discussionRound', 'discussionPostRevision', 'outcome'])
  }
})

test('completed views own outcome and omit cleared phase state', () => {
  const game = createGame({
    seed: 'completed-view-state',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  failCurrentQuest(game)
  failCurrentQuest(game)
  failCurrentQuest(game)
  assert.equal(game.phase, 'gameOver')

  for (const view of views(game)) {
    assertOwns(view, ['outcome'])
    assertOmits(view, ['currentTeam', 'discussionRound', 'discussionPostRevision'])
    assert.deepEqual(view.outcome, { winner: 'evil', reason: 'threeFails' })
  }
})
