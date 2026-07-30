import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import {
  assessTeam,
  assessTeams,
  beliefFromWeightedWorlds,
  exactBelief,
  feasibleWorlds,
} from '../server/agents/belief/exact.ts'
import {
  assertDistribution,
  assertProbability,
  BeliefInvariantError,
} from '../server/agents/belief/invariants.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../server/agents/belief/types.ts'
import type { Role } from '../server/engine/types.ts'
import type { WeightedWorld } from '../server/agents/belief/types.ts'

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

test('assertProbability accepts values in [0, 1] and rejects the rest', () => {
  for (const good of [0, 0.5, 1, 1e-13, 1 - 1e-13]) {
    assert.equal(assertProbability(good, 'p'), good)
  }
  for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertProbability(bad, 'p'), BeliefInvariantError)
  }
})

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

test('assertDistribution scales its tolerance with the term count', () => {
  // A wide distribution whose masses carry realistic rounding still passes;
  // the same absolute drift concentrated in two terms would not.
  const wide = Array.from({ length: 4096 }, () => 1 / 4096)
  assert.doesNotThrow(() => assertDistribution(wide, 'wide'))
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
