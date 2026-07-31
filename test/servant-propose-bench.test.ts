// The gate for the servant propose refinement, and the properties that make a
// run of it readable as evidence rather than as a number.
//
// The measured verdict is recorded in docs/design-perception-primitive.md; this
// suite pins the harness, not the result. What it has to protect is the thing
// that makes the comparison mean anything: the two scoring arms must differ by
// exactly one layer and one component. When the family was first declared last
// in the score tree, the candidate arm configured eleven components (the whole
// evil subtree, none of which can apply to a good seat) against the baseline's
// two, and the A/B silently stopped being an A/B.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  roleObjectiveScorer,
  servantRoleScorer,
} from '../server/agents/policy/score.ts'
import {
  SERVANT_PROPOSE_BANK_ID,
  SERVANT_PROPOSE_EVAL_VERSION,
  SERVANT_PROPOSE_VARIANTS,
  runServantProposeBench,
  servantProposeCases,
  servantProposeVariants,
} from '../server/eval/servant-propose-bench.ts'
import {
  SERVANT_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import { PHASE4_POLICY_BANK } from '../server/eval/good-policy-bank.ts'

test('the bench targets exactly the bank servant seats', () => {
  const cases = servantProposeCases()
  assert.equal(cases.length, 60)
  assert.equal(PHASE4_POLICY_BANK.length, 180)
  assert.ok(cases.every((entry) => entry.targetRole === 'servant'))
  // Every table size, not just the small ones a slice would leave.
  assert.deepEqual(
    [...new Set(cases.map((entry) => entry.playerCount))].sort(
      (left, right) => left - right,
    ),
    [5, 6, 7, 8, 9, 10],
  )
  assert.equal(SERVANT_PROPOSE_BANK_ID, 'phase4-good-v1-servant-propose')
})

test('the arms are declared as one gate plus one reference', () => {
  const variants = servantProposeVariants()
  assert.deepEqual(
    variants.map((variant) => variant.id),
    [
      SERVANT_PROPOSE_VARIANTS.base,
      SERVANT_PROPOSE_VARIANTS.servant,
      SERVANT_PROPOSE_VARIANTS.compatibility,
    ],
  )
  // Declared order is comparison order, so the baseline has to be first or
  // every delta in the report is measured against the wrong arm.
  assert.deepEqual(
    variants.map((variant) => variant.components.evaluationRole),
    ['baseline', 'candidate', 'reference'],
  )
  for (const variant of variants) {
    assert.equal(variant.paid, false, `${variant.id} must be API-free`)
    assert.equal(
      variant.components.evaluation,
      SERVANT_PROPOSE_EVAL_VERSION,
    )
  }
})

// The property the first run of this bench got wrong. A candidate arm that
// resolves components the baseline does not is measuring those too, and the
// delta stops being attributable to the layer under test.
test('the two scoring arms differ by exactly the servant projection', () => {
  const configured = (scorer: typeof roleObjectiveScorer) =>
    createComposedAgent({ seed: 'gate', scorer })
      .resolvedBrain().description.components.configured
      .map((component) => component.id)
      .sort()

  const base = configured(roleObjectiveScorer)
  const candidate = configured(servantRoleScorer)
  assert.deepEqual(
    candidate.filter((id) => !base.includes(id)),
    [SERVANT_ROLE_UTILITY_COMPONENT.id],
    'the candidate arm configures a component the baseline does not',
  )
  assert.deepEqual(
    base.filter((id) => !candidate.includes(id)),
    [],
    'the baseline arm configures a component the candidate does not',
  )
})

test('a one-case run produces one artifact per arm per population', async () => {
  const report = await runServantProposeBench({
    cases: servantProposeCases().slice(0, 1),
    opponentKinds: ['heuristic'],
  })
  assert.equal(report.version, SERVANT_PROPOSE_EVAL_VERSION)
  assert.equal(report.cases, 1)
  const heuristic = report.byPopulation.heuristic
  assert.ok(heuristic, 'the requested population must be reported')
  assert.deepEqual(
    heuristic.variants.map((variant) => variant.id).sort(),
    [
      SERVANT_PROPOSE_VARIANTS.compatibility,
      SERVANT_PROPOSE_VARIANTS.base,
      SERVANT_PROPOSE_VARIANTS.servant,
    ].sort(),
  )
  assert.ok(
    heuristic.variants.every((variant) => variant.games === 1),
    'each arm must play the one requested case exactly once',
  )
  assert.ok(
    heuristic.variants.every((variant) => variant.degraded === 0),
    'a degraded arm measures the fallback, not the layer',
  )
})

test('a bench run refuses a case set with no servant seat', async () => {
  await assert.rejects(
    () => runServantProposeBench({
      cases: PHASE4_POLICY_BANK.filter(
        (entry) => entry.targetRole === 'merlin',
      ),
    }),
    /requires servant-target cases/,
  )
})
