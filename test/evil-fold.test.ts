// Evil folding under table pressure, at the one step where the leader can
// rewrite their own team: the finalize ASK tells an evil leader what revising
// evil off the team costs, so a reject-leaning table can't talk them into a
// quest their side cannot fail. The count of evil aboard is only what the
// deciding seat can SEE, so the note never assumes Oberon visibility.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages } from '../server/agents/prompts.ts'
import { MAX_PROPOSALS } from '../server/engine/rules.ts'
import type { Game, Seat } from '../server/engine/types.ts'

const NAMES = ['Ann', 'Bob', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus']

// The deal decides who leads and who is evil, so scan seeds for the shape the
// test needs rather than hand-forcing roles onto seats.
function findGame(playerCount: number, prefix: string, pred: (g: Game) => boolean): Game {
  for (let i = 0; i < 200; i++) {
    const g = createGame({
      seed: `${prefix}-${i}`,
      playerCount,
      names: NAMES.slice(0, playerCount),
      talk: { maxRounds: 1, maxRoundsAfterChange: 1 },
    })
    if (pred(g)) return g
  }
  throw new Error(`no seed in 200 tries matched ${prefix}`)
}

function runDiscussion(g: Game): void {
  while (g.phase === 'discussion') {
    const [d] = expectedDecisions(g)
    // A reject-leaning table is the pressure that made evil leaders fold.
    applyDecision(g, d.seat, { kind: 'discuss', say: 'I do not like this team.', lean: 'reject' })
  }
}

function driveToFinalize(g: Game, team: Seat[]): void {
  applyDecision(g, g.leaderSeat, { kind: 'propose', team, pitch: 'best team I have' })
  runDiscussion(g)
  assert.equal(g.phase, 'finalize')
}

function finalizeAsk(g: Game): string {
  const [, user] = buildMessages('finalize', viewFor(g, g.leaderSeat), '')
  return user.content
}

// The evil-seats-aboard clause only, so team rosters elsewhere in the prompt
// can't satisfy a name assertion about what the leader was told it can see.
function knownEvilClause(ask: string): string {
  const anchor = ask.indexOf('This team seats evil you know of:')
  assert.ok(anchor >= 0, 'the fold note names the evil aboard')
  const end = ask.indexOf('Revising them off', anchor)
  assert.ok(end > anchor, 'the clause is followed by the revision cost')
  return ask.slice(anchor, end)
}

function seatsBy(g: Game, alignment: 'good' | 'evil'): Seat[] {
  return g.players.filter((p) => p.alignment === alignment).map((p) => p.seat)
}

test('evil leader with evil aboard is told what revising away costs', () => {
  const g = findGame(5, 'ff-evil', (game) => game.players[game.leaderSeat].alignment === 'evil')
  const leader = g.leaderSeat
  const good = seatsBy(g, 'good')
  driveToFinalize(g, [leader, good[0]])

  const ask = finalizeAsk(g)
  assert.match(ask, /quest your side can no longer fail/)
  assert.ok(knownEvilClause(ask).includes(g.players[leader].name), 'the leader is named as evil aboard')
  // Non-hammer: sticking still faces a vote, and a rejection is the cheap loss.
  assert.match(ask, /Leans are not binding/)
  assert.match(ask, /even a rejection is cheap/)
  assert.ok(!ask.includes('no vote left to lose'), 'hammer clause is hammer-only')
})

test('evil leader with no evil aboard is told the revision is cheap', () => {
  const g = findGame(5, 'ff-clean', (game) => game.players[game.leaderSeat].alignment === 'evil')
  const good = seatsBy(g, 'good')
  driveToFinalize(g, [good[0], good[1]])

  const ask = finalizeAsk(g)
  assert.match(ask, /No evil you know of is on this team/)
  assert.match(ask, /That makes revising cheap for you/)
  assert.ok(!ask.includes('seats evil you know of'), 'no fold warning without evil aboard')
})

test('good leader gets no alignment note at finalize', () => {
  const g = findGame(5, 'ff-good', (game) => game.players[game.leaderSeat].alignment === 'good')
  const leader = g.leaderSeat
  const other = g.players.find((p) => p.seat !== leader)!.seat
  driveToFinalize(g, [leader, other])

  const ask = finalizeAsk(g)
  assert.match(ask, /Decide: stick with this team, or revise it ONCE/)
  assert.ok(!ask.includes('seats evil you know of'), 'no evil branch for good')
  assert.ok(!ask.includes('No evil you know of'), 'no evil branch for good')
  // Canary: "your side" only ever appears in the evil branches, so a future
  // evil clause added unconditionally reddens here instead of leaking.
  assert.ok(!ask.includes('your side'), 'evil-side framing must not reach a good leader')
})

test('an unseen Oberon on the team is never counted as evil the leader knows of', () => {
  const g = findGame(7, 'ff-oberon', (game) => {
    const l = game.players[game.leaderSeat]
    return l.alignment === 'evil' && l.role !== 'oberon' && game.players.some((p) => p.role === 'oberon')
  })
  const leader = g.leaderSeat
  const oberon = g.players.find((p) => p.role === 'oberon')!
  driveToFinalize(g, [leader, oberon.seat])

  const ask = finalizeAsk(g)
  const clause = knownEvilClause(ask)
  assert.ok(clause.includes(g.players[leader].name), 'the leader itself is counted')
  assert.ok(!clause.includes(oberon.name), 'Oberon is invisible to the rest of evil')
  // The note still admits an unseen teammate could exist, without asserting one.
  assert.ok(!ask.includes('No evil you know of is on this team'), 'the leader is aboard')
})

test('at the hammer the note drops the rejection framing: there is no vote to lose', () => {
  const g = findGame(5, 'ff-hammer', (game) => game.players[(game.leaderSeat + 4) % 5].alignment === 'evil')
  // Burn the four votable proposals so the fifth is the hammer.
  for (let i = 0; i < MAX_PROPOSALS - 1; i++) {
    const leader = g.leaderSeat
    driveToFinalize(g, [leader, (leader + 1) % 5])
    applyDecision(g, leader, { kind: 'finalize', stick: true })
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'reject' })
  }
  assert.equal(g.proposalNum, MAX_PROPOSALS)
  const leader = g.leaderSeat
  assert.equal(g.players[leader].alignment, 'evil')
  driveToFinalize(g, [leader, (leader + 1) % 5])

  const ask = finalizeAsk(g)
  assert.match(ask, /THIS IS THE HAMMER/)
  assert.match(ask, /no vote left to lose/)
  assert.ok(!ask.includes('Leans are not binding'), 'the vote-still-winnable framing is off at the hammer')
})
