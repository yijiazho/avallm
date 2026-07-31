// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exactBelief } from '../../../server/agents/belief/exact.ts'
import { assessTeam } from '../../../server/agents/belief/team-assessment.ts'
import { PROBABILITY_TOLERANCE } from '../../../server/agents/canonical/probability-arithmetic.ts'
import { readDecisionFixtures } from '../../../server/eval/decision-fixtures.ts'
import type { Decision, PlayerView, Seat } from '../../../server/engine/types.ts'

interface ExpectedFixtureBelief {
  throughSeq: number
  worlds: number
  entropy: number
  team: readonly Seat[]
  clean: number
  distribution: readonly number[]
}

const EXPECTED: Readonly<Record<string, ExpectedFixtureBelief>> = {
  'merlin-opening-proposal': {
    throughSeq: 11,
    worlds: 4,
    entropy: 2,
    team: [0, 4],
    clean: 1,
    distribution: [1, 0, 0],
  },
  'percival-opening-discussion': {
    throughSeq: 15,
    worlds: 4,
    entropy: 2,
    team: [0, 3],
    clean: 1 / 4,
    distribution: [1 / 4, 1 / 2, 1 / 4],
  },
  'servant-vote-after-evidence': {
    throughSeq: 53,
    worlds: 8,
    entropy: 3,
    team: [3, 4],
    clean: 1 / 2,
    distribution: [1 / 2, 1 / 2, 0],
  },
  'assassin-late-finalize': {
    throughSeq: 69,
    worlds: 6,
    entropy: Math.log2(6),
    team: [1, 3, 4],
    clean: 0,
    distribution: [0, 1, 0, 0],
  },
  'oberon-two-fail-quest': {
    throughSeq: 180,
    worlds: 288,
    entropy: Math.log2(288),
    team: [1, 4, 5, 6],
    clean: 0,
    distribution: [0, 1 / 6, 7 / 12, 1 / 4, 0],
  },
  'minion-late-discussion': {
    throughSeq: 185,
    worlds: 40,
    entropy: Math.log2(40),
    team: [0, 2, 5, 6, 7],
    clean: 0,
    distribution: [0, 1, 0, 0, 0, 0],
  },
  'mordred-late-vote': {
    throughSeq: 149,
    worlds: 60,
    entropy: Math.log2(60),
    team: [0, 1, 2, 7],
    clean: 1,
    distribution: [1, 0, 0, 0, 0],
  },
  'assassin-endgame-target': {
    throughSeq: 62,
    worlds: 6,
    entropy: Math.log2(6),
    team: [0, 1],
    clean: 1,
    distribution: [1, 0, 0],
  },
}

function assessmentTeam(
  view: PlayerView,
  decision: Decision,
  expected: ExpectedFixtureBelief,
): readonly Seat[] {
  const decisionTeam = decision.kind === 'propose'
    || (decision.kind === 'finalize' && !decision.stick)
    ? decision.team
    : undefined
  return view.currentTeam
    ?? decisionTeam
    ?? expected.team
}

function close(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) <= PROBABILITY_TOLERANCE,
    `expected ${expected} ± ${PROBABILITY_TOLERANCE}, got ${actual}`,
  )
}

test('every frozen Phase 0 decision fixture meets the exact-belief exit gate', () => {
  const fixtures = readDecisionFixtures()
  assert.deepEqual(
    fixtures.map(({ id }) => id).sort(),
    Object.keys(EXPECTED).sort(),
    'every frozen fixture needs an explicit Phase 1 expectation',
  )

  for (const fixture of fixtures) {
    const expected = EXPECTED[fixture.id]
    const snapshot = exactBelief(fixture.view)
    assert.deepEqual(exactBelief(fixture.view), snapshot, `${fixture.id}: posterior determinism`)
    assert.equal(snapshot.throughSeq, expected.throughSeq, fixture.id)
    assert.equal(snapshot.worlds.length, expected.worlds, fixture.id)
    close(snapshot.entropy, expected.entropy)
    close(snapshot.worlds.reduce((sum, world) => sum + world.probability, 0), 1)

    const assessment = assessTeam(
      snapshot,
      assessmentTeam(fixture.view, fixture.baselineDecision, expected),
    )
    assert.deepEqual(assessment.team, expected.team, fixture.id)
    close(assessment.cleanProbability, expected.clean)
    assert.equal(assessment.evilCountDistribution.length, expected.distribution.length)
    assessment.evilCountDistribution.forEach((probability, evilCount) =>
      close(probability, expected.distribution[evilCount]))
  }
})
