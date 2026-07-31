// test-lane: exhaustive
// roleCertainties: what a seat can PROVE from the deal alone, before reading
// anyone's behaviour. These are the deductions bots were observed getting wrong
// in the other direction, assigning 65-80% confidence to propositions their own
// private knowledge already settled.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { roleCertainties } from '../server/agents/board.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import { legalCasts } from './casts.ts'
import type { Game, Role, Seat } from '../server/engine/types.ts'

const seatOf = (g: Game, role: Role): Seat => {
  const p = g.players.find((x) => x.role === role)
  assert.ok(p, `no ${role} in this deal`)
  return p.seat
}
const certFor = (g: Game, role: Role) => roleCertainties(viewFor(g, seatOf(g, role)))
const sorted = (xs: readonly string[]) => [...xs].sort()

// 5 players, standard cast: merlin, percival, servant, morgana, assassin.
// No Mordred and no Oberon, so BOTH private lists are complete and alignment is
// fully determined for the seats that hold one.
const std5 = () => createGame({ seed: 'certainty', playerCount: 5, roles: DEFAULT_ROLES[5] })

test('Merlin can place every seat, and knows the good seats exactly', () => {
  const g = std5()
  const c = certFor(g, 'merlin')
  assert.equal(c.alignmentComplete, true, 'no Mordred, so nothing is hidden from Merlin')
  assert.deepEqual(c.knownEvil.sort(), [seatOf(g, 'morgana'), seatOf(g, 'assassin')].sort())
  assert.deepEqual(c.knownGood.sort(), [seatOf(g, 'percival'), seatOf(g, 'servant')].sort())
  // Not merely "good": Merlin knows the pair holds Percival and Servant between
  // them, which is the role-level half of the deduction.
  for (const s of c.knownGood) {
    assert.deepEqual(sorted(c.seats[s].possibleRoles), ['percival', 'servant'])
  }
  for (const s of c.knownEvil) {
    assert.deepEqual(sorted(c.seats[s].possibleRoles), ['assassin', 'morgana'])
  }
})

test('Morgana pins her partner exactly and faces a 1-of-3 Merlin hunt', () => {
  const g = std5()
  const c = certFor(g, 'morgana')
  assert.equal(c.alignmentComplete, true, 'no Oberon, so the partner list is complete')
  // Evil roles in play are Morgana and Assassin, and she is the Morgana, so the
  // partner is not merely "evil", he is the Assassin.
  assert.deepEqual(c.seats[seatOf(g, 'assassin')].possibleRoles, ['assassin'])
  assert.equal(c.knownGood.length, 3)
  assert.deepEqual(c.merlinCandidates.sort(), c.knownGood.sort())
})

test('the Assassin knows his target is 1 of 3 from the deal', () => {
  const g = std5()
  const c = certFor(g, 'assassin')
  assert.deepEqual(c.seats[seatOf(g, 'morgana')].possibleRoles, ['morgana'])
  assert.equal(c.merlinCandidates.length, 3)
  assert.ok(c.merlinCandidates.includes(seatOf(g, 'merlin')), 'the real Merlin must be a candidate')
})

test('Percival deduces the composition of the two seats he cannot see', () => {
  const g = std5()
  const c = certFor(g, 'percival')
  const pair = [seatOf(g, 'merlin'), seatOf(g, 'morgana')].sort()
  assert.deepEqual(c.merlinCandidates.sort(), pair)
  // He cannot tell the pair apart, so his own alignment map stays open...
  assert.equal(c.alignmentComplete, false)
  // ...but the seats he is NOT looking at hold the Assassin and the Servant
  // between them, which the prompt never told him and he never played.
  const rest = g.players.map((p) => p.seat).filter((s) => !pair.includes(s) && s !== seatOf(g, 'percival'))
  assert.equal(rest.length, 2)
  for (const s of rest) {
    assert.deepEqual(sorted(c.seats[s].possibleRoles), ['assassin', 'servant'])
  }
})

test('a Servant with no private knowledge still knows a Merlin exists to protect', () => {
  const g = std5()
  const c = certFor(g, 'servant')
  assert.deepEqual(c.knownGood, [], 'a servant can prove nobody good')
  assert.deepEqual(c.knownEvil, [], 'a servant can prove nobody evil')
  // Only one Servant is dealt at 5 players and he is it, so Servant is ruled out
  // everywhere else: the other four seats hold Merlin, Percival, Morgana and the
  // Assassin in some order.
  const rest = g.players.map((p) => p.seat).filter((s) => s !== seatOf(g, 'servant'))
  for (const s of rest) {
    assert.deepEqual(sorted(c.seats[s].possibleRoles), ['assassin', 'merlin', 'morgana', 'percival'])
  }
  assert.equal(c.merlinCandidates.length, 4)
})

test('Mordred leaves Merlin exactly one gap, and names it', () => {
  const g = createGame({ seed: 'certainty-9', playerCount: 9, roles: DEFAULT_ROLES[9] })
  const c = certFor(g, 'merlin')
  assert.equal(c.alignmentComplete, false, 'Mordred is hidden, so one seat stays open')
  assert.ok(!c.knownEvil.includes(seatOf(g, 'mordred')), 'Merlin cannot see Mordred')
  // The gap is not vague. Every seat Merlin cannot place is good-or-Mordred, and
  // exactly one of them is Mordred.
  for (const s of c.unresolved) {
    assert.ok(
      c.seats[s].possibleRoles.includes('mordred'),
      `unresolved seat ${s} should be good-or-Mordred, got ${c.seats[s].possibleRoles.join(', ')}`,
    )
    assert.ok(c.seats[s].possibleRoles.every((r) => r === 'mordred' || r === 'percival' || r === 'servant'))
  }
})

test('Oberon leaves an evil seat one gap, and names it', () => {
  const g = createGame({ seed: 'certainty-7', playerCount: 7, roles: DEFAULT_ROLES[7] })
  const c = certFor(g, 'morgana')
  assert.equal(c.alignmentComplete, false, 'Oberon is invisible to his own side')
  assert.ok(!c.knownEvil.includes(seatOf(g, 'oberon')))
  for (const s of c.unresolved) {
    assert.ok(
      c.seats[s].possibleRoles.includes('oberon'),
      `unresolved seat ${s} should be good-or-Oberon, got ${c.seats[s].possibleRoles.join(', ')}`,
    )
  }
})

// ---- soundness over every legal cast ----
//
// The tests above pin SHARPNESS at hand-picked deals: that Percival works out
// the composition of the seats outside his pair, that a Servant learns a Merlin
// exists. Those are the deductions we care about being strong.
//
// This pins the opposite and more important property, over all 71 casts and
// every seat in each: the deduction may be INCOMPLETE, but it must never be
// WRONG. An elimination that removes a seat's actual role, or a knownGood entry
// that is really evil, would feed a false certainty straight into knowledgeText
// and out to the model as settled fact. Incompleteness costs play strength; a
// false certainty costs correctness, and only one of the two is recoverable.
//
// Hand-picked deals cannot establish this. That is the same gap the phantom-role
// audit had before it started enumerating.

test('roleCertainties is never wrong, for any seat in any legal cast', () => {
  const bad: string[] = []
  let checked = 0
  for (const cast of legalCasts()) {
    const g = createGame({ seed: `sound-${cast.label}`, playerCount: cast.playerCount, roles: [...cast.roles] })
    for (const me of g.players) {
      checked++
      const c = roleCertainties(viewFor(g, me.seat))
      const where = `${cast.label} seat ${me.seat} (${me.role})`

      // The array is documented as indexed by seat number, and prompts.ts and
      // these tests both rely on it. Pin it rather than trusting player order.
      for (const [i, s] of c.seats.entries()) {
        if (s.seat !== i) bad.push(`${where}: seats[${i}] carries seat ${s.seat}`)
      }
      // Never eliminate the truth: every seat's ACTUAL role must survive.
      for (const p of g.players) {
        const s = c.seats[p.seat]
        if (!s.possibleRoles.length) bad.push(`${where}: seat ${p.seat} has no possible role left`)
        else if (!s.possibleRoles.includes(p.role)) {
          bad.push(`${where}: seat ${p.seat} is ${p.role}, ruled out (left ${s.possibleRoles.join('/')})`)
        }
      }
      // Own seat is the one thing every role knows exactly.
      if (c.seats[me.seat].possibleRoles.join() !== me.role) {
        bad.push(`${where}: own seat not pinned (${c.seats[me.seat].possibleRoles.join('/')})`)
      }
      // A proven alignment must match the deal. This is the claim that reaches
      // the model as "every other seat is good: X, Y".
      for (const seat of c.knownGood) {
        if (g.players[seat].alignment !== 'good') bad.push(`${where}: claims seat ${seat} good, it is evil`)
      }
      for (const seat of c.knownEvil) {
        if (g.players[seat].alignment !== 'evil') bad.push(`${where}: claims seat ${seat} evil, it is good`)
      }
      // The real Merlin can never be excluded from the candidate pool, or the
      // Assassin is handed a shortlist that cannot contain the target.
      if (cast.roles.includes('merlin')) {
        const merlin = g.players.find((p) => p.role === 'merlin')!.seat
        if (!c.merlinCandidates.includes(merlin)) {
          bad.push(`${where}: merlinCandidates omits the real Merlin (seat ${merlin})`)
        }
      }
      // alignmentComplete has to agree with the per-seat verdicts it summarises.
      const anyOpen = c.seats.some((s) => s.alignment === null)
      if (c.alignmentComplete === anyOpen) {
        bad.push(`${where}: alignmentComplete=${c.alignmentComplete} but anyOpen=${anyOpen}`)
      }
    }
  }
  assert.ok(checked > 400, `expected the whole space, only checked ${checked} seats`)
  assert.deepEqual(bad.slice(0, 20), [], `unsound deductions:\n  ${bad.slice(0, 20).join('\n  ')}\n(${bad.length} total)`)
})

// ---- the record, folded in ----
//
// A failed quest is a cardinality constraint: N Fails means at least N of that
// team were evil. The dossier has printed that arithmetic since the start and no
// observed bot ever used it to ELIMINATE anything; one seat's closing model had
// every player on an observed failed quest reading good, which the quest itself
// refutes. These pin that the constraint now propagates, and that folding it in
// did not cost soundness, which is the risk: a deal-only deduction is checked by
// construction, while this one depends on the board.

test('a failed quest with one open seat left proves that seat evil', () => {
  // Merlin sees both evil, so on a team of three carrying one of them Merlin
  // already knows who failed. Percival is the interesting seat: he can place
  // nobody at the deal, and the record can still close a seat for him.
  const g = createGame({ seed: 'record', playerCount: 5, roles: DEFAULT_ROLES[5] })
  const percival = seatOf(g, 'percival'), servant = seatOf(g, 'servant')
  const morgana = seatOf(g, 'morgana')
  const before = roleCertainties(viewFor(g, percival))
  assert.deepEqual(before.knownEvil, [], 'the deal alone places nobody for Percival')

  // A failed 2-person quest carrying Percival himself: he knows he is good, so
  // the only seat aboard that can hold the Fail is the other one.
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [percival, morgana] })
  runTalk(g)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  applyDecision(g, percival, { kind: 'quest', card: 'success' })
  applyDecision(g, morgana, { kind: 'quest', card: 'fail' })

  const after = roleCertainties(viewFor(g, percival))
  assert.deepEqual(after.knownEvil, [morgana], 'the quest closes the seat the deal left open')
  const forced = after.fromRecord.find((f) => f.seat === morgana)
  assert.ok(forced, 'the Morgana must be reported as closed BY THE RECORD, not by the deal')
  assert.equal(forced.alignment, 'evil')
  assert.equal(forced.questNum, 1, 'must name the quest that forced it')
  // It cascades through the pair: knowing which candidate is Morgana settles the
  // other as Merlin, which is the whole game for Percival.
  assert.deepEqual(after.knownGood, [seatOf(g, 'merlin')])
  assert.deepEqual(after.seats[seatOf(g, 'merlin')].possibleRoles, ['merlin'])
  // And it stops where the evidence stops. The Assassin and the Servant sit
  // outside the pair and nothing has separated them, so neither is closed. An
  // over-eager budget rule would "prove" one of them here and be wrong half the
  // time, which costs more than the deduction is worth.
  for (const s of [seatOf(g, 'assassin'), servant]) {
    assert.equal(after.seats[s].alignment, null, `seat ${s} is not settled by this failure`)
  }
})

test('a failed quest with more candidates than Fails proves nothing', () => {
  // The unsound version of the same rule. Two seats could have played the one
  // Fail, so neither is settled, and a bot told otherwise would be told a lie.
  const g = createGame({ seed: 'record', playerCount: 5, roles: DEFAULT_ROLES[5] })
  const servant = seatOf(g, 'servant'), morgana = seatOf(g, 'morgana')
  const assassin = seatOf(g, 'assassin')
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [morgana, assassin] })
  runTalk(g)
  for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
  applyDecision(g, morgana, { kind: 'quest', card: 'fail' })
  applyDecision(g, assassin, { kind: 'quest', card: 'success' })

  const c = roleCertainties(viewFor(g, servant))
  assert.deepEqual(c.knownEvil, [], 'one Fail among two unplaced seats names neither')
  assert.deepEqual(c.fromRecord, [])
})

test('joint quest intersections can settle a seat no single quest names', () => {
  const roles: Role[] = [
    'servant', 'servant', 'servant', 'minion', 'minion',
  ]
  const g = createGame({ seed: 'record-joint', playerCount: 5, roles })
  const viewer = g.players.find((player) => player.role === 'servant')!.seat
  const [evilA, evilB] = g.players
    .filter((player) => player.alignment === 'evil')
    .map((player) => player.seat)
  const [goodC, settledGood] = g.players
    .filter((player) => player.alignment === 'good' && player.seat !== viewer)
    .map((player) => player.seat)
  const base = viewFor(g, viewer)
  const view = {
    ...base,
    quests: base.quests.map((quest) => {
      if (quest.num === 1) {
        return { ...quest, status: 'complete' as const, team: [evilA, evilB], result: 'fail' as const, failCount: 1 }
      }
      if (quest.num === 2) {
        return { ...quest, status: 'complete' as const, team: [evilA, goodC, viewer], result: 'fail' as const, failCount: 1 }
      }
      if (quest.num === 3) {
        return { ...quest, status: 'complete' as const, team: [evilB, goodC], result: 'fail' as const, failCount: 1 }
      }
      return quest
    }),
  }
  const certainty = roleCertainties(view)
  assert.ok(certainty.knownGood.includes(settledGood))
  assert.deepEqual(certainty.seats[settledGood].possibleRoles, ['servant'])
  const record = certainty.fromRecord.find(({ seat }) => seat === settledGood)
  assert.deepEqual(
    record,
    { seat: settledGood, alignment: 'good' },
    'the deduction uses the joint record, so no single quest is credited',
  )
})

test('a later redundant quest does not steal attribution for an earlier joint deduction', () => {
  const g = std5()
  const percival = seatOf(g, 'percival')
  const morgana = seatOf(g, 'morgana')
  const merlin = seatOf(g, 'merlin')
  const assassin = seatOf(g, 'assassin')
  const servant = seatOf(g, 'servant')
  const base = viewFor(g, percival)
  const quest = (
    num: number,
    team: Seat[],
  ) => ({ ...base.quests[num - 1], status: 'complete' as const, team, result: 'fail' as const, failCount: 1 })
  const afterTwo = {
    ...base,
    quests: [
      quest(1, [morgana, assassin]),
      quest(2, [percival, morgana, servant]),
      ...base.quests.slice(2),
    ],
  }
  const afterThree = {
    ...afterTwo,
    quests: [
      ...afterTwo.quests.slice(0, 2),
      quest(3, [morgana, merlin]),
      ...afterTwo.quests.slice(3),
    ],
  }

  const before = roleCertainties(afterTwo).fromRecord
  const after = roleCertainties(afterThree).fromRecord
  assert.deepEqual(
    before.find(({ seat }) => seat === morgana),
    { seat: morgana, alignment: 'evil' },
    'the first two quests settle Morgana jointly without crediting either one',
  )
  assert.deepEqual(
    after.find(({ seat }) => seat === morgana),
    { seat: morgana, alignment: 'evil' },
    'quest 3 merely confirms the existing conclusion and must not receive credit',
  )
})

function runTalk(g: Game): void {
  for (const d of expectedDecisions(g)) if (d.kind === 'pitch') applyDecision(g, g.leaderSeat, { kind: 'pitch', pitch: 'go' })
  while (g.phase === 'discussion') { const [d] = expectedDecisions(g); applyDecision(g, d.seat, { kind: 'discuss', say: '' }) }
  if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
}

test('folding the record in never makes a deduction wrong, in any legal cast', () => {
  // Same contract as the deal-only sweep above, over played-out boards: the
  // record can only ever ADD certainty, and every added certainty must be true.
  // Evil fails on a fixed schedule rather than at random, so a failure here
  // names one reproducible board instead of a seed nobody can rerun.
  const bad: string[] = []
  let boards = 0, forced = 0
  for (const cast of legalCasts()) {
    for (const bias of [1, 2, 3]) {
      const g = createGame({ seed: `rec-${cast.label}-${bias}`, playerCount: cast.playerCount, roles: [...cast.roles] })
      let step = 0, resolved = 0
      while (g.phase !== 'gameOver') {
        const [d] = expectedDecisions(g)
        if (!d) break
        step++
        if (d.kind === 'propose') {
          const size = g.quests[g.round - 1].teamSize
          const team = Array.from({ length: size }, (_, k) => (d.seat + k * bias) % cast.playerCount)
          applyDecision(g, d.seat, { kind: 'propose', team: [...new Set(team)].length === size ? team
            : Array.from({ length: size }, (_, k) => (d.seat + k) % cast.playerCount) })
        } else if (d.kind === 'pitch') applyDecision(g, d.seat, { kind: 'pitch', pitch: 'go' })
        else if (d.kind === 'discuss') applyDecision(g, d.seat, { kind: 'discuss', say: '' })
        else if (d.kind === 'finalize') applyDecision(g, d.seat, { kind: 'finalize', stick: true })
        else if (d.kind === 'vote') applyDecision(g, d.seat, { kind: 'vote', vote: 'approve' })
        else if (d.kind === 'quest') {
          const evil = g.players[d.seat].alignment === 'evil'
          applyDecision(g, d.seat, { kind: 'quest', card: evil && (step + bias) % 2 === 0 ? 'fail' : 'success' })
        } else if (d.kind === 'assassinate') {
          applyDecision(g, d.seat, { kind: 'assassinate', target: g.players.find((p) => p.alignment === 'good')!.seat })
        } else break

        const now = g.quests.filter((q) => q.result !== undefined).length
        if (now === resolved) continue
        resolved = now
        boards++
        for (const me of g.players) {
          const c = roleCertainties(viewFor(g, me.seat))
          const where = `${cast.label}/${bias} seat ${me.seat} (${me.role}) after ${resolved} quests`
          for (const p of g.players) {
            if (!c.seats[p.seat].possibleRoles.includes(p.role)) {
              bad.push(`${where}: seat ${p.seat} is ${p.role}, ruled out`)
            }
          }
          for (const s of c.knownGood) {
            if (g.players[s].alignment !== 'good') bad.push(`${where}: claims seat ${s} good, it is evil`)
          }
          for (const s of c.knownEvil) {
            if (g.players[s].alignment !== 'evil') bad.push(`${where}: claims seat ${s} evil, it is good`)
          }
          if (cast.roles.includes('merlin')) {
            const merlin = g.players.find((p) => p.role === 'merlin')!.seat
            if (!c.merlinCandidates.includes(merlin)) bad.push(`${where}: merlinCandidates omits the real Merlin`)
          }
          for (const f of c.fromRecord) {
            forced++
            if (g.players[f.seat].alignment !== f.alignment) {
              bad.push(`${where}: record claims seat ${f.seat} ${f.alignment}, it is ${g.players[f.seat].alignment}`)
            }
          }
        }
      }
    }
  }
  assert.ok(boards > 200, `expected a real sweep of resolved boards, got ${boards}`)
  // Without this the test passes trivially if the new rules never fire at all,
  // which is exactly how a propagation regresses to a no-op unnoticed.
  assert.ok(forced > 50, `the record closed only ${forced} seats; the rules are not firing`)
  assert.deepEqual(bad.slice(0, 20), [], `unsound after folding in the record:\n  ${bad.slice(0, 20).join('\n  ')}\n(${bad.length} total)`)
})
