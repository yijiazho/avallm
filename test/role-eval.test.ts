// test-lane: eval
// Migration phase 7F2A; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  fullRolePolicyScorer,
} from '../server/agents/policy/score.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../server/agents/policy/evil-quest-card.ts'
import {
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  phase7RoleEvidenceRow,
  phase7RoleVariantsFor,
  resolvePhase7RoleOutputPaths,
  runPhase7RoleEval,
  serializePhase7RoleEvidence,
  serializeVirtualAssassinEvidence,
} from '../server/eval/role-eval.ts'
import {
  joinVirtualAssassinTruth,
  prepareVirtualAssassinEvaluation,
} from '../server/eval/virtual-assassin.ts'

test('Phase 7 CLI resolves distinct output files before freshness checks', () => {
  const paths = resolvePhase7RoleOutputPaths(
    'data/eval/phase7-roles.jsonl',
  )
  assert.equal(path.isAbsolute(paths.out), true)
  assert.equal(path.isAbsolute(paths.virtualOut), true)
  assert.equal(
    paths.virtualOut,
    `${paths.out}.virtual-assassin.jsonl`,
  )
  assert.throws(
    () => resolvePhase7RoleOutputPaths(
      'data/eval/phase7-roles.jsonl',
      './data/eval/../eval/phase7-roles.jsonl',
    ),
    /must resolve to different files/,
  )
  if (process.platform === 'win32') {
    assert.throws(
      () => resolvePhase7RoleOutputPaths(
        'data/eval/Phase7-Roles.jsonl',
        'DATA/EVAL/phase7-roles.JSONL',
      ),
      /must resolve to different files/,
    )
  }
})

test('Phase 7 matrix has five truthful raw identities per standard case', () => {
  const scorerByRawId = new Map<string, string>()
  for (const bankCase of ARCHITECTURE_BANK) {
    const variants = phase7RoleVariantsFor(bankCase.targetRole)
    assert.equal(variants.length, 5)
    assert.equal(new Set(variants.map((variant) => variant.id)).size, 5)
    for (const variant of variants) {
      assert.equal(variant.paid, false)
      assert.equal(
        variant.descriptor,
        `phase7-role-eval:${variant.id}`,
      )
      const prior = scorerByRawId.get(variant.id)
      if (prior) assert.equal(prior, variant.components.scorer)
      scorerByRawId.set(variant.id, variant.components.scorer)
    }
    const isolated = variants[3]
    assert.match(isolated.id, new RegExp(bankCase.targetRole))
    const full = variants[4]
    assert.equal(full.id, 'full-role')
    assert.equal(full.components.scorer, fullRolePolicyScorer.version)
    assert.equal(
      full.components.evilQuestCardPolicy,
      EVIL_QUEST_ROBUST_POLICY_VERSION,
    )
  }
  assert.equal(
    ARCHITECTURE_BANK.length * 5,
    ARCHITECTURE_BANK.flatMap((bankCase) =>
      phase7RoleVariantsFor(bankCase.targetRole)).length,
  )
})

test('virtual Assassin freezes twelve unlabelled PlayerView predictions before truth join', () => {
  const first = prepareVirtualAssassinEvaluation()
  const second = prepareVirtualAssassinEvaluation()
  assert.equal(first.predictions.length, 12)
  assert.deepEqual(first, second)
  assert.ok(Object.isFrozen(first.predictions))
  assert.ok(first.predictions.every((prediction) => {
    assert.ok(Object.isFrozen(prediction))
    assert.ok(Object.isFrozen(prediction.targets))
    assert.equal('merlinSeat' in prediction, false)
    assert.equal('hit' in prediction, false)
    assert.match(prediction.predictionDigest, /^[0-9a-f]{64}$/)
    assert.equal(
      prediction.targets.reduce(
        (sum, target) => sum + target.probability,
        0,
      ).toFixed(12),
      '1.000000000000',
    )
    return true
  }))
  assert.deepEqual(
    [...new Set(first.predictions.map((row) => row.playerCount))],
    [5, 7, 9, 10],
  )
  const oberon = first.predictions.filter((row) => row.predictorRole === 'oberon')
  assert.equal(oberon.length, 2)
  assert.ok(oberon.every((row) =>
    row.targets.every((target) => !target.knownVisibleEvil)))
  const joined = joinVirtualAssassinTruth(first.predictions, first.truths)
  assert.equal(joined.length, 12)
  assert.ok(joined.every((row) =>
    row.hit === (row.guessSeat === row.merlinSeat)))
})

test('Phase 7 runner smoke emits deterministic sortable exact evidence', async () => {
  const result = await runPhase7RoleEval({
    cases: [ARCHITECTURE_BANK[0]],
  })
  assert.equal(result.rows.length, 5)
  assert.equal(result.artifacts.length, 5)
  assert.equal(result.architecture.variants.length, 5)
  assert.equal(result.virtualAssassin.length, 12)
  assert.ok(result.rows.every((row) =>
    row.terminal
    && row.calls === 0
    && row.cost === 0
    && row.degradation === 0
    && row.exactAdmission.eligible
    && row.safety.hiddenViolations === 0
    && row.safety.attributionViolations === 0))
  const full = result.rows.find((row) => row.logicalArm === 'full-role')!
  const isolated = result.rows.find(
    (row) => row.logicalArm === 'isolated-role',
  )!
  assert.equal(full.decisionDigest, isolated.decisionDigest)
  assert.equal(full.configuredScorer, fullRolePolicyScorer.version)
  assert.ok(full.exactAdmission.exact > 0)
  assert.deepEqual(
    result.artifacts.map(phase7RoleEvidenceRow),
    result.artifacts.map((artifact) =>
      phase7RoleEvidenceRow(structuredClone(artifact))),
  )
  const serialized = serializePhase7RoleEvidence([...result.rows].reverse())
  assert.equal(serialized, serializePhase7RoleEvidence(result.rows))
  assert.equal(serialized.includes('createdAt'), false)
  assert.equal(serialized.includes('milliseconds'), false)
  assert.equal(serialized.trim().split('\n').length, 5)
  const virtual = serializeVirtualAssassinEvidence(
    [...result.virtualAssassin].reverse(),
  )
  assert.equal(
    virtual,
    serializeVirtualAssassinEvidence(result.virtualAssassin),
  )
  assert.equal(virtual.includes('ranAt'), false)
  assert.equal(virtual.trim().split('\n').length, 12)
})
