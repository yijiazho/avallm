// test-lane: eval
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgent } from '../../server/agents/registry.ts'
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
})
