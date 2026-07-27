import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import {
  ARCHITECTURE_BANK,
  ARCHITECTURE_BANK_ID,
  STANDARD_ROLES,
  validateArchitectureBank,
} from '../server/eval/architecture-bank.ts'

test('architecture bank covers 5-10 players and every standard role', () => {
  assert.doesNotThrow(() => validateArchitectureBank())
  assert.deepEqual(
    [...new Set(ARCHITECTURE_BANK.map((c) => c.playerCount))].sort((a, b) => a - b),
    [5, 6, 7, 8, 9, 10],
  )
  assert.deepEqual(
    [...new Set(ARCHITECTURE_BANK.map((c) => c.targetRole))].sort(),
    [...STANDARD_ROLES].sort(),
  )
  assert.equal(ARCHITECTURE_BANK_ID, 'standard-v1')
})

test('architecture bank pins each target role to the recorded deterministic deal', () => {
  for (const c of ARCHITECTURE_BANK) {
    const game = createGame({
      id: `bank-check-${c.id}`,
      seed: c.seed,
      playerCount: c.playerCount,
      roles: [...c.roles],
      talk: c.talk,
    })
    const target = game.players.find((p) => p.role === c.targetRole)
    assert.equal(target?.seat, c.expectedTargetSeat, c.id)

    const repeated = createGame({
      id: `bank-repeat-${c.id}`,
      seed: c.seed,
      playerCount: c.playerCount,
      roles: [...c.roles],
      talk: c.talk,
    })
    assert.deepEqual(
      repeated.players.map((p) => p.role),
      game.players.map((p) => p.role),
      c.id,
    )
  }
})

test('architecture bank rejects incomplete or discussion-enabled copies', () => {
  assert.throws(
    () => validateArchitectureBank(ARCHITECTURE_BANK.filter((c) => c.playerCount !== 10)),
    /does not cover 10 players/,
  )
  assert.throws(
    () => validateArchitectureBank([{
      ...ARCHITECTURE_BANK[0],
      talk: { ...ARCHITECTURE_BANK[0].talk, maxRounds: 1 },
    }, ...ARCHITECTURE_BANK.slice(1)]),
    /must keep discussion disabled/,
  )
})
