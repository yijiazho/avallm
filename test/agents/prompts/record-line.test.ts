// test-lane: fast
// The quest record, stated as a conclusion instead of as arithmetic.
//
// The facts dossier has printed "2 Fails, so at least 2 of these 4 are evil"
// since the start, and across every observed game no bot spent it as an
// elimination: one seat's closing model had all three players on a quest it had
// watched fail reading good, which the quest itself refutes. Premises alone have
// been tried, so board.ts does the elimination and knowledgeText states it.
//
// Kept out of the deal lines on purpose. What the deal showed you can never be
// said out loud; what a quest you sat on proves usually can, and the seat needs
// to be able to tell the two apart before it opens its mouth.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { knowledgeText } from '../../../server/agents/prompts.ts'
import { DEFAULT_ROLES } from '../../../server/engine/rules.ts'
import type { Game, Role, Seat } from '../../../server/engine/types.ts'

const seatOf = (g: Game, role: Role): Seat => g.players.find((p) => p.role === role)!.seat
// Seats render as "P4(seat 4)", so anchor on the name plus its suffix rather
// than on the bare name, which would not match.
const shows = (g: Game, seat: Seat, claim: string) =>
  new RegExp(`${g.players[seat].name}\\(seat ${seat}\\) ${claim}`)

// Run one quest with the given team and cards, from a fresh game.
function questWith(g: Game, team: Seat[], fails: Seat[]): void {
  applyDecision(g, g.leaderSeat, { kind: 'propose', team })
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  while (g.phase === 'discussion') { const [d] = expectedDecisions(g); applyDecision(g, d.seat, { kind: 'discuss', say: '' }) }
  if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  for (const s of team) applyDecision(g, s, { kind: 'quest', card: fails.includes(s) ? 'fail' : 'success' })
}

const std5 = () => createGame({ seed: 'record', playerCount: 5, roles: DEFAULT_ROLES[5] })

test('nothing is said before a quest has resolved', () => {
  const g = std5()
  for (const p of g.players) {
    assert.doesNotMatch(knowledgeText(viewFor(g, p.seat)), /quest record has since settled/,
      `seat ${p.seat} (${p.role}) has no record to reason from yet`)
  }
})

test('a failure the seat sat on names the player it proves evil', () => {
  const g = std5()
  const percival = seatOf(g, 'percival'), morgana = seatOf(g, 'morgana')
  questWith(g, [percival, morgana], [morgana])

  const text = knowledgeText(viewFor(g, percival))
  assert.match(text, /quest record has since settled/)
  assert.match(text, shows(g, morgana, 'as EVIL'))
  assert.match(text, /Quest 1 names/, 'the seat must be able to check the claim against the board')
  // The cascade: closing the Morgana half of his pair settles the other as Merlin.
  assert.match(text, shows(g, seatOf(g, 'merlin'), 'is GOOD'))
})

test('the deduction carries its own disclosure rule', () => {
  // A record deduction is sometimes public-safe and sometimes the exact leak the
  // deal lines are gagged for, and which one it is depends on the premise. Both
  // halves have to be stated, or the seat picks the wrong default.
  const g = std5()
  const percival = seatOf(g, 'percival'), morgana = seatOf(g, 'morgana')
  questWith(g, [percival, morgana], [morgana])
  const text = knowledgeText(viewFor(g, percival))
  assert.match(text, /if it rests on a quest you sat on yourself/)
  assert.match(text, /showing the working shows what you are/)
})

test('one quest that forces two seats says so once, not twice in the singular', () => {
  // A quest can take more Fails than the rest of its team can account for, and
  // then it closes several seats at the same stroke. Rendering them separately
  // claimed "the only seat you cannot account for" about each of two players in
  // one sentence (929 of 2713 renders across the played-out sweep).
  const g = createGame({ seed: 'record', playerCount: 5, roles: DEFAULT_ROLES[5] })
  const servant = seatOf(g, 'servant'), morgana = seatOf(g, 'morgana'), assassin = seatOf(g, 'assassin')
  // Both evil aboard a 2-person quest, both play Fail: 2 Fails, 2 seats, and the
  // Servant knows he is neither of them.
  questWith(g, [morgana, assassin], [morgana, assassin])

  const text = knowledgeText(viewFor(g, servant))
  assert.match(text, /Quest 1 took more Fails than the rest of its team can account for/)
  // Joined into one claim: the first name runs into the second, and the side
  // label is carried once at the end rather than repeated per seat.
  const pair = [morgana, assassin].sort((a, b) => a - b)
  assert.ok(text.includes(`${g.players[pair[0]].name}(seat ${pair[0]}) and`), 'the pair must be joined')
  assert.match(text, shows(g, pair[1], 'as EVIL'))
  assert.doesNotMatch(text, /the only seat/,
    'a singular claim about two players is a contradiction the model will read literally')
  // The reason is stated once for the pair, not once per seat.
  assert.equal(text.match(/took more Fails/g)?.length, 1)
})

test('a consequence is never printed before the deduction it follows from', () => {
  // Budget deductions are downstream of the quest ones, and fromRecord is in
  // seat order, so a low-numbered seat closed by the budget used to be rendered
  // first while pointing at "the seats above" that had not been stated yet.
  const g = std5()
  const percival = seatOf(g, 'percival'), morgana = seatOf(g, 'morgana')
  questWith(g, [percival, morgana], [morgana])
  const text = knowledgeText(viewFor(g, percival))
  const merlin = seatOf(g, 'merlin')
  assert.ok(merlin < morgana, 'this seed must put the derived seat FIRST, or the case is not exercised')
  assert.ok(text.indexOf('Quest 1 names') < text.indexOf('follows once those seats are placed'),
    'the quest deduction has to be stated before the thing that follows from it')
})

test('a failure that proves nothing says nothing', () => {
  // Two unplaced seats and one Fail: the constraint is satisfiable either way,
  // so there is no elimination and the line must stay off. A prompt that named
  // one of them would be inventing certainty, which is worse than silence.
  const g = std5()
  const servant = seatOf(g, 'servant')
  questWith(g, [seatOf(g, 'morgana'), seatOf(g, 'assassin')], [seatOf(g, 'morgana')])
  assert.doesNotMatch(knowledgeText(viewFor(g, servant)), /quest record has since settled/)
})

test('a seat the deal already placed is not re-announced as news', () => {
  // Merlin sees both evil from the start. A quest one of them fails adds nothing
  // to his map, and repeating it as a fresh deduction would read as new evidence
  // and inflate what the record has actually shown him.
  const g = std5()
  const merlin = seatOf(g, 'merlin')
  questWith(g, [seatOf(g, 'morgana'), seatOf(g, 'assassin')], [seatOf(g, 'morgana')])
  const text = knowledgeText(viewFor(g, merlin))
  assert.match(text, /You see these players as EVIL/, 'the deal line is still there')
  assert.doesNotMatch(text, /quest record has since settled/)
})
