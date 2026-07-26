import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROLES, EVIL_COUNT, ROLE_ALIGNMENT, TEAM_SIZES,
  failsRequired, validateRoles,
} from '../server/engine/rules.ts'

test('team size tables match the rules reference', () => {
  assert.deepEqual(TEAM_SIZES[5], [2, 3, 2, 3, 3])
  assert.deepEqual(TEAM_SIZES[6], [2, 3, 4, 3, 4])
  assert.deepEqual(TEAM_SIZES[7], [2, 3, 3, 4, 4])
  for (const n of [8, 9, 10]) assert.deepEqual(TEAM_SIZES[n], [3, 4, 4, 5, 5])
})

test('evil counts match the rules reference', () => {
  assert.deepEqual(EVIL_COUNT, { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 })
})

test('only quest 4 at 7+ players needs two fails', () => {
  for (let players = 5; players <= 10; players++) {
    for (let q = 1; q <= 5; q++) {
      const expected = players >= 7 && q === 4 ? 2 : 1
      assert.equal(failsRequired(players, q), expected, `players=${players} q=${q}`)
    }
  }
})

test('default role sets are internally consistent', () => {
  for (let n = 5; n <= 10; n++) {
    const roles = DEFAULT_ROLES[n]
    assert.equal(roles.length, n)
    validateRoles(n, roles) // throws on inconsistency
    const evil = roles.filter((r) => ROLE_ALIGNMENT[r] === 'evil').length
    assert.equal(evil, EVIL_COUNT[n])
    assert.ok(roles.includes('merlin') && roles.includes('assassin'))
  }
})

test('validateRoles rejects bad sets', () => {
  assert.throws(() => validateRoles(5, ['merlin', 'percival', 'servant', 'servant', 'assassin']))
  assert.throws(() => validateRoles(5, ['merlin', 'percival', 'servant', 'morgana', 'minion'])) // merlin w/o assassin
  assert.throws(() => validateRoles(5, ['servant', 'servant', 'servant', 'morgana', 'assassin'])) // assassin w/o merlin
  assert.throws(() => validateRoles(6, DEFAULT_ROLES[5]))
})

// The dependency lattice (ROLE_REQUIRES). These casts are legal by seat count and
// alignment split, so nothing else in validateRoles catches them: each seats a
// role whose whole function is to act on a role that is not at the table, which
// then reaches the prompt layer as guidance describing somebody who is absent.
test('validateRoles rejects roles whose dependency is absent', () => {
  // Morgana with no Percival to mislead: mechanically just a Minion.
  assert.throws(
    () => validateRoles(5, ['merlin', 'servant', 'servant', 'morgana', 'assassin']),
    /morgana requires percival/,
  )
  // Percival with no Merlin to find.
  assert.throws(
    () => validateRoles(5, ['percival', 'servant', 'servant', 'mordred', 'minion']),
    /percival requires merlin/,
  )
  // Mordred with nobody to hide from.
  assert.throws(
    () => validateRoles(5, ['servant', 'servant', 'servant', 'mordred', 'minion']),
    /mordred requires merlin/,
  )
})

test('a broken dependency chain names the root cause', () => {
  // Percival AND Morgana with no Merlin breaks two edges at once. The reported
  // one must be the upstream fix, not the nearest.
  assert.throws(
    () => validateRoles(5, ['percival', 'servant', 'servant', 'morgana', 'minion']),
    /percival requires merlin/,
  )
})

test('validateRoles still accepts casts the lattice permits', () => {
  // Vanilla: no specials at all, so no edge fires.
  assert.doesNotThrow(() => validateRoles(5, ['servant', 'servant', 'servant', 'minion', 'minion']))
  // Merlin & Assassin only, the beginner preset.
  assert.doesNotThrow(() => validateRoles(5, ['merlin', 'servant', 'servant', 'assassin', 'minion']))
  // Oberon has no engine edge: his guidance never names another role, so an
  // Oberon at a Merlin-less table is coherent even though the picker won't offer it.
  assert.doesNotThrow(() => validateRoles(5, ['servant', 'servant', 'servant', 'oberon', 'minion']))
})
