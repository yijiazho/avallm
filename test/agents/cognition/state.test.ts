// test-lane: fast
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import {
  advanceCognition,
  publicCognition,
  reconstructCognition,
} from '../../../server/agents/cognition/state.ts'
import type { CognitionState } from '../../../server/agents/cognition/types.ts'
import type { Game, PlayerView, Seat } from '../../../server/engine/types.ts'

function distinctTeam(leader: Seat, offset: number, count: number): Seat[] {
  return [leader, (leader + offset) % count]
}

function proposalWithRevision(): {
  game: Game
  before: PlayerView
  after: PlayerView
} {
  const game = createGame({
    seed: 'phase2-cognition',
    playerCount: 5,
    talk: {
      maxRounds: 1,
      maxRoundsAfterChange: 1,
      leaderInDiscussion: 'last',
    },
  })
  const leader = game.leaderSeat
  applyDecision(game, leader, {
    kind: 'propose',
    team: distinctTeam(leader, 1, 5),
    pitch: 'I back this pair.',
  })
  const before = viewFor(game, 0)
  while (game.phase === 'discussion') {
    const [request] = expectedDecisions(game)
    applyDecision(game, request.seat, {
      kind: 'discuss',
      say: `seat ${request.seat} literal statement`,
    })
  }
  applyDecision(game, leader, {
    kind: 'finalize',
    stick: false,
    team: distinctTeam(leader, 2, 5),
    reason: 'I am answering the objection.',
  })
  while (game.phase === 'discussion') {
    const [request] = expectedDecisions(game)
    applyDecision(game, request.seat, {
      kind: 'discuss',
      say: `seat ${request.seat} revised-team statement`,
    })
  }
  for (const request of expectedDecisions(game)) {
    applyDecision(game, request.seat, { kind: 'vote', vote: 'approve' })
  }
  return { game, before, after: viewFor(game, 0) }
}

test('typed evidence uses stable ids, seat-visible scope, and deterministic order', () => {
  const { after } = proposalWithRevision()
  const state = reconstructCognition(after)
  assert.equal(new Set(state.evidence.map((record) => record.id)).size, state.evidence.length)
  assert.deepEqual(
    state.evidence,
    [...state.evidence].sort(
      (a, b) => a.sourceSeq - b.sourceSeq || a.id.localeCompare(b.id),
    ),
  )
  assert.ok(state.evidence.some((record) => record.kind === 'private-role'))
  assert.ok(state.evidence.some((record) => record.kind === 'private-knowledge'))
  assert.ok(state.evidence.some((record) => record.kind === 'proposal'))
  assert.ok(state.evidence.some((record) => record.kind === 'proposal-revised'))
  assert.ok(state.evidence.some((record) => record.kind === 'vote-reveal'))
  assert.ok(state.evidence.some((record) =>
    record.kind === 'utterance' && record.payload.text.includes('literal statement')))
  assert.ok(!state.evidence.some((record) =>
    record.kind === ('vote-cast' as typeof record.kind)))
})

test('incremental cognition is idempotent and equals full reconstruction', () => {
  const { before, after } = proposalWithRevision()
  const initial = reconstructCognition(before)
  const advanced = advanceCognition(initial, after)
  const repeated = advanceCognition(advanced, after)
  const rebuilt = reconstructCognition(after)
  assert.deepEqual(advanced, rebuilt)
  assert.deepEqual(repeated, rebuilt)
  assert.equal(advanced.throughSeq, Math.max(...after.events.map((event) => event.seq)))
})

test('public cognition is identical across seats and excludes private cognition', () => {
  const { game } = proposalWithRevision()
  const projections = game.players.map((player) =>
    publicCognition(reconstructCognition(viewFor(game, player.seat))))
  for (const projection of projections.slice(1)) {
    assert.deepEqual(projection, projections[0])
  }
  const serialized = JSON.stringify(projections[0])
  assert.ok(!serialized.includes('private-role'))
  assert.ok(!serialized.includes('private-knowledge'))
  assert.ok(!serialized.includes('worlds'))
  assert.ok(!serialized.includes('playerMarginals'))
})

test('commitment ledger records proposals, revisions, votes, and literal speech', () => {
  const { after } = proposalWithRevision()
  const commitments = reconstructCognition(after).commitments
  const teams = commitments.filter((commitment) => commitment.kind === 'team')
  assert.equal(teams.length, 2)
  const [firstTeam, secondTeam] = teams
  assert.equal(firstTeam.status, 'superseded')
  if (firstTeam.status === 'superseded') {
    assert.equal(firstTeam.supersededBy, secondTeam.id)
  }
  assert.equal(secondTeam.status, 'current')
  assert.ok(commitments.some((commitment) =>
    commitment.kind === 'vote'
    && commitment.payload.type === 'vote'
    && commitment.payload.vote === 'approve'))
  assert.ok(commitments.some((commitment) =>
    commitment.kind === 'utterance'
    && commitment.payload.type === 'utterance'
    && commitment.payload.channel === 'pitch'))
  assert.ok(commitments.some((commitment) =>
    commitment.kind === 'utterance'
    && commitment.payload.type === 'utterance'
    && commitment.payload.channel === 'revision-reason'))
  assert.ok(commitments.some((commitment) =>
    commitment.kind === 'utterance'
    && commitment.payload.type === 'utterance'
    && commitment.payload.text.includes('literal statement')))
})

test('advancing cognition rejects a different viewing seat', () => {
  const game = createGame({ seed: 'seat-scope', playerCount: 5 })
  const state: CognitionState = reconstructCognition(viewFor(game, 0))
  assert.throws(
    () => advanceCognition(state, viewFor(game, 1)),
    /cannot advance seat 0 cognition with seat 1 view/,
  )
})
