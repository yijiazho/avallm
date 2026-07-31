// test-lane: contract
// The role knowledge matrix (research doc §3.3), asserted through viewFor —
// the exact surface agents and clients consume.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { evilPartnersOf, knownEvilOf, merlinCandidatesOf } from '../server/engine/knowledge.ts'
import { viewFor } from '../server/engine/view.ts'
import type { Game, Player, Seat } from '../server/engine/types.ts'

const sorted = (xs: readonly Seat[]) => xs.slice().sort((a, b) => a - b)
const seatsWhere = (g: Game, pred: (p: Player) => boolean) =>
  sorted(g.players.filter(pred).map((p) => p.seat))

test('knowledge matrix holds for every role, player count, and seed', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let s = 0; s < 20; s++) {
      const g = createGame({ seed: `km-${playerCount}-${s}`, playerCount })
      const evil = seatsWhere(g, (p) => p.alignment === 'evil')

      for (const me of g.players) {
        const view = viewFor(g, me.seat)
        const info = view.privateInfo
        const ctx = `players=${playerCount} seed=${s} seat=${me.seat} role=${me.role}`

        // The discriminant IS the "exactly one shape" guarantee: asserting the
        // kind rules out the other two fields, which no longer exist on the
        // variant, so the old "other field is undefined" checks are now static.
        if (me.role === 'merlin') {
          const expected = seatsWhere(g, (p) => p.alignment === 'evil' && p.role !== 'mordred')
          assert.equal(info.kind, 'merlin', ctx)
          assert.deepEqual(sorted([...knownEvilOf(info)]), expected, `merlin sees evil minus mordred: ${ctx}`)
        } else if (me.role === 'percival') {
          const expected = seatsWhere(g, (p) => p.role === 'merlin' || p.role === 'morgana')
          assert.equal(info.kind, 'percival', ctx)
          assert.deepEqual(sorted([...merlinCandidatesOf(info)]), expected, `percival pair: ${ctx}`)
        } else if (me.role === 'oberon' || me.alignment === 'good') {
          // Oberon and Servants learn nothing.
          assert.deepEqual(info, { kind: 'none' }, `no knowledge: ${ctx}`)
        } else {
          // Evil (non-Oberon): fellow evil, minus Oberon, minus self.
          const expected = seatsWhere(
            g, (p) => p.alignment === 'evil' && p.role !== 'oberon' && p.seat !== me.seat,
          )
          assert.equal(info.kind, 'evil', ctx)
          assert.deepEqual(sorted([...evilPartnersOf(info)]), expected, `evil partners: ${ctx}`)
          assert.ok(!evilPartnersOf(info).includes(me.seat), ctx)
        }

        // Sanity: nobody's private info names a good player as evil.
        for (const s2 of [...knownEvilOf(info), ...evilPartnersOf(info)]) {
          assert.ok(evil.includes(s2), `${ctx}: seat ${s2} flagged evil but is good`)
        }
      }
    }
  }
})
