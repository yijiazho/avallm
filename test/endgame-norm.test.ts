// Good's talk incentive inverts at its own match point, and nothing used to say
// so. The shared doctrine tells good players to make confident reads so that
// Merlin is not the only seat who always knows, which is right while quests are
// still being contested. One quest from the win it is the opposite: the quests
// are effectively over and the assassination is the only remaining way to lose,
// so a confident public read is free intelligence for the shot.
//
// Observed (seed web-0795b9d22b): at 2-0 a seat certified another player's vote
// record as perfect, in public, and the Assassin shot that player. Nobody at the
// table played around the assassination at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { alignmentShared, GOOD_SHARED } from '../server/agents/prompts.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import type { Game, Role, Seat } from '../server/engine/types.ts'

const CERTIFY = /Stop certifying people/

// Drive N quests to success with the leader's rotating block of seats.
function board(roles: Role[], successes: number): Game {
  const g = createGame({ seed: 'endgame', playerCount: roles.length, roles: [...roles] })
  for (let i = 0; i < successes; i++) {
    const size = g.quests[g.round - 1].teamSize
    applyDecision(g, g.leaderSeat, {
      kind: 'propose', team: Array.from({ length: size }, (_, k) => (g.leaderSeat + k) % roles.length),
    })
    for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
    while (g.phase === 'discussion') { const [d] = expectedDecisions(g); applyDecision(g, d.seat, { kind: 'discuss', say: '' }) }
    if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
    for (const d of expectedDecisions(g)) if (d.kind === 'quest') applyDecision(g, d.seat, { kind: 'quest', card: 'success' })
  }
  return g
}
const seatOf = (g: Game, role: Role): Seat => g.players.find((p) => p.role === role)!.seat
const sharedFor = (g: Game, role: Role) => alignmentShared(viewFor(g, seatOf(g, role)))

test('good is told to stop certifying only once it is one quest from winning', () => {
  const early = board(DEFAULT_ROLES[5], 1)
  assert.doesNotMatch(sharedFor(early, 'merlin'), CERTIFY, 'at 1-0 the confident-reads doctrine still applies')

  const late = board(DEFAULT_ROLES[5], 2)
  const text = sharedFor(late, 'merlin')
  assert.match(text, CERTIFY)
  assert.match(text, /the assassination is now the only way you lose/)
  // The point is a behaviour, not a mood: it has to name what to stop doing.
  assert.match(text, /do not call anyone's record clean or flawless/)
  // And it must not read as "go quiet", which is how Merlin gets found the other
  // way. Teams still get built and argued, off the public record.
  assert.match(text, /Keep building teams around the players the quests have cleared/)
})

test('every good seat gets it, not just the one holding the secret', () => {
  // Protecting Merlin is a team job, so a Servant certifying the table is the
  // same leak as Merlin doing it. The clause hangs off alignment, not role.
  const g = board(DEFAULT_ROLES[5], 2)
  for (const role of ['merlin', 'percival', 'servant'] as Role[]) {
    assert.match(sharedFor(g, role), CERTIFY, `${role} should get the endgame clause`)
  }
})

test('evil never gets it', () => {
  const g = board(DEFAULT_ROLES[5], 2)
  for (const role of ['morgana', 'assassin'] as Role[]) {
    assert.doesNotMatch(sharedFor(g, role), CERTIFY, `${role} is on the other side of this`)
  }
})

test('a cast with no shot is left alone, since it has nothing to protect', () => {
  // Vanilla: no Merlin, no Assassin. Three quests simply end it, and the opener
  // already tells this table to disclose everything. Adding a hiding clause here
  // would describe a threat that is not at the table.
  const vanilla: Role[] = ['servant', 'servant', 'servant', 'minion', 'minion']
  const g = board(vanilla, 2)
  const text = alignmentShared(viewFor(g, g.players.find((p) => p.alignment === 'good')!.seat))
  assert.doesNotMatch(text, CERTIFY)
  assert.doesNotMatch(text, /Assassin/)
  assert.match(text, /nothing to be gained by holding a read back/)
})

test('the /api/agents anatomy shows the clause rather than hiding it behind a board state', () => {
  // GOOD_SHARED is the unpruned superset for the prompt-anatomy display, so a
  // reader can see every branch that a live call might take.
  assert.match(GOOD_SHARED, CERTIFY)
})
