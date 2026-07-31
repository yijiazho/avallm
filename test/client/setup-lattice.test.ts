// test-lane: fast
// The role dependency lattice lives in client/src/setup.ts (the picker), but the
// picker is UI convenience, not authority: the server re-validates every role
// list. These tests pin both halves and, more importantly, the agreement between
// them, since a picker that offers a cast the engine rejects is a setup screen
// that can only ever 400 (server.ts's lobby route).
//
// setup.ts is pure data plus one function (no React, no DOM), so it imports
// straight into node:test.

import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, buildRoles, type SpecialSelection } from '../../client/src/setup.ts'
import { validateRoles } from '../../server/engine/rules.ts'
import type { Role } from '../../server/engine/types.ts'

const COUNTS = [5, 6, 7, 8, 9]

const NONE: SpecialSelection = {
  merlinPair: false, percival: false, morgana: false, mordred: false, oberon: false,
}
const sel = (over: Partial<SpecialSelection>): SpecialSelection => ({ ...NONE, ...over })

test('every preset builds a cast the engine accepts', () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const n of COUNTS) {
      const built = buildRoles(n, preset.pick(n))
      assert.equal(built.error, null, `${id} @ ${n}: ${built.error}`)
      assert.ok(built.roles, `${id} @ ${n} produced no roles`)
      // The real contract: the picker never offers what the server refuses.
      assert.doesNotThrow(
        () => validateRoles(n, built.roles as Role[]),
        `${id} @ ${n} built a cast validateRoles rejects: ${built.roles?.join(', ')}`,
      )
    }
  }
})

// The presets are three points in a space the user can move around freely, so
// checking only them leaves most of the picker untested. This is the actual
// contract, over EVERY toggle combination: the picker may be stricter than the
// engine (it forbids a Merlin-less Oberon, a product call), but it must never be
// looser, because a looser picker offers setups that can only ever 400.
test('no toggle combination offers a cast the engine would reject', () => {
  const flags: (keyof SpecialSelection)[] = ['merlinPair', 'percival', 'morgana', 'mordred', 'oberon']
  let built = 0
  for (const n of COUNTS) {
    for (let mask = 0; mask < (1 << flags.length); mask++) {
      const sel = { ...NONE }
      flags.forEach((f, i) => { sel[f] = Boolean(mask & (1 << i)) })
      const b = buildRoles(n, sel)
      if (!b.roles) continue // refused by the picker, which is its right
      built++
      assert.doesNotThrow(
        () => validateRoles(n, b.roles as Role[]),
        `${n}p ${flags.filter((f) => sel[f]).join('+') || 'vanilla'} builds a cast validateRoles rejects: ${b.roles.join(', ')}`,
      )
    }
  }
  // Guard against a refactor that makes buildRoles refuse everything, which
  // would leave the assertion above vacuously true.
  assert.ok(built > 40, `expected the picker to build a real range of casts, got ${built}`)
})

test('a vanilla cast (no specials) is legal at every count', () => {
  for (const n of COUNTS) {
    const built = buildRoles(n, NONE)
    assert.equal(built.error, null, `vanilla @ ${n}: ${built.error}`)
    assert.doesNotThrow(() => validateRoles(n, built.roles as Role[]))
    assert.ok(!built.roles?.includes('merlin'), 'vanilla must not seat Merlin')
  }
})

// One case per edge. Each of these roles is defined by acting on another role,
// so seating it alone is incoherent rather than merely weak.
test('Morgana requires Percival', () => {
  const built = buildRoles(7, sel({ merlinPair: true, morgana: true }))
  assert.equal(built.roles, null)
  assert.match(built.error ?? '', /Morgana needs Percival/)
})

test('Percival requires Merlin', () => {
  const built = buildRoles(7, sel({ percival: true }))
  assert.equal(built.roles, null)
  assert.match(built.error ?? '', /Percival needs Merlin/)
})

test('Mordred requires Merlin', () => {
  const built = buildRoles(7, sel({ mordred: true }))
  assert.equal(built.roles, null)
  assert.match(built.error ?? '', /Mordred needs Merlin/)
})

// Transitivity: Morgana states only its Percival edge, so a Morgana selected
// with neither Percival nor Merlin must still be refused, and the message must
// name the ROOT cause the user has to fix first rather than the nearest edge.
test('a broken chain reports the root requirement, not the nearest one', () => {
  const built = buildRoles(7, sel({ percival: true, morgana: true }))
  assert.equal(built.roles, null)
  assert.match(built.error ?? '', /Percival needs Merlin/)
})

test('Morgana with no Merlin anywhere in the chain is still refused', () => {
  const built = buildRoles(7, sel({ morgana: true }))
  assert.equal(built.roles, null)
  assert.ok(built.error, 'expected an error for Morgana with no Percival and no Merlin')
})

// The 5p rulebook caution is a WARNING, not an edge: Percival without a decoy is
// legal (his candidate list collapses to Merlin alone), just good-favoured.
test('Percival without a decoy warns at 5 players but still builds', () => {
  const built = buildRoles(5, sel({ merlinPair: true, percival: true }))
  assert.equal(built.error, null)
  assert.ok(built.roles)
  assert.match(built.warning ?? '', /too strong/)
})
