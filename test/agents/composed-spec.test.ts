// test-lane: eval
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composedBrainOptions,
  createAgent,
} from '../../server/agents/registry.ts'
import {
  COMPOSED_BRAIN_PRESETS,
  type ComposedBrainPreset,
} from '../../server/agents/types.ts'
import { createComposedAgent } from '../../server/agents/composed.ts'
import {
  revalidatedArchitectureIdentity,
} from '../../server/agents/components/resolved-brain.ts'
import {
  fullRolePolicyScorer,
  goodProposalVoteScorer,
} from '../../server/agents/policy/score.ts'
import {
  phase7FullRoleVariantsFor,
  PHASE7_FULL_ROLE_VARIANTS,
} from '../../server/eval/full-role-bench.ts'
import { createGame, expectedDecisions } from '../../server/engine/game.ts'
import { viewFor } from '../../server/engine/view.ts'
import type { Role } from '../../server/engine/types.ts'

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
    const output = await createAgent(
      { type: 'composed', brain: preset },
      { seed: input.game.seed, seat: input.req.seat },
    ).decide(input.req, input.view)
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

const presetIdentity = (preset: ComposedBrainPreset) =>
  revalidatedArchitectureIdentity(
    createComposedAgent({
      seed: 'identity',
      ...composedBrainOptions(preset),
    }).resolvedBrain().description,
  )

/**
 * `ArchitectureVariant.createTargetAgent` is declared to return the plain agent
 * boundary, so a bench arm's resolved brain is reachable only by naming the
 * composed constructor's own return type.
 */
const variantIdentity = (variantId: string) => {
  const variant = phase7FullRoleVariantsFor('merlin').find(
    (candidate) => candidate.id === variantId,
  )
  assert.ok(variant?.createTargetAgent, `${variantId} is not a bench arm`)
  const agent = variant.createTargetAgent({
    seed: 'identity',
    seat: 0,
  }) as ReturnType<typeof createComposedAgent>
  return revalidatedArchitectureIdentity(agent.resolvedBrain().description)
}

/**
 * The seated preset and the measured evaluation arm must be the same
 * configuration. Comparing resolved architecture identities pins the whole
 * component graph, score-layer order, and pipeline, not just the scorer name,
 * so a demo cannot quietly seat a stack nobody benchmarked.
 */
test('the full-role preset is the configuration the bench measures', () => {
  assert.deepEqual(
    presetIdentity('full-role'),
    variantIdentity(PHASE7_FULL_ROLE_VARIANTS.fullRole),
  )
})

test('the good-base preset is the composed Phase 4 arm', () => {
  assert.deepEqual(
    presetIdentity('good-base'),
    variantIdentity(PHASE7_FULL_ROLE_VARIANTS.baseComposed),
  )
})
