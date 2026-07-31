// test-lane: contract
// The private pin read: what a seat knows that the table does not. Uses
// Merlin's opening vision as the deterministic pin case (Merlin's belief pins
// every evil it sees while the public read, with no quests yet, is unsure).
// A quest-derived pin (the servant-pins-minion case) surfaces identically,
// since the seat's belief integrates the quest record the same way vision is.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { ROLE_ALIGNMENT } from '../server/engine/rules.ts'
import {
  buildEvilExposureRead,
  buildPrivatePinRead,
  validateAdmittedEvilExposureReadHostJoin,
  validateAdmittedPrivatePinReadHostJoin,
  validateEvilExposureReadSnapshot,
  validatePrivatePinReadSnapshot,
} from '../server/agents/analysis/private-pin.ts'

function merlinView() {
  const game = createGame({
    seed: 'private-pin-1',
    playerCount: 5,
    roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const merlin = game.players.find((player) => player.role === 'merlin')!.seat
  const view = viewFor(game, merlin)
  return { game, merlin, view, belief: exactBelief(view) }
}

test('a seat pins the alignments its belief knows and the table does not', () => {
  const { game, merlin, view, belief } = merlinView()
  const read = buildPrivatePinRead({ view, belief })

  const visibleEvil = game.players
    .filter((player) => ROLE_ALIGNMENT[player.role] === 'evil' && player.role !== 'mordred')
    .map((player) => player.seat)
  for (const seat of visibleEvil) {
    const row = read.rows[seat]
    assert.equal(row.pin, 'evil', `seat ${seat} should be pinned evil`)
    assert.equal(row.privateEvilProbability, 1)
    assert.ok(row.publicEvilProbability > 0 && row.publicEvilProbability < 1)
  }
  // Merlin knows every alignment, so it pins the whole table: both evils and
  // both remaining goods, with its own row excluded from the leverage counts.
  assert.equal(read.pinnedEvilCount, visibleEvil.length)
  assert.equal(read.pinnedGoodCount, 5 - 1 - visibleEvil.length)
  assert.equal(read.rows[merlin].seat, merlin)
  assert.equal(read.rows[merlin].pin, 'good')
})

test('the built read validates and a tampered one does not', () => {
  const { view, belief } = merlinView()
  const read = buildPrivatePinRead({ view, belief })
  assert.ok(validatePrivatePinReadSnapshot(read))
  assert.ok(validateAdmittedPrivatePinReadHostJoin(read, { view, belief }))

  // Flip a pin without touching the probabilities it must follow from: the
  // schema recomputes the pin from the row and rejects the contradiction.
  const tampered = structuredClone(read) as unknown as {
    rows: { pin: unknown }[]
  }
  const evilRow = tampered.rows.find((row) => row.pin === 'evil')!
  evilRow.pin = null
  assert.equal(validatePrivatePinReadSnapshot(tampered), false)
  assert.equal(
    validateAdmittedPrivatePinReadHostJoin(
      tampered as never,
      { view, belief },
    ),
    false,
  )
})

// Drive a 5-player game so that an evil seat and a good seat run quest 1 (team
// size 2) and the evil seat fails it: failCount 1 === teamSize - 1, so the good
// member is the lone good and knows its teammate is evil.
function collapsedExposure() {
  const game = createGame({
    seed: 'evil-exposure-1',
    playerCount: 5,
    roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const evilSeat = game.players.find(
    (player) => ROLE_ALIGNMENT[player.role] === 'evil',
  )!.seat
  const goodSeat = game.players.find(
    (player) => ROLE_ALIGNMENT[player.role] === 'good',
  )!.seat
  const propose = expectedDecisions(game)[0]
  assert.equal(propose.kind, 'propose')
  applyDecision(game, propose.seat, {
    kind: 'propose',
    team: [evilSeat, goodSeat].sort((left, right) => left - right),
  })
  let guard = 0
  while (guard++ < 20) {
    const reqs = expectedDecisions(game)
    if (!reqs.length) break
    const req = reqs[0]
    if (req.kind === 'vote') {
      for (const vote of reqs) applyDecision(game, vote.seat, { kind: 'vote', vote: 'approve' })
    } else if (req.kind === 'finalize') {
      applyDecision(game, req.seat, { kind: 'finalize', stick: true })
    } else if (req.kind === 'quest') {
      applyDecision(game, req.seat, {
        kind: 'quest',
        card: req.seat === evilSeat ? 'fail' : 'success',
      })
    } else {
      break // reached the round-2 proposal
    }
  }
  const view = viewFor(game, evilSeat)
  return { game, evilSeat, goodSeat, view, belief: exactBelief(view) }
}

test('evil exposure names the good seat that shared a collapsed failed quest', () => {
  const { evilSeat, goodSeat, view, belief } = collapsedExposure()
  const read = buildEvilExposureRead({ view, belief })
  assert.equal(read.actingSeat, evilSeat)
  assert.ok(
    read.pinners.some(
      (pinner) => pinner.seat === goodSeat && pinner.channel === 'quest-collapse',
    ),
    'the good teammate on the collapsed quest should pin the evil seat',
  )
  // No evil seat (a partner) is ever a pinner.
  assert.ok(read.pinners.every((pinner) => pinner.seat !== evilSeat))
  assert.ok(validateEvilExposureReadSnapshot(read))
  assert.ok(validateAdmittedEvilExposureReadHostJoin(read, { view, belief }))
})

test('evil exposure is inapplicable to a good seat', () => {
  const game = createGame({
    seed: 'evil-exposure-1',
    playerCount: 5,
    roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const goodSeat = game.players.find(
    (player) => ROLE_ALIGNMENT[player.role] === 'good',
  )!.seat
  const view = viewFor(game, goodSeat)
  assert.throws(
    () => buildEvilExposureRead({ view, belief: exactBelief(view) }),
    /requires an evil seat/,
  )
})
