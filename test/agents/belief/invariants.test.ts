// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
  feasibleWorlds,
} from '../../../server/agents/belief/exact.ts'
import {
  assessTeam,
  assessTeams,
} from '../../../server/agents/belief/team-assessment.ts'
import {
  assertDistribution,
  BeliefInvariantError,
} from '../../../server/agents/belief/invariants.ts'
import {
  stableProbabilitySum,
} from '../../../server/agents/canonical/probability-arithmetic.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../../../server/agents/belief/types.ts'
import type { Role } from '../../../server/engine/types.ts'
import type { WeightedWorld } from '../../../server/agents/belief/types.ts'

// The role sets that exercise every projection branch: base 5-player, the
// Merlin/Percival/Morgana kit, and a 10-player deal (the widest world set, the
// one whose thousands of masses stress the sum tolerance).
const CASTS: Record<number, Role[]> = {
  5: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  6: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin'],
  7: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon'],
  10: [
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'morgana', 'mordred', 'assassin', 'oberon',
  ],
}

// ---- the pure guards ----

test('assertDistribution accepts a normalized distribution and its float drift', () => {
  assert.doesNotThrow(() => assertDistribution([0.25, 0.25, 0.5], 'd'))
  // Thirds never sum to exactly 1 in binary floating point.
  assert.doesNotThrow(() => assertDistribution([1 / 3, 1 / 3, 1 / 3], 'd'))
})

test('assertDistribution rejects an unnormalized distribution', () => {
  assert.throws(() => assertDistribution([0.5, 0.4], 'd'), /must sum to 1/)
  assert.throws(() => assertDistribution([0.7, 0.7], 'd'), /must sum to 1/)
})

test('assertDistribution rejects a negative or non-finite mass', () => {
  assert.throws(() => assertDistribution([1.5, -0.5], 'd'), /probability mass/)
  assert.throws(() => assertDistribution([Number.NaN, 1], 'd'), /probability mass/)
})

test('assertDistribution holds one flat tolerance at any term count', () => {
  // This used to widen the tolerance to `tolerance * values.length` to survive
  // a wide distribution. The sum is compensated now, so width costs nothing and
  // the flat single-value tolerance carries it: 60,480 is the largest feasible
  // support this tree produces, a ten-player servant view, and a naive sum of
  // it lands 7.9e-13 from 1 against a 1e-12 budget, a margin of 1.27x. If this
  // ever starts failing, the compensation was lost, not the tolerance.
  for (const width of [4096, 60_480]) {
    const wide = Array.from({ length: width }, () => 1 / width)
    assert.doesNotThrow(() => assertDistribution(wide, `wide-${width}`))
  }
})

test('assertDistribution rejects a total that overflows to non-finite', () => {
  // Each mass is individually finite and non-negative, so the per-element check
  // admits both, but their sum overflows. The compensation term then takes an
  // Infinity minus Infinity and becomes NaN, and every tolerance comparison
  // against NaN is false. Without an explicit finiteness check on the total the
  // guard would return the corrupted distribution rather than throw, which is
  // the exact input it exists to reject.
  assert.throws(
    () => assertDistribution([1e308, 1e308], 'overflow'),
    /must sum to 1/,
  )
})

// ---- real snapshots never trip the postconditions ----

test('every exact snapshot satisfies its distribution postconditions', () => {
  for (const [count, roles] of Object.entries(CASTS)) {
    const game = createGame({
      seed: `inv-${count}`,
      playerCount: Number(count),
      roles,
    })
    for (const player of game.players) {
      // exactBelief runs assertSnapshotDistributions internally; reaching here
      // without a throw is the assertion. We re-derive the sums to make the
      // guarantee legible and to fail loudly here rather than deep in the call.
      const snapshot = exactBelief(viewFor(game, player.seat))
      assert.doesNotThrow(() =>
        assertDistribution(
          snapshot.worlds.map((weighted) => weighted.probability),
          'worlds',
        ))
      for (const marginal of snapshot.playerMarginals) {
        assert.ok(Math.abs(marginal.goodProbability + marginal.evilProbability - 1) < 1e-9)
      }
    }
  }
})

test('assessTeams distributions are valid across a real deal', () => {
  const game = createGame({ seed: 'inv-assess', playerCount: 7, roles: CASTS[7] })
  const snapshot = exactBelief(viewFor(game, game.players[0].seat))
  const teams = [[0, 1, 2], [3, 4, 5, 6], [0, 6]]
  const assessments = assessTeams(snapshot, teams)
  for (const assessment of assessments) {
    assert.doesNotThrow(() =>
      assertDistribution(assessment.evilCountDistribution, 'evil-count'))
    assert.equal(assessment.cleanProbability, assessment.evilCountDistribution[0])
  }
  // Single-team convenience wrapper agrees with the batch.
  assert.deepEqual(assessTeam(snapshot, teams[0]), assessments[0])
})

// The projection's own normalization is the last summation before a snapshot
// reaches a consumer, it runs over the largest array in the system, and every
// probability anyone reads is divided by it. Whatever error that total carries
// is the error the whole belief pipeline carries, which is why it is
// compensated and why the check here is exact rather than tolerant.
//
// One machine epsilon, not PROBABILITY_TOLERANCE, is the point of the test.
// Measured across the belief corpus, the naive total this replaced left the
// widest snapshots off by up to 6.9e-13: inside the strict tolerance, and so
// invisible to every existing check. Only a bound roughly four thousand times
// tighter tells the two apart.
//
// One ulp rather than exact equality because exact is not available and
// claiming it would be a test that passes by luck. A uniform 60,480-world
// snapshot divides by a total that is itself a rounded double, and 60,480
// copies of fl(1/60480) land one ulp below 1 no matter how the sum is
// accumulated. A ten-player servant view is the widest support the game
// produces; the three weight shapes cover the uniform case and two the
// projection cannot take its uniform shortcut on.
test('the widest weighted projection sums to 1 within an ulp, not merely a tolerance', () => {
  const game = createGame({ seed: 'inv-widest', playerCount: 10, roles: CASTS[10] })
  const view = viewFor(
    game,
    game.players.find((player) => player.role === 'servant')!.seat,
  )
  const worlds = feasibleWorlds(view)
  assert.ok(worlds.length > 20_000, `expected a wide support, got ${worlds.length}`)
  for (const weightOf of [
    (index: number) => 1 + (index % 7),
    () => 1,
    (index: number) => 1 + (index % 1_000) / 1_000,
  ]) {
    const snapshot = beliefFromWeightedWorlds(
      view,
      worlds.map((world, index) => ({ world, probability: weightOf(index) })),
      { modelVersion: EXACT_BELIEF_MODEL_VERSION, quality: 'weighted' },
    )
    const total = stableProbabilitySum(
      snapshot.worlds,
      (weighted) => weighted.probability,
    )
    assert.ok(
      Math.abs(total - 1) <= Number.EPSILON,
      `${snapshot.worlds.length} worlds summed to ${total}`,
    )
  }
})

// ---- the honest projection never trips the guard; the guard rejects corruption ----

test('beliefFromWeightedWorlds normalizes arbitrary positive weights into a valid snapshot', () => {
  const game = createGame({ seed: 'inv-corrupt', playerCount: 5, roles: CASTS[5] })
  const view = viewFor(game, game.players[0].seat)
  // Ascending raw weights the projection must normalize. Its internal
  // postcondition runs on this non-uniform data, so reaching a well-formed
  // snapshot (rather than a throw) is the proof the guard passed here.
  const weighted: WeightedWorld[] = feasibleWorlds(view).map((world, index) => ({
    world,
    probability: index + 1,
  }))
  const snapshot = beliefFromWeightedWorlds(view, weighted, {
    modelVersion: EXACT_BELIEF_MODEL_VERSION,
    quality: 'weighted',
  })
  const total = snapshot.worlds.reduce((sum, world) => sum + world.probability, 0)
  assert.ok(Math.abs(total - 1) < 1e-9, `normalized worlds should sum to 1, got ${total}`)
})

test('assertDistribution rejects the un-normalized shape a projection bug would emit', () => {
  // A normalization bug (wrong denominator, a dropped term) makes the masses
  // stop summing to 1. That is the shape the postcondition catches at the
  // boundary before a corrupt posterior can reach scoring.
  assert.throws(() => assertDistribution([0.6, 0.6], 'corrupt'), BeliefInvariantError)
  assert.throws(() => assertDistribution([0.4, 0.4, 0.1], 'corrupt'), BeliefInvariantError)
})
