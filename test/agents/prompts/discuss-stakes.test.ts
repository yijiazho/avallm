// test-lane: fast
// The discuss ASK carries evil's board stakes, because what a seat says about
// the team is public and concerns the same team the vote ASK already reasons
// about.
//
// Seed web-086364ddc4, Q5.3: the assassin argued against a team carrying its own
// partner at 2-2 TWICE, a team that wins the game outright, then voted approve
// once the vote ASK stated the stakes. Two costs. The table read the wrong
// position, and arguing one way then voting the other is the exact
// inconsistency the vote ASK asks a seat to expect the table to notice.
//
// Both ASKs read the same board.ts triggers (knownEvilAboard, matchPoint), so the
// trigger cannot drift between them. Only the phrasing differs, because talking
// and voting are different acts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { buildMessages } from '../../../server/agents/raw-llm/prompts.ts'
import { DEFAULT_ROLES } from '../../../server/engine/rules.ts'
import type { Game, Seat } from '../../../server/engine/types.ts'

const CAST = DEFAULT_ROLES[5]
const seatOf = (g: Game, role: string): Seat => g.players.find((p) => p.role === role)!.seat

// Drive to a discussion with a chosen team on the table and a chosen board.
function tableWith(team: Seat[], successes: number): Game {
  const g = createGame({ seed: 'stakes', playerCount: 5, roles: [...CAST], talk: { maxRounds: 2, maxRoundsAfterChange: 1 } })
  for (let i = 0; i < successes; i++) {
    const size = g.quests[g.round - 1].teamSize
    const t = Array.from({ length: size }, (_, k) => (g.leaderSeat + k) % 5)
    applyDecision(g, g.leaderSeat, { kind: 'propose', team: t })
    for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
    while (g.phase === 'discussion') { const [d] = expectedDecisions(g); applyDecision(g, d.seat, { kind: 'discuss', say: '' }) }
    if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
    for (const d of expectedDecisions(g)) if (d.kind === 'quest') applyDecision(g, d.seat, { kind: 'quest', card: 'success' })
  }
  applyDecision(g, g.leaderSeat, { kind: 'propose', team })
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  return g
}
const discussFor = (g: Game, seat: Seat) =>
  buildMessages('discuss', viewFor(g, seat), '', {}, { chosenTeam: viewFor(g, seat).currentTeam })[1].content

test('evil is told when the team on the table is already sinkable', () => {
  const g = createGame({ seed: 'stakes', playerCount: 5, roles: [...CAST], talk: { maxRounds: 2, maxRoundsAfterChange: 1 } })
  const morgana = seatOf(g, 'morgana'), assassin = seatOf(g, 'assassin')
  const good = g.players.find((p) => p.alignment === 'good')!.seat
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [morgana, good] })
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  const text = discussFor(g, assassin)
  assert.match(text, /Your side can already sink this quest/)
  assert.match(text, /do not talk this team down/)
})

test('good players never get the evil stakes note', () => {
  const g = createGame({ seed: 'stakes', playerCount: 5, roles: [...CAST], talk: { maxRounds: 2, maxRoundsAfterChange: 1 } })
  const morgana = seatOf(g, 'morgana'), merlin = seatOf(g, 'merlin')
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [morgana, merlin] })
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  const text = discussFor(g, merlin)
  assert.doesNotMatch(text, /Your side can already sink/)
  assert.doesNotMatch(text, /your side losing outright/)
})

test("at good's match point a non-leading evil is told this is the turn that matters", () => {
  // Two successes on the board, and a team with no evil this seat knows of.
  const g = tableWith([0, 1], 2)
  const evil = g.players.find((p) => p.alignment === 'evil' && ![0, 1].includes(p.seat) && p.seat !== g.leaderSeat)
  // Assert the shape rather than bailing: a silent skip is how a test like this
  // rots into a no-op the moment the seed or the deal order changes.
  assert.ok(evil, 'seed no longer seats a non-leading evil off the team; pick one that does')
  const text = discussFor(g, evil.seat)
  assert.match(text, /good's third quest and ends the game/)
  assert.match(text, /this is the turn that actually matters/)
})

test('an evil LEADER is pointed at the revision, not told to argue against its own team', () => {
  // Telling the leader to argue it down would contradict teamNote ("do not argue
  // against your own team") two clauses earlier, and finalize's foldNote already
  // owns the revise lever.
  const g = tableWith([0, 1], 2)
  const leader = g.leaderSeat
  assert.equal(g.players[leader].alignment, 'evil', 'seed no longer leaves an EVIL leader here; pick one that does')
  assert.ok(![0, 1].includes(leader), 'the evil leader must be OFF the team on the table for this case')
  const text = discussFor(g, leader)
  assert.match(text, /Do not argue against your own team in front of the table/)
  assert.match(text, /the revision you still get after this discussion/)
  assert.doesNotMatch(text, /this is the turn that actually matters/)
})

test('after the revision is spent, the leader is not pointed at a lever it no longer has', () => {
  // endDiscussion sends the POST-REVISION segment straight to the vote (one
  // revision only), so "the revision you still get after this discussion" is
  // false there, and false in the direction that costs the game: it tells the
  // seat to bank its argument for a turn that never comes.
  const g = tableWith([0, 1], 2)
  const leader = g.leaderSeat
  assert.equal(g.players[leader].alignment, 'evil')
  while (g.phase === 'discussion') { const [d] = expectedDecisions(g); applyDecision(g, d.seat, { kind: 'discuss', say: '' }) }
  assert.equal(g.phase, 'finalize')
  // Revise onto a different pair of seats this leader still reads as harmless.
  const good = g.players.filter((p) => p.alignment === 'good').map((p) => p.seat)
  const revised = [good[0], good[2] ?? good[1]].filter((s, i, a) => a.indexOf(s) === i)
  assert.equal(revised.length, 2, 'need two distinct good seats to revise onto')
  applyDecision(g, leader, { kind: 'finalize', stick: false, team: revised })
  assert.equal(g.phase, 'discussion', 'the post-revision segment must actually run')
  const text = discussFor(g, leader)
  assert.match(text, /good's third quest and ends the game/, 'the stakes still apply')
  assert.doesNotMatch(text, /revision you still get/)
  assert.doesNotMatch(text, /you will decide whether to keep or revise/)
  assert.match(text, /revision is spent/)
})

test('the stakes note is absent before the board is decisive', () => {
  // Nothing resolved yet, and the seat cannot sink the team: no stakes to state.
  const g = createGame({ seed: 'stakes', playerCount: 5, roles: [...CAST], talk: { maxRounds: 2, maxRoundsAfterChange: 1 } })
  const merlin = seatOf(g, 'merlin'), percival = seatOf(g, 'percival')
  const evil = g.players.find((p) => p.alignment === 'evil' && p.seat !== g.leaderSeat)!.seat
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [merlin, percival] })
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  const text = discussFor(g, evil)
  assert.doesNotMatch(text, /Your side can already sink/)
  assert.doesNotMatch(text, /ends the game/)
})
