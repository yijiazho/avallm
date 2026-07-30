import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composedBrainOptions,
  createAgent,
} from '../server/agents/registry.ts'
import {
  COMPOSED_BRAIN_PRESETS,
  normalizeAgentOutput,
  type ComposedBrainPreset,
} from '../server/agents/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import {
  fullRolePolicyScorer,
  goodProposalVoteScorer,
} from '../server/agents/policy/score.ts'
import {
  phase7FullRoleVariantsFor,
  PHASE7_FULL_ROLE_VARIANTS,
} from '../server/eval/phase7-full-role-bench.ts'
import { createGame, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { Role } from '../server/engine/types.ts'

const ROLES: Role[] = [
  'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon',
]

function proposal() {
  const game = createGame({
    seed: 'composed-spec',
    playerCount: 7,
    roles: ROLES,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const req = expectedDecisions(game)[0]
  return { game, req, view: viewFor(game, req.seat) }
}

test('every composed preset resolves an executable brain', async () => {
  const input = proposal()
  for (const preset of COMPOSED_BRAIN_PRESETS) {
    const output = normalizeAgentOutput(await createAgent(
      { type: 'composed', brain: preset },
      { seed: input.game.seed, seat: input.req.seat },
    ).decide(input.req, input.view))
    assert.equal(output.decision.kind, input.req.kind, preset)
    // A proposal is inside both presets' own decision kinds, so each terminal
    // resolves itself rather than falling back.
    assert.equal(
      output.trace?.componentVersions?.scorer,
      preset === 'full-role'
        ? fullRolePolicyScorer.version
        : goodProposalVoteScorer.version,
      preset,
    )
  }
})

test('an unknown preset cannot reach the composed constructor', () => {
  assert.throws(
    () => composedBrainOptions('imaginary' as ComposedBrainPreset),
    /unsupported composed brain preset/,
  )
})

/**
 * The seated preset and the measured evaluation arm must be the same
 * configuration. Comparing resolved architecture identities pins the whole
 * component graph, score-layer order, and pipeline, not just the scorer name,
 * so a demo cannot quietly seat a stack nobody benchmarked.
 */
test('the full-role preset is the configuration the bench measures', () => {
  const seated = projectResolvedArchitectureIdentity(
    createComposedAgent({
      seed: 'identity',
      ...composedBrainOptions('full-role'),
    }).resolvedBrain().description,
  )
  const measured = phase7FullRoleVariantsFor('merlin').find(
    (variant) => variant.id === PHASE7_FULL_ROLE_VARIANTS.fullRole,
  )!
  const benched = projectResolvedArchitectureIdentity(
    (measured.createTargetAgent!({ seed: 'identity', seat: 0 }) as unknown as {
      resolvedBrain(): { description: Parameters<
        typeof projectResolvedArchitectureIdentity
      >[0] }
    }).resolvedBrain().description,
  )
  assert.deepEqual(seated, benched)
})

test('the good-base preset is the composed Phase 4 arm', () => {
  const seated = projectResolvedArchitectureIdentity(
    createComposedAgent({
      seed: 'identity',
      ...composedBrainOptions('good-base'),
    }).resolvedBrain().description,
  )
  const measured = phase7FullRoleVariantsFor('merlin').find(
    (variant) => variant.id === PHASE7_FULL_ROLE_VARIANTS.baseComposed,
  )!
  const benched = projectResolvedArchitectureIdentity(
    (measured.createTargetAgent!({ seed: 'identity', seat: 0 }) as unknown as {
      resolvedBrain(): { description: Parameters<
        typeof projectResolvedArchitectureIdentity
      >[0] }
    }).resolvedBrain().description,
  )
  assert.deepEqual(seated, benched)
})
