// The heuristic's half of the forced-play tier (docs/design-bot-guidance.md §7).
// It is the forever-fallback every degraded LLM seat lands on, so a board
// condition it cannot see is one the prompts can no longer compensate for.
//
// The baseline these pin: 40 heuristic games at 7p produced 83 violations
// (~2/game), almost all on Q4 — the quest that needs two Fails at 7+. (The
// first measurement read 101; 18 of those were the detector flagging cards on
// quests that actually sank, fixed in forced.ts.) The
// three conditions below are the whole of it: what the pending quest requires,
// whose match point the board is on, and how many Fails this seat can actually
// account for aboard.
//
// Driven through real games and viewFor, never a hand-built PlayerView: a
// fixture that drifted from the engine would pin the wrong contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { evilPartnersOf } from '../server/engine/rules.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import type { Decision, DecisionRequest, Game, Seat } from '../server/engine/types.ts'

const NAMES = ['Ann', 'Bob', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus']

function findGame(playerCount: number, prefix: string, pred: (g: Game) => boolean): Game {
  for (let i = 0; i < 200; i++) {
    const g = createGame({
      seed: `${prefix}-${i}`,
      playerCount,
      names: NAMES.slice(0, playerCount),
      talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
    })
    if (pred(g)) return g
  }
  throw new Error(`no seed in 200 tries matched ${prefix}`)
}

const seatsOfRole = (g: Game, role: string): Seat[] =>
  g.players.filter((p) => p.role === role).map((p) => p.seat)

// The pair that can see each other at 7p; Oberon is invisible to both.
const pairSeats = (g: Game): Seat[] =>
  [...seatsOfRole(g, 'morgana'), ...seatsOfRole(g, 'assassin')]

const goodSeats = (g: Game): Seat[] =>
  g.players.filter((p) => p.alignment === 'good').map((p) => p.seat)

// Either side one quest from ending the quest phase.
const matchPointReached = (g: Game): boolean =>
  g.quests.filter((q) => q.result === 'success').length === 2 ||
  g.quests.filter((q) => q.result === 'fail').length === 2

// Run one quest to a chosen outcome, leaving the game at the next proposal.
function playQuest(g: Game, outcome: 'success' | 'fail'): void {
  const q = g.quests[g.round - 1]
  const evil = g.players.filter((p) => p.alignment === 'evil').map((p) => p.seat)
  const rest = g.players.map((p) => p.seat).filter((s) => !evil.includes(s))
  const team = outcome === 'fail'
    ? [...evil.slice(0, q.failsRequired), ...rest].slice(0, q.teamSize)
    : g.players.slice(0, q.teamSize).map((p) => p.seat)
  const round = g.round
  applyDecision(g, g.leaderSeat, { kind: 'propose', team })
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  for (const d of expectedDecisions(g)) {
    const fails = outcome === 'fail' && evil.includes(d.seat)
    applyDecision(g, d.seat, { kind: 'quest', card: fails ? 'fail' : 'success' })
  }
  assert.equal(g.quests[round - 1].result, outcome)
}

// Board at good's match point with Q4 pending: two clean quests, then one
// failed. At 7p that is the quest needing TWO Fails, so both forced rules that
// dominate the baseline are live at once.
function boardAtQ4MatchPoint(prefix: string, pred: (g: Game) => boolean = () => true): Game {
  const g = findGame(7, prefix, pred)
  playQuest(g, 'success')
  playQuest(g, 'success')
  playQuest(g, 'fail')
  assert.equal(g.round, 4)
  assert.equal(g.quests[3].failsRequired, 2)
  assert.equal(g.quests.filter((q) => q.result === 'success').length, 2)
  return g
}

// Put a specific team on the table (the leader proposes it) and stop at the vote.
function proposeTeam(g: Game, team: Seat[]): void {
  assert.equal(team.length, g.quests[g.round - 1].teamSize)
  applyDecision(g, g.leaderSeat, { kind: 'propose', team })
  assert.equal(g.phase, 'vote')
}

const decide = (g: Game, kind: DecisionRequest['kind'], seat: Seat): Decision =>
  heuristicDecide(
    { kind, seat, round: g.round, proposalNum: g.proposalNum },
    viewFor(g, seat), 'heuristic-forced',
  )

test('evil rejects the team that ends the game when it knows of no way to sink it', () => {
  const g = boardAtQ4MatchPoint('h-vote-reject')
  const [pairA] = pairSeats(g)
  const team = [pairA, ...goodSeats(g)].slice(0, g.quests[3].teamSize)
  proposeTeam(g, team)

  // One known evil aboard a quest that needs two: approving runs good's third
  // quest and leaves only the assassin's guess. The reject is the last lever.
  const d = decide(g, 'vote', pairA)
  assert.deepEqual(d, { kind: 'vote', vote: 'reject' })
})

test('evil still approves a match-point team its own side can sink', () => {
  const g = boardAtQ4MatchPoint('h-vote-approve')
  const pair = pairSeats(g)
  const team = [...pair, ...goodSeats(g)].slice(0, g.quests[3].teamSize)
  proposeTeam(g, team)

  // Two known Fails aboard: approval keeps the option, and whether the cards
  // actually get played is a later, secret decision.
  for (const seat of pair) {
    assert.deepEqual(decide(g, 'vote', seat), { kind: 'vote', vote: 'approve' },
      `seat ${seat} approves a team it can sink`)
  }
})

test('a lone evil does not burn a Fail on the two-Fail quest, even at match point', () => {
  const g = boardAtQ4MatchPoint('h-quest-lone')
  const [pairA] = pairSeats(g)
  const oberon = seatsOfRole(g, 'oberon')[0]
  const team = [pairA, ...goodSeats(g).filter((s) => s !== oberon)].slice(0, g.quests[3].teamSize)
  proposeTeam(g, team)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  assert.equal(g.phase, 'quest')

  // The card cannot sink a quest needing two and only advertises an evil. The
  // match point does not change that: it is dominated on every board.
  assert.deepEqual(decide(g, 'quest', pairA), { kind: 'quest', card: 'success' })
})

test('Oberon is exempt: it Fails the two-Fail quest it cannot coordinate on', () => {
  const g = boardAtQ4MatchPoint('h-quest-oberon')
  const oberon = seatsOfRole(g, 'oberon')[0]
  const team = [oberon, ...goodSeats(g)].slice(0, g.quests[3].teamSize)
  proposeTeam(g, team)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })

  // It cannot see a partner to split with, so "not enough of us aboard" is a
  // count it can never satisfy — and the extra card is how its unseen teammates
  // locate it.
  assert.deepEqual(decide(g, 'quest', oberon), { kind: 'quest', card: 'fail' })
})

test('a known pair both Fail the two-Fail quest on a decisive board', () => {
  const g = boardAtQ4MatchPoint('h-quest-pair')
  const pair = pairSeats(g)
  const team = [...pair, ...goodSeats(g)].slice(0, g.quests[3].teamSize)
  proposeTeam(g, team)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })

  // Two aboard, two required, and a success here ends the game: no cover left
  // to buy, and one card without the other sinks nothing.
  for (const seat of pair) {
    assert.deepEqual(decide(g, 'quest', seat), { kind: 'quest', card: 'fail' },
      `seat ${seat} plays its half of the pair`)
  }
})

test('the pair never doubles up on an undecided one-Fail quest', () => {
  // Where cover still has a price, a second card sinks nothing extra and shows
  // the table a two-evil team. Swept across seeds: a single seed could pass this
  // by rolling no Fail at all, which would prove nothing.
  let sawOne = false
  for (let i = 0; i < 20; i++) {
    const g = findGame(7, `h-quest-undecided-${i}`, () => true)
    playQuest(g, 'success')
    playQuest(g, 'fail')
    assert.equal(g.quests[2].failsRequired, 1)
    assert.ok(!matchPointReached(g), 'board is still undecided')

    const pair = pairSeats(g)
    const team = [...pair, ...goodSeats(g)].slice(0, g.quests[2].teamSize)
    proposeTeam(g, team)
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })

    const fails = pair.filter((s) => (decide(g, 'quest', s) as { card: string }).card === 'fail')
    assert.ok(fails.length <= 1, `seed ${i}: ${fails.length} Fails on a quest needing 1`)
    if (fails.length === 1) sawOne = true
  }
  assert.ok(sawOne, 'the sweep actually produced a Fail somewhere, so the cap means something')
})

test('on a decisive board both known evil spend a card, convention or not', () => {
  // 5p: Morgana and Assassin see each other and there is no Oberon. Two quests
  // failed, so the next Fail wins outright.
  const g = findGame(5, 'h-quest-decisive', () => true)
  playQuest(g, 'fail')
  playQuest(g, 'fail')
  assert.equal(g.quests[2].failsRequired, 1)

  const pair = pairSeats(g)
  const team = [...pair, ...goodSeats(g)].slice(0, g.quests[2].teamSize)
  proposeTeam(g, team)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })

  // The redundant card costs nothing once the game ends either way, and holding
  // it back bets the win on a partner whose card you cannot see. The detector
  // agrees: a Success here with enough Fails aboard is `win-point-success`.
  for (const seat of pair) {
    assert.deepEqual(decide(g, 'quest', seat), { kind: 'quest', card: 'fail' },
      `seat ${seat} does not leave the winning card to someone else`)
  }
})

test('an evil leader seats a partner on the quest that needs two Fails', () => {
  const g = boardAtQ4MatchPoint('h-propose-pair',
    (game) => game.players[(game.leaderSeat + 3) % 7].alignment === 'evil')
  // Three resolved quests rotate leadership three seats on; the deal was chosen
  // so that lands on evil.
  const leader = g.leaderSeat
  assert.equal(g.players[leader].alignment, 'evil')
  assert.notEqual(g.players[leader].role, 'oberon') // Oberon has no partner to seat

  const d = decide(g, 'propose', leader) as { kind: 'propose'; team: Seat[] }
  const partners = evilPartnersOf(viewFor(g, leader).privateInfo)
  const aboard = d.team.filter((s) => s === leader || partners.includes(s))
  // One Fail cannot sink this quest, so a team with only the leader on it is a
  // team its own side cannot fail — the propose-side of the same board read.
  assert.equal(aboard.length, 2, `leader seats itself plus a partner, got ${d.team.join(',')}`)
})

test('the one-evil-per-team default still holds on the quests that need one Fail', () => {
  const g = findGame(7, 'h-propose-solo', (game) => {
    const l = game.players[game.leaderSeat]
    return l.alignment === 'evil' && l.role !== 'oberon'
  })
  const leader = g.leaderSeat
  const d = decide(g, 'propose', leader) as { kind: 'propose'; team: Seat[] }
  const partners = evilPartnersOf(viewFor(g, leader).privateInfo)
  assert.equal(d.team.filter((s) => partners.includes(s)).length, 0,
    'no visible pair on a quest one card can sink')
})
