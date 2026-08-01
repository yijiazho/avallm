// test-lane: eval
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgent } from '../../server/agents/registry.ts'
import { createComposedAgent } from '../../server/agents/composed.ts'
import {
  upsertDecisionTrace,
  type DecisionTrace,
} from '../../server/agents/trace.ts'
import { createGame } from '../../server/engine/game.ts'
import { toArtifact } from '../../server/eval/core/artifact.ts'
import { runGame } from '../../server/sim/runner.ts'
import type { AvalonAgent } from '../../server/agents/types.ts'
import type { Seat } from '../../server/engine/types.ts'

test('artifact manifests retain models embedded in definition descriptors', async () => {
  const game = createGame({
    seed: 'descriptor-models',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    createAgent({ type: 'heuristic' }, { seed: game.seed, seat: player.seat }),
  ]))
  const result = await runGame({ game, agents })
  const artifact = toArtifact(result.game, {
    agents: result.game.players.map((_, seat) => seat === 0
      ? 'def:probabilistic-llm:llm:kimi'
      : seat === 1 ? 'llm:deepseek-pro' : 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })

  assert.deepEqual(artifact.strategyVersions?.models, ['deepseek-pro', 'kimi'])
  assert.deepEqual(artifact.traceDegraded, [])
})

test('artifact separates composed trace degradation from runner fallback', async () => {
  const game = createGame({
    seed: 'trace-degradation-summary',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const decisionTraces: DecisionTrace[] = []
  const target = game.leaderSeat
  const agents = new Map<Seat, AvalonAgent>(game.players.map((player) => [
    player.seat,
    player.seat === target
      ? createComposedAgent({
          seed: game.seed,
          onDecisionTrace: (trace) => upsertDecisionTrace(decisionTraces, trace),
          planner: {
            version: 'invalid-test-planner-v1',
            async choose() {
              return { candidateId: 'not-a-candidate' }
            },
          },
        })
      : createAgent(
          { type: 'heuristic' },
          { seed: game.seed, seat: player.seat },
        ),
  ]))
  const result = await runGame({ game, agents })
  const artifact = toArtifact(result.game, {
    agents: result.game.players.map((_, seat) =>
      seat === target ? 'composed:test' : 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
    decisionTraces,
  })

  assert.deepEqual(artifact.degraded, [])
  assert.ok(artifact.traceDegraded?.length)
  assert.ok(artifact.traceDegraded.every((entry) =>
    entry.codes.includes('planner-invalid-candidate')))
})
