// The facts dossier: computed public signals fed to LLM prompts. Pure, API-free.
// The load-bearing test is the LEAK check — the dossier must contain only
// public-derivable facts, never roles/alignment/private knowledge.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import { factsDossier } from '../server/agents/facts.ts'
import type { PlayerView, ProposalRecord, Quest, Seat } from '../server/engine/types.ts'

// Minimal synthetic view — only the fields the dossier reads.
function view(over: Partial<PlayerView>): PlayerView {
  return {
    seat: 0, name: 'P0', role: 'servant', alignment: 'good', privateInfo: {},
    playerCount: 5, rolesInPlay: [], players: Array.from({ length: 5 }, (_, s) => ({ seat: s, name: `P${s}` })),
    phase: 'vote', round: 2, proposalNum: 1, leaderSeat: 0,
    quests: [], proposals: [], transcript: [], events: [],
    ...over,
  } as PlayerView
}

const quest = (num: number, teamSize: number, over: Partial<Quest>): Quest =>
  ({ num, teamSize, failsRequired: 1, ...over })

const proposal = (over: Partial<ProposalRecord>): ProposalRecord =>
  ({ round: 1, proposalNum: 1, leader: 0, team: [], approved: true, ...over }) as ProposalRecord

test('dossier is empty before anything resolves', () => {
  assert.equal(factsDossier(view({ quests: [quest(1, 2, {}), quest(2, 3, {})] })), '')
})

test('AVALON_NO_DOSSIER=1 suppresses the dossier (the eval A/B lever)', () => {
  const withData = view({ quests: [quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 })] })
  assert.notEqual(factsDossier(withData), '') // on by default
  const prev = process.env.AVALON_NO_DOSSIER
  process.env.AVALON_NO_DOSSIER = '1'
  try {
    assert.equal(factsDossier(withData), '')
  } finally {
    if (prev === undefined) delete process.env.AVALON_NO_DOSSIER
    else process.env.AVALON_NO_DOSSIER = prev
  }
})

// Board stakes. The score and what the pending quest would produce are
// derivable by everyone and derived by nobody: the `quest` ASK's match-point
// override was the only place a bot counted the board, so leaders proposed
// clean teams and voters approved them at match point. Stated as consequence
// only — which outcome a seat wants is policy, so the same rows serve both sides.
const ROLES = ['merlin', 'percival', 'servant', 'morgana', 'assassin']

// good 2, evil 0, Q3 pending, Q4 needs two fails. `over` shifts the board.
const board = (over: Partial<PlayerView> = {}, quests?: Quest[]) => factsDossier(view({
  round: 3,
  rolesInPlay: ROLES,
  quests: quests ?? [
    quest(1, 2, { team: [0, 1], result: 'success', failCount: 0 }),
    quest(2, 3, { team: [0, 1, 2], result: 'success', failCount: 0 }),
    quest(3, 3, {}),
    quest(4, 4, { failsRequired: 2 }),
    quest(5, 4, {}),
  ],
  ...over,
}))

test('board stakes lead the dossier with the score and the remaining runway', () => {
  const lines = board().split('\n')
  assert.match(lines[1], /^Board state/, 'the board frames the player rows that follow')
  assert.match(lines[2], /Score: good 2 of 3 successes \| evil 0 of 3 fails/)
  assert.match(lines[2], /quests after this one: Q4, Q5/)
  assert.match(lines[3], /Q3\(size 3\) is pending/)
})

test('board stakes spell out what each outcome of the pending quest produces', () => {
  // Good at match point: a success ends the quest phase and hands the game to
  // the Assassin's shot; a fail is merely evil's first.
  assert.match(board(), /if it SUCCEEDS: good's 3rd success, which ends the quest phase/)
  assert.match(board(), /Assassin's single shot at Merlin becomes the whole game/)
  assert.match(board(), /if it FAILS: evil 1 of 3, needing 2 more/)

  // Evil at match point: the mirror. Two failed quests behind us, Q3 pending.
  const evilMatchPoint = board({}, [
    quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 }),
    quest(2, 3, { team: [0, 1, 2], result: 'fail', failCount: 1 }),
    quest(3, 3, {}),
    quest(4, 4, { failsRequired: 2 }),
    quest(5, 4, {}),
  ])
  assert.match(evilMatchPoint, /if it FAILS: evil's 3rd failed quest, which ends the game for evil at once/)
  assert.match(evilMatchPoint, /if it SUCCEEDS: good 1 of 3, needing 2 more/)
})

test('board stakes carry the two-fail requirement and the last-quest runway', () => {
  // Q5 pending with both sides at 2: no runway left, and either outcome ends it.
  const last = board({ round: 5 }, [
    quest(1, 2, { team: [0, 1], result: 'success', failCount: 0 }),
    quest(2, 3, { team: [0, 1, 2], result: 'fail', failCount: 1 }),
    quest(3, 3, { team: [0, 1, 2], result: 'success', failCount: 0 }),
    quest(4, 4, { team: [0, 1, 2, 3], result: 'fail', failCount: 2, failsRequired: 2 }),
    quest(5, 4, { failsRequired: 2 }),
  ])
  assert.match(last, /none after this one, it is the last quest on the board/)
  assert.match(last, /Q5\(size 4, needs 2 fails\) is pending/)
  assert.match(last, /good's 3rd success/)
  assert.match(last, /evil's 3rd failed quest/)
})

test('with no assassin-and-Merlin pair, good\'s third success ends the game outright', () => {
  // Role sets are configurable and validateRoles requires neither role, so the
  // consequence has to be read off rolesInPlay, not assumed from the default deal.
  const noShot = board({ rolesInPlay: ['servant', 'servant', 'servant', 'morgana', 'minion'] })
  assert.match(noShot, /ends the quest phase and the game, with no assassination to follow/)
  assert.doesNotMatch(noShot, /Assassin/)
})

test('once the quest phase is over the board drops the pending-quest row', () => {
  // Three successes: `round` stops advancing, so quests[round-1] is already
  // resolved. The assassin decides on this board and no quest remains.
  const done = board({ round: 3 }, [
    quest(1, 2, { team: [0, 1], result: 'success', failCount: 0 }),
    quest(2, 3, { team: [0, 1, 2], result: 'success', failCount: 0 }),
    quest(3, 3, { team: [0, 1, 2], result: 'success', failCount: 0 }),
    quest(4, 4, { failsRequired: 2 }),
    quest(5, 4, {}),
  ])
  assert.match(done, /Board state: the score, with the quest phase over\./)
  assert.match(done, /Score: good 3 of 3 successes \| evil 0 of 3 fails \| no quest remains to be played\./)
  assert.doesNotMatch(done, /is pending/)
  assert.doesNotMatch(done, /quests after this one/, 'Q4 and Q5 will never be played')
})

test('dossier reports on-team membership and never-on-quest from resolved quests', () => {
  const d = factsDossier(view({
    quests: [
      quest(1, 2, { team: [0, 3], result: 'fail', failCount: 1 }),
      quest(2, 2, { team: [3, 4], result: 'success', failCount: 0 }),
    ],
  }))
  assert.match(d, /P0\(seat 0\) \| on-team: Q1\(FAIL\)/)
  assert.match(d, /P3\(seat 3\) \| on-team: Q1\(FAIL\), Q2\(ok\)/)
  // never-on-quest players now render "on-team: none" in their own row.
  assert.match(d, /P1\(seat 1\) \| on-team: none/)
  assert.match(d, /P2\(seat 2\) \| on-team: none/)
})

test('per-player row transposes votes on played teams (the anti-confabulation lookup)', () => {
  const d = factsDossier(view({
    quests: [
      quest(1, 2, { team: [1, 2], result: 'fail', failCount: 1 }),
      quest(2, 2, { team: [3, 4], result: 'success', failCount: 0 }),
    ],
    proposals: [
      // Q1 team [1,2] is approved 3–2 and fails; seat 2 is ON the team yet votes REJECT.
      proposal({ round: 1, leader: 1, team: [1, 2], approved: true,
        votes: [
          { seat: 0, vote: 'reject' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'reject' },
          { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' },
        ] }),
      // Q2 team [3,4] is approved unanimously and succeeds.
      proposal({ round: 2, leader: 3, team: [3, 4], approved: true,
        votes: [
          { seat: 0, vote: 'approve' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'approve' },
          { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' },
        ] }),
    ],
  }))
  // seat 0 (never on a team): rejected the team that FAILED, approved the one that
  // SUCCEEDED — both votes readable as one per-player row, keyed to each quest.
  assert.match(d, /P0\(seat 0\) \| on-team: none \| voted: Q1 reject→FAIL, Q2 approve→ok/)
  // seat 2 was PLACED ON the failed Q1 team but voted REJECT against it — exactly
  // the case the table confabulated. Membership and vote sit as distinct facts.
  assert.match(d, /P2\(seat 2\) \| on-team: Q1\(FAIL\) \| voted: Q1 reject→FAIL, Q2 approve→ok/)
})

test('dossier computes vote/lead signals only for approved resolved proposals', () => {
  const d = factsDossier(view({
    quests: [quest(1, 2, { team: [1, 2], result: 'fail', failCount: 1 })],
    proposals: [
      // seat 3 led this failed team and seat 4 approved it while off it.
      proposal({ round: 1, leader: 3, team: [1, 2], approved: true,
        votes: [
          { seat: 0, vote: 'reject' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'approve' },
          { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' },
        ] }),
    ],
  }))
  assert.match(d, /P3\(seat 3\)[^\n]*signals: led 1 failed quest/)
  assert.match(d, /P4\(seat 4\)[^\n]*signals: approved 1 failed team it was not on/)
  // seat 1/2 were ON the team, so they get membership, not an off-team-approval signal.
  assert.doesNotMatch(d, /P1\(seat 1\)[^\n]*approved \d+ failed team/)
})

test('dossier surfaces the deciding seat\'s own contradicted positions', () => {
  const d = factsDossier(view({
    seat: 0,
    quests: [
      quest(1, 2, { team: [1, 2], result: 'fail', failCount: 1 }),
      quest(2, 2, { team: [3, 4], result: 'success', failCount: 0 }),
    ],
    proposals: [
      proposal({ round: 1, leader: 1, team: [1, 2], approved: true,
        votes: [{ seat: 0, vote: 'approve' }, { seat: 1, vote: 'approve' }, { seat: 2, vote: 'approve' }, { seat: 3, vote: 'reject' }, { seat: 4, vote: 'reject' }] }),
      proposal({ round: 2, leader: 3, team: [3, 4], approved: true,
        votes: [{ seat: 0, vote: 'reject' }, { seat: 1, vote: 'reject' }, { seat: 2, vote: 'approve' }, { seat: 3, vote: 'approve' }, { seat: 4, vote: 'approve' }] }),
    ],
  }))
  assert.match(d, /You APPROVED the Q1 team \[P1\/P2\] → it FAILED\./)
  assert.match(d, /You REJECTED the Q2 team \[P3\/P4\] → it SUCCEEDED\./)
})

test('hammer proximity appears only when the runway is short', () => {
  const q = [quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 })]
  assert.doesNotMatch(factsDossier(view({ quests: q, proposalNum: 2 })), /Hammer proximity/)
  assert.match(factsDossier(view({ quests: q, proposalNum: 3 })), /up to 2 more proposals can be rejected/)
  assert.match(factsDossier(view({ quests: q, proposalNum: 4 })), /up to 1 more proposal can be rejected/)
  assert.doesNotMatch(factsDossier(view({ quests: q, proposalNum: 5 })), /Hammer proximity/) // it IS the hammer
})

// The invariant: NO hidden information. Play real games and assert the dossier
// for every seat never names another player's role/alignment or private data.
test('dossier leaks no hidden information across a full game, every seat', async () => {
  for (const seed of ['facts-a', 'facts-b', 'facts-c']) {
    const game = createGame({ seed, playerCount: 7, talk: { maxRounds: 0, maxRoundsAfterChange: 0 } })
    const agents = new Map<Seat, ReturnType<typeof heuristicAgent>>()
    function heuristicAgent(seat: Seat) {
      return { async decide(req: any, v: PlayerView) {
        // Check the dossier at every decision point for every deciding seat.
        const d = factsDossier(v)
        for (const p of game.players) {
          if (p.seat === v.seat) continue
          // The dossier must never assert another player's secret role/alignment.
          assert.doesNotMatch(d, new RegExp(`${p.name}\\(seat ${p.seat}\\)[^\\n]*\\b(MERLIN|MORGANA|ASSASSIN|MORDRED|OBERON|MINION|PERCIVAL|evil|good)\\b`, 'i'),
            `seat ${v.seat} dossier leaked role/alignment of seat ${p.seat} (${seed})`)
        }
        return heuristicDecide(req, v, seed)
      } }
    }
    for (const p of game.players) agents.set(p.seat, heuristicAgent(p.seat))
    await runGame({ game, agents })
  }
})

// Quest evidence: the deduction three of four models got wrong in the
// 2026-07-25 mid-tier benchmark, where a success was read as CLEARING its team.
test('quest evidence states the fail-count floor and refuses to clear a team', () => {
  const d = factsDossier(view({
    round: 5,
    quests: [
      quest(1, 2, { team: [0, 1], result: 'success', failCount: 0 }),
      quest(2, 4, { team: [0, 1, 2, 3], result: 'fail', failCount: 3 }),
      quest(3, 3, { team: [1, 2, 3], result: 'fail', failCount: 1 }),
    ],
  }))
  // The decisive arithmetic: 3 Fails on a 4-person team pins 3 of those 4.
  assert.match(d, /3 Fail cards, so at least 3 of these 4 are evil/)
  // Singular reads naturally, and the floor holds at one.
  assert.match(d, /1 Fail card, so at least 1 of these 3 are evil/)
  // Card identity is NOT flagged here: that clause was removed once measurement
  // showed the behaviour it targeted was one model's habit (7.1% of qwen
  // utterances, 0.0% elsewhere) rather than a shared gap. Pinned so it does not
  // drift back in without cross-model evidence.
  assert.doesNotMatch(d, /NOT public/)
  // A success clears nobody.
  assert.match(d, /proves nothing about these players: evil may play Success/)
})

test('quest evidence is data, not instruction', () => {
  const d = factsDossier(view({
    quests: [quest(1, 2, { team: [0, 1], result: 'fail', failCount: 1 })],
  }))
  // The facts layer carries observations; what to DO about them is agent policy
  // (design-bot-guidance.md §6.1). Guard the boundary this section is closest to
  // crossing, since "at least N are evil" is one short step from "so reject them".
  for (const imperative of [/\bso reject\b/i, /\bdo not approve\b/i, /\byou should\b/i, /\bavoid\b/i]) {
    assert.doesNotMatch(d, imperative)
  }
})

// failCount is optional on Quest and a failed quest always had at least one
// Fail, so a missing count is absent data, not a real zero. Printing "at least
// 0 of these 4 are evil" would be vacuous in the one section that exists to be
// decisive.
test('a failed quest with no recorded fail count still asserts a floor of one', () => {
  const d = factsDossier(view({
    quests: [quest(1, 4, { team: [0, 1, 2, 3], result: 'fail' })], // no failCount
  }))
  assert.match(d, /at least one of these 4 is evil/)
  assert.doesNotMatch(d, /at least 0/)
})
