// test-lane: eval
// Migration phase 7F2B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPhase7RoleReport,
  parsePhase7RoleEvidence,
  parseVirtualAssassinEvidence,
  PHASE7_ROLE_EVIDENCE_BASELINE,
  PHASE7_ROLE_REPORT_BASELINE,
  PHASE7_VIRTUAL_ASSASSIN_BASELINE,
  serializePhase7RoleReport,
} from '../../server/eval/role-report.ts'

const roleText = readFileSync(PHASE7_ROLE_EVIDENCE_BASELINE, 'utf8')
const virtualText = readFileSync(
  PHASE7_VIRTUAL_ASSASSIN_BASELINE,
  'utf8',
)

test('Phase 7 report validates the frozen inventory and exit evidence', async () => {
  const report = await buildPhase7RoleReport(roleText, virtualText)
  assert.equal(report.inventory.rows, 50)
  assert.equal(report.inventory.cases, 10)
  assert.deepEqual(report.inventory.logicalArms, [
    'compatibility',
    'base-composed',
    'observer-only',
    'isolated-role',
    'full-role',
  ])
  assert.ok(Object.values(report.arms).every((arm) =>
    arm.games === 10
    && arm.calls === 0
    && arm.cost === 0
    && arm.degradation === 0
    && arm.forcedViolations === 0
    && arm.exactAdmission.promotionEligible
    && arm.safety.hiddenViolations === 0
    && arm.safety.attributionViolations === 0))
  assert.equal(report.mechanics.baseObserverEquivalentCases, 10)
  assert.equal(report.mechanics.isolatedFullComparableCases, 6)
  assert.equal(
    report.mechanics.isolatedFullEquivalentComparableCases,
    6,
  )
  assert.deepEqual(
    report.mechanics.integratedFullRoleDifferenceCases,
    ['8p-minion', '9p-mordred'],
  )
  assert.equal(report.authority.families, 6)
  assert.ok(report.authority.rows.every((row) =>
    row.trustedAdmission === 'trusted-exact'
    && row.mechanicsEquivalent
    && row.fullRoleTerminal
    && row.causalStages.length > 0))
  assert.deepEqual(
    new Set(report.authority.rows.map((row) => row.family)),
    new Set([
      'good-role', 'shared-evil-oberon', 'morgana',
      'mordred', 'assassin', 'robust-d3',
    ]),
  )
  assert.deepEqual(
    {
      histories: report.virtualAssassin.histories,
      guesses: report.virtualAssassin.guesses,
      sampleUnit: report.virtualAssassin.sampleUnit,
      threshold: report.virtualAssassin.promotionThreshold,
    },
    {
      histories: 4,
      guesses: 12,
      sampleUnit: '12-correlated-guesses-from-4-histories',
      threshold: null,
    },
  )
  assert.equal(report.exitGate.passed, true)
  assert.equal(
    serializePhase7RoleReport(report),
    readFileSync(PHASE7_ROLE_REPORT_BASELINE, 'utf8'),
  )
})

test('Phase 7 parsers fail closed on inventory, fields, and pretruth drift', () => {
  assert.equal(parsePhase7RoleEvidence(roleText).length, 50)
  assert.equal(parseVirtualAssassinEvidence(virtualText).length, 12)
  assert.throws(
    () => parsePhase7RoleEvidence(
      roleText.split('\n').slice(1).join('\n'),
    ),
    /incomplete standard-v1 inventory/,
  )
  const first = JSON.parse(roleText.split('\n')[0])
  first.unowned = true
  assert.throws(
    () => parsePhase7RoleEvidence(
      `${JSON.stringify(first)}\n${roleText.split('\n').slice(1).join('\n')}`,
    ),
    /invalid fields/,
  )
  const virtual = virtualText.trimEnd().split('\n')
    .map((line) => JSON.parse(line))
  virtual[0].guessSeat = (virtual[0].guessSeat + 1)
    % virtual[0].playerCount
  virtual[0].hit = virtual[0].guessSeat === virtual[0].merlinSeat
  assert.throws(
    () => parseVirtualAssassinEvidence(
      `${virtual.map((row) => JSON.stringify(row)).join('\n')}\n`,
    ),
    /pretruth digest mismatch/,
  )
})
