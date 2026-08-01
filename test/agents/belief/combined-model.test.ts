// test-lane: contract
//
// Composition of mechanical factors.
//
// The equations are the components' own and are tested in their own suites.
// What is new here is everything that only exists once two factors run at
// once: that neither swallows the other's budget, that a failure costs its own
// evidence and nothing else, that a component with nothing to say is not the
// same as a component that broke, and that the result is still a valid
// posterior over exactly the feasible worlds.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { createHeuristicAgent } from '../../../server/agents/heuristic.ts'
import {
  createCombinedBeliefModel,
  questAndVoteGoodBeliefModel,
  QUEST_AND_VOTE_GOOD_COMPONENTS,
  type AnyCombinedComponent,
} from '../../../server/agents/belief/combined-model.ts'
import { exactBelief, feasibleWorlds } from '../../../server/agents/belief/exact.ts'
import { questWeightedBeliefModel } from '../../../server/agents/belief/quest-card-factor.ts'
import { assertDistribution } from '../../../server/agents/belief/invariants.ts'
import type { PlayerView, Role } from '../../../server/engine/types.ts'

const SEVEN: Role[] = [
  'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon',
]

/** A game driven far enough that both components have evidence to read. */
async function playedOut(seed: string): Promise<PlayerView> {
  const game = createGame({
    seed,
    playerCount: 7,
    roles: [...SEVEN],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const agents = game.players.map((player) =>
    createHeuristicAgent({ seed, seat: player.seat }))
  for (let step = 0; step < 400; step++) {
    const pending = expectedDecisions(game)
    if (!pending.length) break
    for (const req of pending) {
      const view = viewFor(game, req.seat)
      applyDecision(
        game,
        req.seat,
        (await agents[req.seat]!.decide(req, view)).decision,
      )
    }
    const view = viewFor(game, 0)
    const resolved = view.quests.filter((q) => q.status === 'complete').length
    if (resolved >= 1 && view.proposals.some((p) => p.outcome === 'voted')) {
      return view
    }
  }
  return viewFor(game, 0)
}

test('a combination refuses to be a single factor wearing a combined name', () => {
  // A one-component "combination" would put a bundle string in every trace
  // promising a composition that never happened, which admission would then
  // reconstruct and agree with.
  assert.throws(
    () => createCombinedBeliefModel(
      [QUEST_AND_VOTE_GOOD_COMPONENTS[0]!],
      { belief: 'b', bundle: 'x' },
    ),
    /at least two components/,
  )
})

test('the bundle identity names both components and cannot be authored', () => {
  assert.equal(
    questAndVoteGoodBeliefModel.factorsVersion,
    'quest-card-only-v1+vote-matrix-good-only-v2',
  )
  assert.equal(
    questAndVoteGoodBeliefModel.version,
    'exact-constraints+quest-card-only-v1+vote-matrix-good-only-v2',
  )
  // Derived from the components rather than retyped, so a bundle string cannot
  // claim a composition the model does not perform.
  for (const component of QUEST_AND_VOTE_GOOD_COMPONENTS) {
    assert.ok(
      questAndVoteGoodBeliefModel.factorsVersion.includes(
        component.bundleVersion),
      `${component.id} is missing from the bundle identity`,
    )
  }
})

test('the posterior is valid and over exactly the feasible worlds', async () => {
  const view = await playedOut('combined-valid')
  const snapshot = questAndVoteGoodBeliefModel.infer(view)
  assert.equal(snapshot.quality, 'weighted')
  assert.equal(snapshot.worlds.length, feasibleWorlds(view).length)
  assertDistribution(
    snapshot.worlds.map((weighted) => weighted.probability),
    'combined posterior',
  )
  // Hard feasibility still decides what exists: no world outside the exact set
  // appears, and none inside it was annihilated.
  const feasible = new Set(feasibleWorlds(view).map((world) => world.key))
  for (const weighted of snapshot.worlds) {
    assert.ok(feasible.has(weighted.world.key), 'a world outside the exact set')
    assert.ok(weighted.probability > 0, 'a feasible world was annihilated')
  }
})

test('both components appear in provenance, each under its own cap', async () => {
  const view = await playedOut('combined-provenance')
  const snapshot = questAndVoteGoodBeliefModel.infer(view)
  const ids = snapshot.provenance.map((entry) => entry.factorId).sort()
  assert.deepEqual(ids, ['quest-card', 'vote-matrix'])
  for (const entry of snapshot.provenance) {
    // Each component is bounded by its OWN declared cap, which is the property
    // that stops one swallowing the other's budget. A shared ceiling would be
    // consumed by whichever ran first.
    assert.ok(
      entry.minLogLikelihood >= -entry.logLikelihoodCap - 1e-9,
      `${entry.factorId} exceeded its own cap`,
    )
    assert.ok(entry.maxLogLikelihood <= 1e-9)
  }
  const caps = snapshot.provenance.map((entry) => entry.logLikelihoodCap)
  assert.notEqual(caps[0], caps[1], 'the two components must keep distinct caps')
})

test('the combination differs from either component alone', async () => {
  // Otherwise the file is decoration: the whole point is that the posterior
  // is not reachable by running one factor.
  const view = await playedOut('combined-differs')
  const combined = questAndVoteGoodBeliefModel.infer(view)
  const questOnly = questWeightedBeliefModel.infer(view)
  const uniform = exactBelief(view)
  const mass = (snapshot: { worlds: readonly { probability: number }[] }) =>
    snapshot.worlds.map((w) => w.probability)
  assert.notDeepEqual(mass(combined), mass(questOnly))
  assert.notDeepEqual(mass(combined), mass(uniform))
})

test('one component failing costs its evidence and nothing else', async () => {
  // The capability no single-factor model in this folder has: §10 step 2 asks
  // for the factor to be omitted and the snapshot marked degraded, not for the
  // whole mechanical posterior to be lost.
  const view = await playedOut('combined-degrade')
  const broken: AnyCombinedComponent = {
    ...QUEST_AND_VOTE_GOOD_COMPONENTS[1]!,
    evidence: () => { throw new Error('injected component failure') },
  }
  const model = createCombinedBeliefModel(
    [QUEST_AND_VOTE_GOOD_COMPONENTS[0]!, broken],
    { belief: 'combined-test-v1', bundle: 'combined-test-bundle-v1' },
  )
  const snapshot = model.infer(view)
  assert.equal(snapshot.quality, 'degraded')
  assert.deepEqual(snapshot.degradation, ['vote-matrix-factor-failed'])
  // The surviving component still weighted: this is not the uniform posterior.
  assert.deepEqual(
    snapshot.provenance.map((entry) => entry.factorId),
    ['quest-card'],
  )
  assertDistribution(
    snapshot.worlds.map((weighted) => weighted.probability),
    'partially degraded posterior',
  )
  // The exact claim, rather than "differs from uniform": what survives is
  // precisely the surviving component's own contribution, so a partial failure
  // costs that component's evidence and leaves the rest untouched. Comparing
  // against uniform would have been weaker AND wrong, since a quest-card
  // posterior can legitimately equal uniform on a board where its evidence
  // does not separate the feasible worlds.
  assert.deepEqual(
    snapshot.worlds.map((w) => w.probability),
    questWeightedBeliefModel.infer(view).worlds.map((w) => w.probability),
  )
})

test('every component failing is degraded, and silence is not', async () => {
  const view = await playedOut('combined-all-fail')
  const explode = (component: AnyCombinedComponent): AnyCombinedComponent => ({
    ...component,
    evidence: () => { throw new Error('injected') },
  })
  const allBroken = createCombinedBeliefModel(
    QUEST_AND_VOTE_GOOD_COMPONENTS.map(explode),
    { belief: 'combined-test-v1', bundle: 'combined-test-bundle-v1' },
  )
  const failed = allBroken.infer(view)
  assert.equal(failed.quality, 'degraded')
  assert.equal(failed.degradation.length, 2)

  // An opening board, where both components have evidence lists that are
  // legitimately empty. That must NOT read as degraded: nothing broke, and
  // conflating the two would make the degradation channel useless for
  // diagnosing which it was.
  const opening = viewFor(
    createGame({
      seed: 'combined-open',
      playerCount: 7,
      roles: [...SEVEN],
      talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
    }),
    0,
  )
  const quiet = questAndVoteGoodBeliefModel.infer(opening)
  assert.notEqual(quiet.quality, 'degraded')
  assert.deepEqual(
    quiet.worlds.map((w) => w.probability),
    exactBelief(opening).worlds.map((w) => w.probability),
  )
})

test('replaying the same view through the same versions is identical', async () => {
  const view = await playedOut('combined-replay')
  const first = questAndVoteGoodBeliefModel.infer(view)
  const second = questAndVoteGoodBeliefModel.infer(view)
  assert.deepEqual(
    first.worlds.map((w) => w.probability),
    second.worlds.map((w) => w.probability),
  )
  assert.deepEqual(first.provenance, second.provenance)
})
