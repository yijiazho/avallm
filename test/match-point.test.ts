// Match point: one quest from a side winning the quest phase. The dossier's
// board-stakes rows state that to every seat as data (facts.test.ts); these are
// the two decisions that can still act on it — who goes on the team, and whether
// the team runs. The motivating game (seed norms2): a Morgana leader proposed a
// zero-evil team at good's match point, and three evil players then approved the
// quest that ended the game, with the board sitting in their prompts all along.
import { test } from 'node:test'
import { mutable } from './support/mutable.ts'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { asCompletedQuest, resolveQuest } from './support/quests.ts'
import { viewFor } from '../server/engine/view.ts'
import { evilPartnersOf } from '../server/engine/rules.ts'
import { buildMessages } from '../server/agents/prompts.ts'
import type { Game, Seat } from '../server/engine/types.ts'

// Eight, because the two-Fail quest exists at 8p too (and there without an Oberon).
const NAMES = ['Ann', 'Bob', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal']

// No table talk: a proposal goes straight to the vote, which is all these tests
// need and keeps the board-driving loop short.
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

// Leadership rotates once per resolved quest when nothing is rejected, so the
// seat leading after `n` clean quests is predictable at deal time.
const leaderAfter = (g: Game, n: number): Seat =>
  ((g.leaderSeat + n) % g.config.playerCount) as Seat

// Run one quest to unanimous approval, leaving the game at the next proposal.
// A 'fail' outcome seats enough evil to meet failsRequired and has them fail;
// a 'success' needs no role forcing, since evil may play Success too.
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
  assert.equal(asCompletedQuest(g.quests[round - 1]).result, outcome)
}

const playCleanQuests = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) playQuest(g, 'success')
}

const askFor = (g: Game, kind: 'propose' | 'vote', seat: Seat): string =>
  buildMessages(kind, viewFor(g, seat), '')[1].content

const seatsBy = (g: Game, alignment: 'good' | 'evil'): Seat[] =>
  g.players.filter((p) => p.alignment === alignment).map((p) => p.seat)

test('an evil leader at good match point is told this is the last team it will pick', () => {
  const g = findGame(7, 'mp-evil', (game) => game.players[leaderAfter(game, 2)].alignment === 'evil')
  playCleanQuests(g, 2)
  assert.equal(g.phase, 'proposal')

  const ask = askFor(g, 'propose', g.leaderSeat)
  assert.match(ask, /the last team you will ever pick/)
  assert.match(ask, /cannot be failed, and no later round exists to recover in/)
  assert.match(ask, /Put yourself on it/)
  // The normal-round advice is REPLACED, not stacked: "usually one evil" is what
  // read as permission to sit this one out.
  assert.ok(!ask.includes('usually want exactly ONE evil'), 'normal-round framing is gone at match point')
})

test('an evil leader at EVIL\'s match point is told a Fail here wins it', () => {
  // The mirror board the one-Fail quests were missing. Two failed quests banked,
  // Q3 pending and needing a single Fail: the plain "usually ONE evil — you"
  // default does seat the leader, but it says so as routine team-building, and a
  // leader under table pressure was the whole reason the good-match-point arm
  // exists. At 5p and 6p no two-Fail quest exists at all, so without this arm
  // evil's match point never got its stakes named.
  const g = findGame(7, 'mp-evilmp', (game) => {
    const l = game.players[leaderAfter(game, 2)]
    return l.alignment === 'evil'
  })
  playQuest(g, 'fail')
  playQuest(g, 'fail')
  assert.equal(g.round, 3)
  assert.equal(g.quests[2].failsRequired, 1, 'Q3 at 7p sinks on one Fail')

  const ask = askFor(g, 'propose', g.leaderSeat)
  assert.match(ask, /third failed quest and wins the game outright/)
  assert.match(ask, /put yourself on it/)
  assert.ok(!ask.includes('usually want exactly ONE evil'), 'the routine default is replaced')
  assert.ok(!ask.includes('last team you will ever pick'), "that is good's match point, not this one")
})

test('a good leader at good match point is steered off testing unknowns', () => {
  const g = findGame(7, 'mp-good', (game) => game.players[leaderAfter(game, 2)].alignment === 'good')
  playCleanQuests(g, 2)

  const ask = askFor(g, 'propose', g.leaderSeat)
  // The regression guard: seeing the board, bots started arguing "we have a
  // cushion, so test an unknown here" — over their own Merlin's objection.
  assert.match(ask, /most likely to succeed, not the most informative one/)
  assert.match(ask, /no future quest left to be vetted on/)
  assert.ok(!ask.includes('best objective records'), 'normal-round framing is replaced')
})

test('before match point both alignments get the normal-round proposal advice', () => {
  const g = findGame(7, 'mp-early', () => true)
  playCleanQuests(g, 1) // good at 1 of 3: nothing is decided yet
  const ask = askFor(g, 'propose', g.leaderSeat)
  const evil = g.players[g.leaderSeat].alignment === 'evil'
  assert.match(ask, evil ? /usually want exactly ONE evil/ : /best objective records/)
  assert.ok(!ask.includes('the last team you will ever pick'))
  assert.ok(!ask.includes('most likely to succeed, not the most informative'))
})

test('at good match point an evil voter is told approving a team it cannot fail ends the game', () => {
  const g = findGame(7, 'mp-vote', (game) => game.players[leaderAfter(game, 2)].alignment === 'good')
  playCleanQuests(g, 2)
  // An all-good team: no evil voter knows of anyone aboard who could Fail it.
  const good = seatsBy(g, 'good')
  const size = g.quests[g.round - 1].teamSize
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: good.slice(0, size) })
  assert.equal(g.phase, 'vote')

  const evilOffTeam = seatsBy(g, 'evil')[0]
  const ask = askFor(g, 'vote', evilOffTeam)
  assert.match(ask, /A success here is good's third quest/)
  assert.match(ask, /reject is the last lever your side has/)
  assert.match(ask, /have a reason you can say out loud/)

  // Good players never see it, at any board.
  assert.ok(!askFor(g, 'vote', good[0]).includes('last lever your side has'))
})

test('an evil voter on a team its side can sink is told to approve it', () => {
  const g = findGame(7, 'mp-aboard', (game) => {
    const l = game.players[leaderAfter(game, 2)]
    // A leader with a visible partner, so it can seat one and still be evil itself.
    return l.alignment === 'evil' && l.role !== 'oberon'
  })
  playCleanQuests(g, 2)
  const leader = g.leaderSeat
  const size = g.quests[g.round - 1].teamSize
  assert.equal(g.quests[g.round - 1].failsRequired, 1, 'Q3 at 7p sinks on one Fail')
  applyDecision(g, leader, { kind: 'propose', team: [leader, ...seatsBy(g, 'good')].slice(0, size) })

  // The motivating miss: both evil rejected the team that carried their own
  // Fails. Approving keeps the option; the card is a later, secret decision.
  const ask = askFor(g, 'vote', leader)
  assert.match(ask, /Your side already holds this quest/)
  assert.match(ask, /an opportunity, not a threat, so approve it/)
  assert.ok(!ask.includes('last lever your side has'), 'the reject branch is mutually exclusive')
  // Its partner reads the same team the same way.
  const partner = evilPartnersOf(viewFor(g, leader).privateInfo)[0]
  if (partner !== undefined) {
    assert.match(askFor(g, 'vote', partner), /Your side already holds this quest/)
  }
})

test('one Fail aboard a two-Fail quest cannot sink it, so match point still says reject', () => {
  // The distinction the first cut of this branch missed: it stood down on "any
  // evil aboard", but a lone teammate on the big quest sinks nothing, so from
  // this voter's view that team is as unstoppable as a clean one.
  const g = findGame(7, 'mp-twofail', (game) => {
    const l = game.players[leaderAfter(game, 3)]
    return l.alignment === 'evil' && l.role !== 'oberon'
  })
  // Board: good 2, evil 1, Q4 pending and needing two Fails. Good is at match
  // point, so the reject lever is live.
  playQuest(g, 'success')
  playQuest(g, 'success')
  playQuest(g, 'fail')
  assert.equal(g.round, 4)
  const q4 = g.quests[3]
  assert.equal(q4.failsRequired, 2, 'Q4 at 7p needs two Fails')

  const leader = g.leaderSeat
  assert.equal(g.players[leader].alignment, 'evil')
  applyDecision(g, leader, { kind: 'propose', team: [leader, ...seatsBy(g, 'good')].slice(0, q4.teamSize) })

  const ask = askFor(g, 'vote', leader)
  assert.match(ask, /needs 2 Fails to fail and you know of only 1 aboard/)
  assert.match(ask, /reject is the last lever your side has/)
  assert.ok(!ask.includes('already holds this quest'), 'one Fail does not hold a two-Fail quest')
})

test('an unseen Oberon aboard does not suppress the note, and is never named by it', () => {
  const g = findGame(7, 'mp-oberon', (game) => {
    const l = game.players[leaderAfter(game, 2)]
    return l.alignment === 'good' && game.players.some((p) => p.role === 'oberon')
  })
  playCleanQuests(g, 2)
  const oberon = g.players.find((p) => p.role === 'oberon')!
  const size = g.quests[g.round - 1].teamSize
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [oberon.seat, ...seatsBy(g, 'good')].slice(0, size) })

  // Oberon IS aboard and can fail it, but the rest of evil cannot see that, so
  // the note still fires for them — anything else would leak the deal.
  const otherEvil = seatsBy(g, 'evil').find((s) => s !== oberon.seat)!
  const ask = askFor(g, 'vote', otherEvil)
  assert.match(ask, /reject is the last lever your side has/)
  assert.match(ask, /unless a teammate you cannot see is aboard/, 'it admits the possibility')
  const clause = ask.slice(ask.indexOf("A success here is good's third quest"))
  assert.ok(!clause.includes(oberon.name), 'the note never names the Oberon it cannot see')
})

test('evil match point (two failed quests) leaves the vote note off', () => {
  // The note is about good ending the game, not about evil being close: with two
  // fails banked, approving a clean team costs evil nothing decisive.
  const g = findGame(7, 'mp-mirror', () => true)
  playCleanQuests(g, 1)
  const v = viewFor(g, seatsBy(g, 'evil')[0])
  // Hand-set the board to 0 successes / 2 fails on the seat's own view.
  mutable(v).quests[0] = resolveQuest(v.quests[0], { result: 'fail', failCount: 1 })
  mutable(v).quests[1] = resolveQuest(v.quests[1], { result: 'fail', failCount: 1 })
  const [, user] = buildMessages('vote', v, '')
  assert.ok(!user.content.includes('last lever your side has'))
})

// ---- the two-Fail quest (quest 4 at 7+ players) ----
//
// The propose-side sibling of the same miss: with only one evil aboard, a quest
// that needs two Fails is lost at proposal time and no card played later can
// recover it. The old text carried this as a trailing clause on the one-evil
// default ("put a second evil on only when the quest needs two Fails"), which is
// advice about some other round. What is measured is the rule, not this wording:
// the heuristic agent (which reads no prompt at all) had no two-Fail rule at any
// decision and sank 1 of 32 of these quests, against 14 of 32 once it got one.

// Three resolved quests put the board on quest 4, which at 7p needs two Fails.
// Reaching it always means one side sits on two, so a match point is implied.
function boardAtQ4(prefix: string, pred: (g: Game) => boolean): Game {
  const g = findGame(7, prefix, pred)
  playCleanQuests(g, 2)
  playQuest(g, 'fail')
  assert.equal(g.round, 4)
  assert.equal(g.quests[3].failsRequired, 2)
  return g
}

test('the two-Fail quest orders the leader to seat a partner, not one evil', () => {
  const g = boardAtQ4('q4-pair', (game) => {
    const l = game.players[leaderAfter(game, 3)]
    return l.alignment === 'evil' && l.role !== 'oberon'
  })
  const ask = askFor(g, 'propose', g.leaderSeat)

  assert.match(ask, /needs TWO Fails to fail, so one of you on it sinks nothing/)
  assert.match(ask, /put yourself AND a partner you can see on this team/)
  // The Oberon reasoning a bot reaches for on its own ("maybe one is aboard, so
  // my lone Fail is fine") is answered rather than left open — it is exactly the
  // coin flip the fallback agent was accidentally living on.
  assert.match(ask, /a Fail you cannot back up is a coin flip, not a plan/)
  // Replaced, not qualified: the soft version is the escape hatch.
  assert.ok(!ask.includes('usually want exactly ONE evil'), 'the one-evil default is gone here')
})

test('the two-Fail quest states whichever match point the board is on', () => {
  const evilLeads = (game: Game) => {
    const l = game.players[leaderAfter(game, 3)]
    return l.alignment === 'evil' && l.role !== 'oberon'
  }
  // 2 successes + 1 fail: good is one quest from ending the phase.
  const atGood = boardAtQ4('q4-stakes-good', evilLeads)
  assert.match(askFor(atGood, 'propose', atGood.leaderSeat),
    /this is the last team you will ever pick/)

  // 1 success + 2 fails: a fail here wins outright, which takes both of them.
  const atEvil = findGame(7, 'q4-stakes-evil', evilLeads)
  playCleanQuests(atEvil, 1)
  playQuest(atEvil, 'fail')
  playQuest(atEvil, 'fail')
  assert.equal(atEvil.round, 4)
  assert.match(askFor(atEvil, 'propose', atEvil.leaderSeat),
    /failing it wins the game outright, which is exactly why it takes two of you/)
})

test('an Oberon leader is not told to seat a partner it cannot see', () => {
  const g = boardAtQ4('q4-oberon', (game) => game.players[leaderAfter(game, 3)].role === 'oberon')
  const ask = askFor(g, 'propose', g.leaderSeat)

  // It has no partner in its view, so the order would be unfollowable. For
  // Oberon this is the normal round it always plays.
  assert.ok(!ask.includes('put yourself AND a partner'), 'no impossible instruction')
  assert.match(ask, /usually want exactly ONE evil|last team you will ever pick/)
})

test('the unseen-teammate warning only fires at tables that deal an Oberon', () => {
  // 8p has a two-Fail quest 4 as well, but Morgana/Assassin/Minion all see each
  // other: there is no invisible partner to hope for, so raising one is noise.
  const g = findGame(8, 'q4-no-oberon', (game) => {
    const l = game.players[leaderAfter(game, 3)]
    return l.alignment === 'evil'
  })
  playCleanQuests(g, 2)
  playQuest(g, 'fail')
  assert.equal(g.quests[3].failsRequired, 2)
  assert.ok(!g.players.some((p) => p.role === 'oberon'))

  const ask = askFor(g, 'propose', g.leaderSeat)
  assert.match(ask, /put yourself AND a partner you can see on this team/)
  assert.ok(!ask.includes('Oberon'), 'no Oberon caveat at a table without one')
})
