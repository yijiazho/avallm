// test-lane: eval
// Eval-lane guard for the assassin Merlin-posterior calibration harness
// (server/eval/assassin-calibration.ts). It pins the invariant behind the
// step-3 keep-the-bespoke-overlay decision rather than exact float metrics,
// which would be brittle against unrelated engine/heuristic changes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateAssassinCalibrationViews,
  productionMerlinPosterior,
  scoreMerlinPosterior,
  type MerlinPosteriorBuilder,
} from '../../server/eval/runs/assassin-calibration.ts'
import { buildPrivateEvilSeatMerlinPosterior } from '../../server/agents/analysis/assassin-merlin-posterior.ts'
import { exactBelief } from '../../server/agents/belief/exact.ts'

// The overlay-off baseline: the raw feasible-world prior, renormalized. Lives
// here rather than in the harness because only this comparison needs it.
const priorOnlyMerlinPosterior: MerlinPosteriorBuilder = (view) => {
  const targets = buildPrivateEvilSeatMerlinPosterior({ view, belief: exactBelief(view) }).targets
  const total = targets.reduce((sum, target) => sum + target.priorProbability, 0) || 1
  return targets.map((target) => ({
    seat: target.seat,
    probability: target.priorProbability / total,
  }))
}

test('held-out calibration set is non-trivial and deterministic', () => {
  const first = generateAssassinCalibrationViews(20)
  const second = generateAssassinCalibrationViews(20)
  assert.ok(first.length > 100, `expected a broad set, got ${first.length}`)
  assert.equal(first.length, second.length)
  assert.deepEqual(
    first.map((entry) => [entry.view.seat, entry.merlinSeat]),
    second.map((entry) => [entry.view.seat, entry.merlinSeat]),
  )
})

test('the behavioral overlay beats the prior-only baseline on hit-rate', () => {
  // Generate the held-out set once and score both builders on the same cases,
  // so the games are replayed once and the metrics share a denominator.
  const cases = generateAssassinCalibrationViews(25)
  const production = scoreMerlinPosterior(cases, productionMerlinPosterior)
  const priorOnly = scoreMerlinPosterior(cases, priorOnlyMerlinPosterior)
  assert.equal(production.predictions, priorOnly.predictions)
  for (const metrics of [production, priorOnly]) {
    assert.ok(metrics.predictions > 200)
    assert.ok(metrics.hitRate >= 0 && metrics.hitRate <= 1)
    assert.ok(metrics.meanBrier >= 0)
    assert.ok(Number.isFinite(metrics.meanLogLoss))
  }
  // The step-3 finding: the hypothesis-conditioned overlay lifts Merlin
  // identification well above the raw feasible-world prior.
  assert.ok(
    production.hitRate > priorOnly.hitRate,
    `overlay hitRate ${production.hitRate} should exceed prior-only ${priorOnly.hitRate}`,
  )
})
