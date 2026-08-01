// test-lane: eval
// Migration register NB-011; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../server/engine/game.ts'
import { DEFAULT_ROLES } from '../../server/engine/rules.ts'
import { validateArchitectureBank } from '../../server/eval/banks/architecture-bank.ts'
import {
  PHASE7_EVIL_DEALS_PER_TARGET_ROLE,
  PHASE7_EVIL_POLICY_BANK,
  PHASE7_EVIL_POLICY_BANK_ID,
  PHASE7_EVIL_TARGET_ROLES,
} from '../../server/eval/banks/evil-policy-bank.ts'
import { PHASE4_POLICY_BANK } from '../../server/eval/banks/good-policy-bank.ts'
import {
  PHASE7_FULL_ROLE_BANKS,
  PHASE7_FULL_ROLE_EVAL_VERSION,
  phase7FullRoleVariantsFor,
  runPhase7FullRoleBench,
} from '../../server/eval/runs/full-role-bench.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../../server/agents/analysis/evil-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from '../../server/agents/analysis/role-objective-router.ts'
import type { Role } from '../../server/engine/types.ts'

const PLAYER_COUNTS = [5, 6, 7, 8, 9, 10] as const

test('the evil policy bank freezes 240 legal deals with unique ids and seeds', () => {
  assert.equal(PHASE7_EVIL_POLICY_BANK_ID, 'phase7-evil-v1')
  assert.equal(
    PHASE7_EVIL_POLICY_BANK.length,
    PHASE7_EVIL_TARGET_ROLES.length * PHASE7_EVIL_DEALS_PER_TARGET_ROLE,
  )
  assert.equal(PHASE7_EVIL_POLICY_BANK.length, 240)
  // Legal cast, target role in the cast, and the frozen no-discussion profile.
  assert.doesNotThrow(() =>
    validateArchitectureBank(PHASE7_EVIL_POLICY_BANK, {
      requireCoverage: false,
    }))
  assert.equal(
    new Set(PHASE7_EVIL_POLICY_BANK.map((entry) => entry.id)).size,
    PHASE7_EVIL_POLICY_BANK.length,
  )
  assert.equal(
    new Set(PHASE7_EVIL_POLICY_BANK.map((entry) => entry.seed)).size,
    PHASE7_EVIL_POLICY_BANK.length,
  )
  // The evil bank must not silently reuse a good-bank deal under a new id.
  const goodSeeds = new Set(PHASE4_POLICY_BANK.map((entry) => entry.seed))
  assert.ok(PHASE7_EVIL_POLICY_BANK.every(
    (entry) => !goodSeeds.has(entry.seed),
  ))
})

test('every evil bank case deals its target role at the pinned seat', () => {
  for (const bankCase of PHASE7_EVIL_POLICY_BANK) {
    const game = createGame({
      seed: bankCase.seed,
      playerCount: bankCase.playerCount,
      roles: [...bankCase.roles],
      talk: bankCase.talk,
    })
    assert.equal(
      game.players.find((player) => player.role === bankCase.targetRole)?.seat,
      bankCase.expectedTargetSeat,
      `${bankCase.id} target seat drifted`,
    )
  }
})

test('the evil bank targets each in-scope role with a matched sample', () => {
  assert.deepEqual(
    [...new Set(PHASE7_EVIL_POLICY_BANK.map((entry) => entry.targetRole))],
    [...PHASE7_EVIL_TARGET_ROLES],
  )
  // The good bank's per-role sample is the yardstick: a role covered at fewer
  // table sizes takes more deals per table rather than a thinner total.
  const goodPerRole = new Map<Role, number>()
  for (const entry of PHASE4_POLICY_BANK) {
    goodPerRole.set(
      entry.targetRole,
      (goodPerRole.get(entry.targetRole) ?? 0) + 1,
    )
  }
  assert.deepEqual(
    [...new Set(goodPerRole.values())],
    [PHASE7_EVIL_DEALS_PER_TARGET_ROLE],
  )
  for (const targetRole of PHASE7_EVIL_TARGET_ROLES) {
    const cases = PHASE7_EVIL_POLICY_BANK.filter(
      (entry) => entry.targetRole === targetRole,
    )
    assert.equal(
      cases.length,
      PHASE7_EVIL_DEALS_PER_TARGET_ROLE,
      `${targetRole} sample size`,
    )
    // Covered table sizes are exactly the standard casts that deal the role,
    // and every case uses that count's standard cast unmodified.
    assert.deepEqual(
      [...new Set(cases.map((entry) => entry.playerCount))].sort(
        (a, b) => a - b,
      ),
      PLAYER_COUNTS.filter(
        (playerCount) => DEFAULT_ROLES[playerCount]!.includes(targetRole),
      ),
      `${targetRole} table sizes`,
    )
    for (const entry of cases) {
      assert.deepEqual(
        [...entry.roles],
        DEFAULT_ROLES[entry.playerCount],
        `${entry.id} cast`,
      )
    }
    // Every in-scope target must reach the evil objective layer, or the bank
    // would buy no evil policy authority at all.
    assert.equal(
      routedRoleObjectiveModel(targetRole),
      EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
    )
  }
})

test('the full-role bench declares the evil bank and routes evil objectives', async () => {
  const bank = PHASE7_FULL_ROLE_BANKS.evil
  assert.equal(bank.side, 'evil')
  assert.equal(bank.id, 'phase7-evil-v1-full-role')
  assert.equal(bank.cases, PHASE7_EVIL_POLICY_BANK)
  assert.equal(PHASE7_FULL_ROLE_BANKS.good.cases, PHASE4_POLICY_BANK)

  for (const targetRole of PHASE7_EVIL_TARGET_ROLES) {
    const fullRole = phase7FullRoleVariantsFor(targetRole).find(
      (variant) => variant.id === 'full-role',
    )!
    assert.equal(
      fullRole.components.roleObjectiveRouter,
      ROLE_OBJECTIVE_ROUTER_VERSION,
    )
    assert.equal(fullRole.paid, false)
  }

  const report = await runPhase7FullRoleBench({
    bank,
    cases: PHASE7_EVIL_POLICY_BANK.slice(0, 1),
    opponentKinds: ['heuristic'],
  })
  assert.equal(report.version, PHASE7_FULL_ROLE_EVAL_VERSION)
  assert.equal(report.side, 'evil')
  assert.equal(report.bank, bank.id)
  assert.equal(report.cases, 1)
  const byRole = report.byPopulation.heuristic!
  const roleReport = byRole[PHASE7_EVIL_POLICY_BANK[0]!.targetRole]!
  assert.deepEqual(
    roleReport.variants.map((variant) => variant.id),
    ['compatibility', 'good-proposal-only', 'base-composed', 'full-role'],
  )
  for (const variant of roleReport.variants) {
    assert.equal(variant.games, 1)
    assert.equal(variant.safety.hiddenInformationViolations, 0)
    assert.equal(variant.safety.traceAttributionViolations, 0)
    const estimate = variant.decisionQuality.targetWinRate
    assert.equal(estimate.trials, 1)
    assert.ok(estimate.interval95)
    assert.ok(estimate.interval95!.low <= estimate.rate!)
    assert.ok(estimate.rate! <= estimate.interval95!.high)
  }
})
