// test-lane: contract
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAgent } from '../server/agents/registry.ts'
import { createLlmAgent } from '../server/agents/llm.ts'
import { BELIEF_RENDERER_VERSION } from '../server/agents/communication/belief-summary.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  createDecisionTrace,
  upsertDecisionTrace,
  type DecisionTrace,
} from '../server/agents/trace.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { runGame } from '../server/sim/runner.ts'
import { appendArtifact, readArtifacts, toArtifact } from '../server/eval/artifact.ts'
import { snapshotAt } from '../server/eval/replay.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import type { Seat } from '../server/engine/types.ts'

test('optional private traces round-trip in artifacts and replay to the same decision view', async () => {
  const game = createGame({ seed: 'trace-roundtrip', playerCount: 5 })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createAgent({ type: 'heuristic' }, { seed: game.seed, seat: player.seat }),
    ]),
  )
  const result = await runGame({ game, agents })
  const baseArtifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })
  const firstAction = baseArtifact.log.find((event) =>
    ['proposal', 'utterance', 'voteCast', 'questCard'].includes(event.type))!
  const snapshot = snapshotAt(baseArtifact, firstAction.seq)
  const cognition = reconstructCognition(snapshot.view)
  const analysis = analyzeSituation(snapshot.view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    candidateTeams: snapshot.original.kind === 'propose'
      ? [snapshot.original.team]
      : [],
  })
  const trace = createDecisionTrace(
    snapshot.req,
    snapshot.view,
    cognition.belief,
    analysis,
    snapshot.original,
  )
  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
    decisionTraces: [trace],
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-trace-'))
  const file = path.join(dir, 'artifact.jsonl')
  appendArtifact(file, artifact)
  const back = readArtifacts(file)[0]
  assert.deepEqual(back.decisionTraces, [trace])
  const replayed = snapshotAt(back, firstAction.seq)
  assert.deepEqual(replayed.trace, trace)
  assert.equal(replayed.trace?.beliefThroughSeq, cognition.throughSeq)
  assert.deepEqual(replayed.trace?.action, snapshot.original)
})

test('trace and cognition fields never enter PlayerView serialization', () => {
  const game = createGame({ seed: 'trace-leak', playerCount: 5 })
  const serialized = JSON.stringify(
    game.players.map((player) => viewFor(game, player.seat)),
  )
  assert.ok(!serialized.includes('decisionTrace'))
  assert.ok(!serialized.includes('beliefModelVersion'))
  assert.ok(!serialized.includes('CognitionState'))
})

test('runner fallback preserves the ultimate action in a degraded trace', async () => {
  const game = createGame({ seed: 'trace-runner-fallback', playerCount: 5 })
  const traces: DecisionTrace[] = []
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      player.seat === game.leaderSeat
        ? createLlmAgent({
            modelId: 'deepseek-flash',
            client: {
              async call() {
                return JSON.stringify({ unusable: true })
              },
              getTotalCost: () => 0,
              getSpend: () => ({}),
            },
            brain: { beliefVisibility: BELIEF_RENDERER_VERSION },
            onDecisionTrace: (trace) => upsertDecisionTrace(traces, trace),
          })
        : createAgent(
            { type: 'heuristic' },
            { seed: game.seed, seat: player.seat },
          ),
    ]),
  )
  const result = await runGame({ game, agents })
  const fallbackTrace = traces.find((trace) =>
    trace.degradation.includes('decision-fallback'))
  assert.ok(fallbackTrace)
  assert.ok(fallbackTrace.degradation.includes('decision-retry'))

  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'test'),
    degraded: result.degraded,
    steps: result.steps,
    decisionTraces: traces,
  })
  const actionEvents = artifact.log.filter((event) =>
    [
      'utterance',
      'proposal',
      'proposalLocked',
      'proposalRevised',
      'voteCast',
      'questCard',
      'assassination',
    ].includes(event.type))
  const associated = actionEvents
    .map((event) => snapshotAt(artifact, event.seq))
    .find((snapshot) => snapshot.trace?.decisionId === fallbackTrace.decisionId)
  assert.ok(associated)
  assert.deepEqual(associated.original, fallbackTrace.action)
})
