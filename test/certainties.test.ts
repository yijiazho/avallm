// roleCertainties: what a seat can PROVE from the deal alone, before reading
// anyone's behaviour. These are the deductions bots were observed getting wrong
// in the other direction, assigning 65-80% confidence to propositions their own
// private knowledge already settled.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
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
