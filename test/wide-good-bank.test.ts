// test-lane: eval
// The wide good-side bank: the same experiment as phase4-good-v1, with enough
// of it to see.
//
// Two things need pinning and they are different in kind. The SHAPE is a claim
// about power: sixty deals per player count per target role is what makes a
// few-point paired shift resolvable, and shrinking it silently would leave the
// gate unable to decide exactly as before. The DEAL is a drift tripwire: the
// frozen bank hand-lists its target seats so an engine PRNG change cannot move
// the target population, and this bank derives them, so one digest over the
// whole mapping has to stand in for those literals.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame } from '../server/engine/game.ts'
import { validateArchitectureBank } from '../server/eval/architecture-bank.ts'
import { PHASE4_POLICY_BANK } from '../server/eval/good-policy-bank.ts'
import { runWideGoodGate } from '../server/eval/wide-good-gate.ts'
import {
  WIDE_GOOD_BANK,
  WIDE_GOOD_BANK_ID,
  WIDE_GOOD_DEALS_PER_CELL,
  WIDE_GOOD_PLAYER_COUNTS,
  WIDE_GOOD_TARGET_ROLES,
  wideGoodBankDigest,
  wideGoodBankFor,
} from '../server/eval/wide-good-bank.ts'

test('the bank is sized for the shift it exists to resolve', () => {
  assert.equal(WIDE_GOOD_DEALS_PER_CELL, 60)
  assert.equal(
    WIDE_GOOD_BANK.length,
    WIDE_GOOD_PLAYER_COUNTS.length
    * WIDE_GOOD_TARGET_ROLES.length
    * WIDE_GOOD_DEALS_PER_CELL,
  )
  assert.equal(WIDE_GOOD_BANK.length, 1_080)
  for (const role of WIDE_GOOD_TARGET_ROLES) {
    assert.equal(wideGoodBankFor(role).length, 360)
  }
  // Six times the frozen bank, which is the entire reason it exists: at sixty
  // games a cell, a net four-game paired shift cannot reach significance under
  // any split of its discordant pairs.
  assert.equal(WIDE_GOOD_BANK.length, PHASE4_POLICY_BANK.length * 6)
  for (const playerCount of WIDE_GOOD_PLAYER_COUNTS) {
    for (const role of WIDE_GOOD_TARGET_ROLES) {
      assert.equal(
        WIDE_GOOD_BANK.filter((entry) =>
          entry.playerCount === playerCount && entry.targetRole === role).length,
        WIDE_GOOD_DEALS_PER_CELL,
        `${playerCount}p ${role} must carry a full cell`,
      )
    }
  }
})

test('it satisfies the shared bank contract', () => {
  // requireCoverage is off because the standard sweep demands every standard
  // role be SOME case's target, and this bank targets the three good seats on
  // purpose; the evil side has its own bank.
  assert.doesNotThrow(
    () => validateArchitectureBank(WIDE_GOOD_BANK, { requireCoverage: false }),
  )
})

// The comparability claim. This bank is only worth running instead of the
// frozen one if it is the SAME experiment, so the casts and the discussion
// profile have to match case for case rather than approximately.
test('it is the frozen bank widened, not a different experiment', () => {
  for (const playerCount of WIDE_GOOD_PLAYER_COUNTS) {
    const frozen = PHASE4_POLICY_BANK.find(
      (entry) => entry.playerCount === playerCount,
    )
    assert.ok(frozen, `the frozen bank must cover ${playerCount}p`)
    const wide = WIDE_GOOD_BANK.find(
      (entry) => entry.playerCount === playerCount,
    )
    assert.ok(wide)
    assert.deepEqual([...wide.roles], [...frozen.roles], `${playerCount}p cast`)
    assert.deepEqual(wide.talk, frozen.talk, `${playerCount}p talk profile`)
  }
  assert.deepEqual(
    [...WIDE_GOOD_TARGET_ROLES].sort(),
    [...new Set(PHASE4_POLICY_BANK.map((entry) => entry.targetRole))].sort(),
  )
})

// Seeds must not collide across banks: two banks sharing a seed would archive
// two artifacts describing one deal under different bank ids, and any join on
// the deal (every paired comparison does one) could not tell them apart.
test('its seeds cannot collide with the frozen bank', () => {
  const frozen = new Set(PHASE4_POLICY_BANK.map((entry) => entry.seed))
  const wide = new Set(WIDE_GOOD_BANK.map((entry) => entry.seed))
  assert.equal(wide.size, WIDE_GOOD_BANK.length, 'seeds must be unique within')
  for (const seed of wide) {
    assert.ok(!frozen.has(seed), `seed ${seed} collides with the frozen bank`)
    assert.ok(seed.startsWith(WIDE_GOOD_BANK_ID))
  }
})

// THE DRIFT TRIPWIRE, standing in for the frozen bank's literal seat table.
// If the engine's deal changes, this digest moves and every recorded number
// against this bank has to be re-measured rather than silently reinterpreted.
test('the dealt target seats are pinned by digest', () => {
  assert.equal(wideGoodBankDigest(), 'e3043271')
})

// And the digest has to be pinning the truth: every derived seat must be where
// the deal actually puts the role, resolved exactly as the bench resolves it.
// Without this the digest would faithfully pin a wrong table.
test('every derived seat is where the deal actually puts the role', () => {
  for (const entry of WIDE_GOOD_BANK) {
    const game = createGame({
      seed: entry.seed,
      playerCount: entry.playerCount,
      roles: [...entry.roles],
      talk: entry.talk,
    })
    const target = game.players.find(
      (player) => player.role === entry.targetRole,
    )
    assert.ok(target, `${entry.id}: cast has no ${entry.targetRole}`)
    assert.equal(
      target.seat,
      entry.expectedTargetSeat,
      `${entry.id}: derived seat disagrees with the deal`,
    )
  }
})

// The runner exists so a gate is one command; what it must not do is let a
// short run pass for a gate, which is the exact failure this bank was built to
// end.
test('the gate runner slices by role and admits when a cell is partial', async () => {
  const lines: string[] = []
  const report = await runWideGoodGate({
    targetRole: 'servant',
    population: 'heuristic',
    cases: 2,
    onProgress: (line) => lines.push(line),
  })
  assert.equal(report.variants.length, 3)
  for (const variant of report.variants) {
    assert.equal(variant.games, 2)
    assert.equal(variant.degraded, 0)
  }
  assert.ok(
    lines.some((line) => line.includes('PARTIAL CELL: 2 of 360')),
    'a partial cell must say so rather than read as a gate run',
  )
  // Provenance: the run names the deal mapping it measured, so two runs cannot
  // be compared without noticing they used different target populations.
  assert.ok(
    lines.some((line) => line.includes(wideGoodBankDigest())),
    'a run must record the deal digest it was measured against',
  )
})

test('the gate runner refuses a role the bank does not target', async () => {
  await assert.rejects(
    () => runWideGoodGate({ targetRole: 'morgana', population: 'heuristic' }),
    /no cases targeting morgana/,
  )
})
