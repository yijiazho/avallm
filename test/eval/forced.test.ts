// test-lane: fast
// Forced-play detection: the deterministic tier of the playbook
// (docs/design-bot-guidance.md §7), measured from artifacts and never enforced.
// The two headline cases are real misses read out of a live LLM game by hand
// (seed norms2) — the whole point of the metric is that nobody should have to
// read a transcript to find them again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forcedPlayViolations } from '../../server/eval/forced.ts'
import { computeMetrics } from '../../server/eval/metrics.ts'
import type { GameArtifact } from '../../server/eval/artifact.ts'
import type { GameEvent, Role, Seat } from '../../server/engine/types.ts'

type Ev = Omit<GameEvent, 'seq' | 'visibility'> & { visibility?: GameEvent['visibility'] }
const mkLog = (events: Ev[]): GameEvent[] =>
  events.map((e, seq) => ({ seq, visibility: 'public', ...e }))

const proposal = (leader: Seat, team: Seat[], round = 1): Ev =>
  ({ type: 'proposal', payload: { round, proposalNum: 1, leader, team } })

const voteReveal = (team: Seat[], votes: Record<number, 'approve' | 'reject'>, round: number): Ev =>
  ({ type: 'voteReveal', payload: {
    round, proposalNum: 1, team, approved: true,
    votes: Object.entries(votes).map(([s, vote]) => ({ seat: Number(s), vote })),
  } })

const card = (seat: Seat, c: 'success' | 'fail'): Ev =>
  ({ type: 'questCard', payload: { seat, card: c }, visibility: { only: [seat] } })

const questResult = (round: number, failCount: number, failsRequired = 1): Ev =>
  ({ type: 'questResult', payload: {
    round, failCount, failsRequired,
    result: failCount >= failsRequired ? 'fail' : 'success',
  } })

// A 7p deal so Q4 needs two Fails and Oberon exists: seats 4=morgana,
// 5=assassin, 6=oberon. Morgana and the assassin see each other, neither sees
// Oberon, and Oberon sees nobody.
const ROLES_7P: Role[] = ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon']

function artifact(log: GameEvent[], roles: Role[] = ROLES_7P): GameArtifact {
  return {
    schema: 3, id: 'g', seed: 's', createdAt: '2026-07-25T00:00:00.000Z',
    playerCount: roles.length, roles: [...roles],
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
    players: roles.map((role, seat) => ({
      seat: seat as Seat, name: `P${seat}`, role,
      alignment: role === 'morgana' || role === 'assassin' || role === 'oberon' ? 'evil' : 'good',
      agent: `llm:m${seat}`,
    })),
    winner: 'good', winReason: 'threeQuests', steps: 0, degraded: [], log,
  }
}

// Two clean quests: good sits at 2 of 3, so quest 3 is match point.
const twoCleanQuests: Ev[] = [
  proposal(0, [0, 1], 1),
  voteReveal([0, 1], { 0: 'approve', 1: 'approve' }, 1),
  card(0, 'success'), card(1, 'success'),
  questResult(1, 0),
  proposal(1, [0, 1, 2], 2),
  voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 2: 'approve' }, 2),
  card(0, 'success'), card(1, 'success'), card(2, 'success'),
  questResult(2, 0),
]

test('playing Success at good\'s match point is a forced-play violation', () => {
  // Morgana (4) is on the quest that would give good its third, one Fail sinks
  // it, and it plays Success. This is the bug the quest ASK's match-point
  // override exists for; the metric is how we notice it recurring.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(4, [0, 1, 4], 3),
    voteReveal([0, 1, 4], { 0: 'approve', 1: 'approve', 4: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(4, 'success'),
    questResult(3, 0),
  ])))
  const mp = v.filter((x) => x.rule === 'match-point-success')
  assert.equal(mp.length, 1)
  assert.equal(mp[0].seat, 4)
  assert.equal(mp[0].role, 'morgana')
  assert.equal(mp[0].round, 3)
  assert.match(mp[0].detail, /needed 1 Fail, knew of 1 aboard/)
})

test('passing up evil\'s winning third fail is a violation', () => {
  const v = forcedPlayViolations(artifact(mkLog([
    proposal(4, [0, 4], 1),
    voteReveal([0, 4], { 0: 'approve', 4: 'approve' }, 1),
    card(0, 'success'), card(4, 'fail'),
    questResult(1, 1),
    proposal(5, [0, 5], 2),
    voteReveal([0, 5], { 0: 'approve', 5: 'approve' }, 2),
    card(0, 'success'), card(5, 'fail'),
    questResult(2, 1),
    // Evil at 2 fails: a Fail here wins outright, and the assassin declines it.
    proposal(5, [0, 5], 3),
    voteReveal([0, 5], { 0: 'approve', 5: 'approve' }, 3),
    card(0, 'success'), card(5, 'success'),
    questResult(3, 0),
  ])))
  const wp = v.filter((x) => x.rule === 'win-point-success')
  assert.equal(wp.length, 1)
  assert.equal(wp[0].seat, 5)
  assert.match(wp[0].detail, /passed up evil's winning third fail/)
})

test('a lone Fail on the two-Fail quest is flagged as wasted, but not for Oberon', () => {
  // Q4 at 7p needs two Fails. Morgana fails it alone (knowing its partner is
  // not aboard): the card cannot sink the quest and only advertises an evil.
  const wasted = forcedPlayViolations(artifact(mkLog([
    proposal(4, [0, 1, 2, 4], 4),
    voteReveal([0, 1, 2, 4], { 0: 'approve', 4: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(2, 'success'), card(4, 'fail'),
    questResult(4, 1, 2),
  ])))
  assert.deepEqual(wasted.map((x) => [x.seat, x.rule]), [[4, 'wasted-lone-fail']])

  // Oberon does the same thing and is exempt: its role guidance is to Fail every
  // quest it reaches, since it cannot see a partner to coordinate with.
  const oberon = forcedPlayViolations(artifact(mkLog([
    proposal(6, [0, 1, 2, 6], 4),
    voteReveal([0, 1, 2, 6], { 0: 'approve', 6: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(2, 'success'), card(6, 'fail'),
    questResult(4, 1, 2),
  ])))
  assert.deepEqual(oberon, [])
})

test('two evil aboard the two-Fail quest: failing together is clean, so nothing is flagged', () => {
  const v = forcedPlayViolations(artifact(mkLog([
    proposal(4, [0, 1, 4, 5], 4),
    voteReveal([0, 1, 4, 5], { 0: 'approve', 4: 'approve', 5: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(4, 'fail'), card(5, 'fail'),
    questResult(4, 2, 2),
  ])))
  assert.deepEqual(v, [])
})

test('rejecting the team its own side could sink, with the game on the line, is flagged', () => {
  // The live miss: on the two-Fail quest with BOTH known evil aboard — evil's
  // winning team — both of them voted reject.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 4),
    voteReveal([0, 1, 4, 5], {
      0: 'approve', 1: 'approve', 2: 'approve', 3: 'approve',
      4: 'reject', 5: 'reject', 6: 'reject',
    }, 4),
    card(0, 'success'), card(1, 'success'), card(4, 'success'), card(5, 'success'),
    questResult(4, 0, 2),
  ])))
  const rejects = v.filter((x) => x.rule === 'vote-reject-sinkable')
  assert.deepEqual(rejects.map((x) => x.seat).sort(), [4, 5])
  assert.match(rejects[0].detail, /needed 2 Fails, knew of 2 aboard/)
  // Oberon rejected too, but it knows of nobody aboard, so it is not flagged.
  assert.ok(!rejects.some((x) => x.seat === 6))
})

test('approving a team it cannot fail at good\'s match point is flagged', () => {
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 2], 3),
    voteReveal([0, 1, 2], {
      0: 'approve', 1: 'approve', 2: 'reject', 3: 'reject',
      4: 'approve', 5: 'reject', 6: 'approve',
    }, 3),
    card(0, 'success'), card(1, 'success'), card(2, 'success'),
    questResult(3, 0),
  ])))
  const approvals = v.filter((x) => x.rule === 'vote-approve-unsinkable')
  // Morgana (4) and Oberon (6) approved the quest that ended the game, and with
  // exactly four approves each of them carried it: a reject from either would
  // have stopped it. The assassin (5) rejected and is clean. Nobody evil was
  // aboard, so no quest-card rule fires.
  assert.deepEqual(approvals.map((x) => x.seat).sort(), [4, 6])
  assert.ok(!v.some((x) => x.rule === 'match-point-success'))
})

test('a quest that sank is never a declined Fail, so coordinated cover is clean', () => {
  // Two evil on a decisive one-Fail quest: one Fails, the other covers with
  // Success — exactly what EVIL_SHARED asks for, since a double Fail exposes
  // both and sinks nothing extra. The quest FAILED, so good's third never
  // happened and nothing was declined. An outcome-blind rule flagged the
  // coverer here and its own detail line contradicted the artifact.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(4, [0, 4, 5], 3),
    voteReveal([0, 4, 5], { 0: 'approve', 4: 'approve', 5: 'approve' }, 3),
    card(0, 'success'), card(5, 'fail'), card(4, 'success'),
    questResult(3, 1),
  ])))
  assert.deepEqual(v, [])
})

test('an unseen Oberon\'s second Fail makes the partner\'s card needed, not wasted', () => {
  // Q4 needs two Fails. Morgana knows of only itself aboard and Fails anyway;
  // the Oberon it cannot see also Fails, so the quest sinks and evil banks the
  // point. The card was one of the two required.
  const v = forcedPlayViolations(artifact(mkLog([
    proposal(4, [0, 1, 4, 6], 4),
    voteReveal([0, 1, 4, 6], { 0: 'approve', 4: 'approve', 6: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(4, 'fail'), card(6, 'fail'),
    questResult(4, 2, 2),
  ])))
  assert.deepEqual(v, [])
})

test('the vote detail records whether the proposal survived the vote', () => {
  // Rejecting your own winning team costs the quest when the table rejects it
  // too, and costs only the tell when the team passes anyway. Same violation,
  // different consequence, and a reader comparing agents needs to tell them
  // apart. Three other seats approved, so either evil approve would have been
  // the fourth and carried it.
  const killed = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 4),
    { type: 'voteReveal', payload: {
      round: 4, proposalNum: 1, team: [0, 1, 4, 5], approved: false,
      votes: [
        { seat: 0, vote: 'approve' }, { seat: 1, vote: 'approve' },
        { seat: 2, vote: 'approve' },
        { seat: 4, vote: 'reject' }, { seat: 5, vote: 'reject' },
      ],
    } },
  ])))
  assert.equal(killed.length, 2)
  assert.match(killed[0].detail, /the proposal was rejected/)
})

test('nothing is flagged on an undecided board, and good is never flagged', () => {
  // Q1: evil aboard plays Success for cover, and evil voters approve a clean
  // team. Both are legitimate defaults, not forced plays.
  const v = forcedPlayViolations(artifact(mkLog([
    proposal(4, [0, 4], 1),
    voteReveal([0, 4], { 0: 'approve', 4: 'approve', 5: 'reject', 6: 'approve' }, 1),
    card(0, 'success'), card(4, 'success'),
    questResult(1, 0),
  ])))
  assert.deepEqual(v, [])
})

test('metrics carry the violations per seat and in full', () => {
  const a = artifact(mkLog([
    ...twoCleanQuests,
    proposal(4, [0, 1, 4], 3),
    voteReveal([0, 1, 4], { 0: 'approve', 1: 'approve', 4: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(4, 'success'),
    questResult(3, 0),
  ]))
  const m = computeMetrics(a)
  assert.equal(m.forcedPlays.length, 1)
  assert.equal(m.seats[4].forcedPlayViolations, 1)
  assert.equal(m.seats[0].forcedPlayViolations, 0)
  // Ground truth, so it must not depend on the judge having run.
  assert.equal(m.judge, undefined)
})

test('a partial log with no quest cards yields nothing to judge', () => {
  // Human seats and redacted corpora can lack questCard events; the detector
  // must stay silent rather than guess.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(4, [0, 1, 4], 3),
    voteReveal([0, 1, 4], { 0: 'approve', 1: 'approve', 4: 'approve' }, 3),
    questResult(3, 0),
  ])))
  assert.ok(!v.some((x) => x.rule === 'match-point-success'))
})

// A vote is only forced when the alternative would actually have delivered
// something: rejecting a sinkable team only costs the sink if approving would
// have produced a passing team. That is read off the revealed tally, which is
// hindsight relative to the voter and deliberately so — the guard used to run
// off declared leans, and nothing bound a seat to the lean it declared, so evil
// could suppress a true blunder call by declaring a reject it never cast.
//
// These pin the case a live game exposed: a Morgana was flagged for rejecting a
// team her side could sink, on a board where the approve she "should" have cast
// could not have saved it.

// Seven players, so a majority is four.
test('an evil reject is not forced when approving could not have passed the team', () => {
  // Morgana (4) rejects a team she and the assassin (5) could sink at good's
  // match point. Only one other seat approved, so her approve would have made
  // it two of the four needed: the team dies either way and she loses no sink.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 3),
    voteReveal([0, 1, 4, 5], {
      0: 'reject', 1: 'reject', 2: 'reject', 3: 'reject',
      4: 'reject', 5: 'approve', 6: 'reject',
    }, 3),
  ])))
  assert.ok(!v.some((x) => x.rule === 'vote-reject-sinkable' && x.seat === 4))
})

test('the same reject IS forced when her approve would have carried the team', () => {
  // Three other approves, so seat 4's approve would have been the fourth and
  // passed a team her side could sink. Rejecting threw the quest away.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 3),
    voteReveal([0, 1, 4, 5], {
      0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject',
      4: 'reject', 5: 'reject', 6: 'reject',
    }, 3),
  ])))
  assert.ok(v.some((x) => x.rule === 'vote-reject-sinkable' && x.seat === 4))
})

test('a reject on a team the table approved anyway is still counted', () => {
  // Four other approves carried it without her, so the sink was on offer and she
  // voted against taking it. The vote changed no outcome; it was still the wrong
  // vote, and the detail records which way it landed.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 3),
    voteReveal([0, 1, 4, 5], {
      0: 'approve', 1: 'approve', 2: 'approve', 3: 'approve',
      4: 'reject', 5: 'reject', 6: 'reject',
    }, 3),
  ])))
  const hit = v.find((x) => x.rule === 'vote-reject-sinkable' && x.seat === 4)
  assert.ok(hit)
  assert.match(hit.detail, /approved anyway/)
})

test('the rule judges the post-revision roster, not the team first proposed', () => {
  // Seat 1 is swapped out for seat 2, and 4/5 stay aboard, so the revised team
  // is still sinkable and seat 4's reject is still the wrong vote.
  const v = forcedPlayViolations(artifact(mkLog([
    ...twoCleanQuests,
    proposal(0, [0, 1, 4, 5], 3),
    { type: 'proposalRevised', payload: { round: 3, proposalNum: 1, leader: 0, from: [0, 1, 4, 5], to: [0, 2, 4, 5], reason: 'swap' } },
    voteReveal([0, 2, 4, 5], {
      0: 'approve', 1: 'approve', 2: 'approve', 3: 'reject',
      4: 'reject', 5: 'reject', 6: 'reject',
    }, 3),
  ])))
  assert.ok(v.some((x) => x.rule === 'vote-reject-sinkable' && x.seat === 4))
})

// The propose rule (§7.2 "Be on the team you lead at good's match point"). An
// evil leader picks the roster outright, so a team with no Fail it knows of ends
// the quest phase by construction, and there is no cover left worth buying.
const proposeViolations = (events: Ev[]) =>
  forcedPlayViolations(artifact(mkLog(events))).filter((x) => x.rule === 'propose-unsinkable')

test('an evil leader who seats no Fail at good\'s match point is a violation', () => {
  const events: Ev[] = [
    ...twoCleanQuests,
    // Morgana leads the quest that decides the game and picks three good players.
    proposal(4, [0, 1, 2], 3),
    voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 4: 'reject', 5: 'reject' }, 3),
    card(0, 'success'), card(1, 'success'), card(2, 'success'),
    questResult(3, 0),
  ]
  const v = proposeViolations(events)
  assert.equal(v.length, 1)
  assert.equal(v[0].seat, 4)
  // Points at the PROPOSAL, not at the quest result where it is detected, since
  // the proposal is the decision being graded.
  assert.equal(v[0].seq, events.findIndex((e) => e.type === 'proposal' && e.payload.round === 3))
})

test('an evil leader who seats itself at match point is clean on the propose rule', () => {
  assert.deepEqual(proposeViolations([
    ...twoCleanQuests,
    proposal(4, [0, 1, 4], 3),
    voteReveal([0, 1, 4], { 0: 'approve', 1: 'approve', 4: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(4, 'success'),
    questResult(3, 0),
  ]), [])
})

test('seating a PARTNER counts: the leader need not be aboard itself', () => {
  // The catalogue phrases this as "be on the team you lead", but what is forced
  // is a Fail the leader can count on, and a visible partner is one. Grading the
  // literal phrasing would flag a perfectly good pick.
  assert.deepEqual(proposeViolations([
    ...twoCleanQuests,
    proposal(4, [0, 1, 5], 3),
    voteReveal([0, 1, 5], { 0: 'approve', 1: 'approve', 4: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(5, 'success'),
    questResult(3, 0),
  ]), [])
})

test('a good leader at match point is never a propose violation', () => {
  assert.deepEqual(proposeViolations([
    ...twoCleanQuests,
    proposal(0, [0, 1, 2], 3),
    voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 2: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(2, 'success'),
    questResult(3, 0),
  ]), [])
})

test('an evil leader away from match point is not forced to seat a Fail', () => {
  // Only quest 1 has resolved, so good is not one success from ending it and
  // slow-playing for cover is a legitimate T2 default.
  assert.deepEqual(proposeViolations([
    proposal(0, [0, 1], 1),
    voteReveal([0, 1], { 0: 'approve', 1: 'approve' }, 1),
    card(0, 'success'), card(1, 'success'),
    questResult(1, 0),
    proposal(4, [0, 1, 2], 2),
    voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 4: 'approve' }, 2),
    card(0, 'success'), card(1, 'success'), card(2, 'success'),
    questResult(2, 0),
  ]), [])
})

test('no violation when no sinkable team could have been built', () => {
  // Quest 4 at 7 players needs TWO Fails, and Oberon sees no partner, so the
  // most he could ever seat is himself. There is no forced play to miss, and
  // recording one would grade him against knowledge the deal denies him.
  assert.deepEqual(proposeViolations([
    ...twoCleanQuests,
    proposal(0, [0, 1, 2], 3),
    voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 2: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(2, 'fail'),
    questResult(3, 1),
    proposal(6, [0, 1, 2, 6], 4),
    voteReveal([0, 1, 2, 6], { 0: 'approve', 1: 'approve', 6: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(2, 'success'), card(6, 'success'),
    questResult(4, 0, 2),
  ]), [])
})

test('but a leader who COULD have seated two Fails on a two-Fail quest is flagged', () => {
  // Same board, Morgana leading: she can see the assassin, so a sinkable roster
  // was available to her and she named neither seat.
  const v = proposeViolations([
    ...twoCleanQuests,
    proposal(0, [0, 1, 2], 3),
    voteReveal([0, 1, 2], { 0: 'approve', 1: 'approve', 2: 'approve' }, 3),
    card(0, 'success'), card(1, 'success'), card(2, 'fail'),
    questResult(3, 1),
    proposal(4, [0, 1, 2, 4], 4),
    voteReveal([0, 1, 2, 4], { 0: 'approve', 1: 'approve', 4: 'approve' }, 4),
    card(0, 'success'), card(1, 'success'), card(2, 'success'), card(4, 'success'),
    questResult(4, 0, 2),
  ])
  assert.equal(v.length, 1)
  assert.equal(v[0].seat, 4)
})
