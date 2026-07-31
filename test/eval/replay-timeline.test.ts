// test-lane: eval
// Migration phase 7R2C3; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgent } from '../../server/agents/registry.ts'
import { decisionTraceId, type DecisionTrace } from '../../server/agents/trace.ts'
import type {
  AppliedPlanHistoryEntry,
} from '../../server/agents/cognition/plan-memory.ts'
import {
  createGame,
  renamePlayer,
} from '../../server/engine/game.ts'
import {
  createIncrementalPlayerViewProjection,
} from '../../server/engine/view.ts'
import type {
  Decision,
  Seat,
  Visibility,
} from '../../server/engine/types.ts'
import { runGame } from '../../server/sim/runner.ts'
import {
  toArtifact,
  type GameArtifact,
} from '../../server/eval/artifact.ts'
import {
  decisionReplayTimeline,
  snapshotAt,
  type DecisionSnapshot,
  type ReplayOperationKind,
} from '../../server/eval/replay.ts'
import {
  authoritativeDecisionReplay,
  selectedDecisionReplayJoin,
} from '../../server/eval/trace-replay.ts'

const DECISION_EVENTS = new Set([
  'utterance',
  'proposal',
  'proposalLocked',
  'proposalRevised',
  'voteCast',
  'questCard',
  'assassination',
])

async function completedArtifact(
  seed: string,
  playerCount: number,
): Promise<GameArtifact> {
  const game = createGame({
    seed,
    playerCount,
    talk: {
      maxRounds: 1,
      maxRoundsAfterChange: 1,
      leaderInDiscussion: 'last',
    },
  })
  const agents = new Map(
    game.players.map((player) => [
      player.seat,
      createAgent(
        { type: 'heuristic' },
        { seed, seat: player.seat },
      ),
    ]),
  )
  const result = await runGame({ game, agents })
  return structuredClone(toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  }))
}

function cursor(snapshot: DecisionSnapshot): number {
  return snapshot.view.events.reduce(
    (highest, event) => Math.max(highest, event.seq),
    -1,
  )
}

function id(snapshot: DecisionSnapshot): string {
  return decisionTraceId(
    snapshot.req,
    snapshot.view,
    cursor(snapshot),
  )
}

const visibleTo = (visibility: Visibility, seat: Seat): boolean =>
  visibility === 'public' || visibility.only.includes(seat)

test('one timeline is byte-equivalent to every legacy decision snapshot', async () => {
  for (const [seed, playerCount] of [
    ['phase7r2c3-5', 5],
    ['phase7r2c3-7', 7],
    ['phase7r2c3-10', 10],
  ] as const) {
    const artifact = await completedArtifact(seed, playerCount)
    const observed = new Map<ReplayOperationKind, number>()
    const timeline = decisionReplayTimeline(artifact, {
      onOperation(kind) {
        observed.set(kind, (observed.get(kind) ?? 0) + 1)
      },
    })
    const decisionEvents = artifact.log.filter((event) =>
      DECISION_EVENTS.has(event.type))
    const authoritativeActions = artifact.log.filter((event) =>
      DECISION_EVENTS.has(event.type) || event.type === 'rename')

    assert.equal(timeline.snapshots.length, decisionEvents.length, seed)
    assert.equal(
      timeline.operations.logEventsScanned,
      artifact.log.length,
      seed,
    )
    assert.equal(
      timeline.operations.seatViewEventsProjected,
      artifact.log.length,
      seed,
    )
    assert.equal(
      timeline.operations.snapshotBytesEmitted,
      timeline.snapshots.reduce(
        (bytes, snapshot) =>
          bytes + Buffer.byteLength(JSON.stringify(snapshot.view), 'utf8'),
        0,
      ),
      seed,
    )
    assert.equal(
      timeline.operations.authoritativeActionsApplied,
      authoritativeActions.length,
      seed,
    )
    assert.equal(
      timeline.operations.authoritativeDecisionsCaptured,
      decisionEvents.length,
      seed,
    )
    assert.equal(timeline.operations.selectedActionsProbed, 0, seed)
    assert.equal(
      observed.get('log-event-scanned'),
      artifact.log.length,
      seed,
    )
    assert.equal(
      observed.get('seat-view-event-projected'),
      artifact.log.length,
      seed,
    )
    assert.equal(
      observed.get('authoritative-action-applied'),
      authoritativeActions.length,
      seed,
    )
    assert.equal(observed.get('selected-action-probed') ?? 0, 0, seed)

    for (const snapshot of timeline.snapshots) {
      const legacy = snapshotAt(artifact, snapshot.seq)
      assert.deepEqual(
        snapshot,
        legacy,
        `${seed}:${snapshot.seq}`,
      )
      assert.equal(
        JSON.stringify(snapshot),
        JSON.stringify(legacy),
        `${seed}:${snapshot.seq}: serialized bytes`,
      )
      assert.ok(
        snapshot.view.events.every((event) =>
          visibleTo(event.visibility, snapshot.seat)),
        `${seed}:${snapshot.seq}: filtered events`,
      )
      assert.ok(
        snapshot.view.players.every((player) =>
          !Object.hasOwn(player, 'role')
          && !Object.hasOwn(player, 'alignment')),
        `${seed}:${snapshot.seq}: no raw player truth`,
      )
    }
    assert.ok(
      artifact.log.some((event) => event.type === 'voteReveal'),
      `${seed}: engine-only event coverage`,
    )
    assert.ok(
      artifact.log.some((event) =>
        event.visibility !== 'public'),
      `${seed}: invisible event coverage`,
    )
  }
})

test('selected-decision joins reuse the same predecision timeline', async () => {
  const artifact = await completedArtifact('phase7r2c3-selected', 7)
  const baseline = decisionReplayTimeline(artifact)
  const selectedSnapshot = baseline.snapshots.find(
    (snapshot) => snapshot.kind === 'propose',
  )!
  const selectedOutcome = {
    resolution: 'selected-applied',
    selected: { decision: selectedSnapshot.original },
  } as unknown as AppliedPlanHistoryEntry
  const selectedTrace = {
    decisionId: id(selectedSnapshot),
    viewerSeat: selectedSnapshot.seat,
    privatePlanOutcome: selectedOutcome,
  } as unknown as DecisionTrace
  const selectedReplay = authoritativeDecisionReplay(
    artifact,
    selectedSnapshot.seat,
    [selectedTrace],
  )
  assert.equal(selectedReplay.operations.selectedActionsProbed, 1)
  assert.ok(selectedDecisionReplayJoin(
    selectedReplay,
    selectedReplay.snapshots.get(id(selectedSnapshot))!,
    selectedOutcome,
  ))

  const illegalDecision = {
    kind: 'assassinate',
    target: artifact.playerCount + 1,
  } as Decision
  const illegalOutcome = {
    resolution: 'fallback-after-illegal-decision',
    selected: { decision: illegalDecision },
  } as unknown as AppliedPlanHistoryEntry
  const illegalTrace = {
    decisionId: id(selectedSnapshot),
    viewerSeat: selectedSnapshot.seat,
    privatePlanOutcome: illegalOutcome,
  } as unknown as DecisionTrace
  const illegalReplay = authoritativeDecisionReplay(
    artifact,
    selectedSnapshot.seat,
    [illegalTrace],
  )
  assert.equal(illegalReplay.operations.selectedActionsProbed, 1)
  assert.ok(selectedDecisionReplayJoin(
    illegalReplay,
    illegalReplay.snapshots.get(id(selectedSnapshot))!,
    illegalOutcome,
  ))

  const agentError = {
    resolution: 'fallback-after-agent-error',
  } as unknown as AppliedPlanHistoryEntry
  assert.ok(selectedDecisionReplayJoin(
    illegalReplay,
    illegalReplay.snapshots.get(id(selectedSnapshot))!,
    agentError,
  ))
})

test('selected probes never cross the target-seat boundary', async () => {
  const artifact = await completedArtifact('phase7r2c3-cross-seat', 7)
  const questSnapshots = decisionReplayTimeline(artifact).snapshots.filter(
    (snapshot) => snapshot.kind === 'quest',
  )
  const target = questSnapshots[0]
  const other = questSnapshots.find(
    (snapshot) => snapshot.seat !== target.seat,
  )
  assert.ok(target)
  assert.ok(other)
  const otherOutcome = {
    resolution: 'selected-applied',
    selected: { decision: other.original },
  } as unknown as AppliedPlanHistoryEntry

  const relabelledTrace = {
    decisionId: id(other),
    viewerSeat: target.seat,
    privatePlanOutcome: otherOutcome,
  } as unknown as DecisionTrace
  const replay = authoritativeDecisionReplay(
    artifact,
    target.seat,
    [relabelledTrace],
  )
  assert.ok(
    [...replay.snapshots.values()].every(
      (snapshot) => snapshot.seat === target.seat,
    ),
  )
  assert.equal(replay.operations.selectedActionsProbed, 0)
  assert.equal(replay.selectedDecisions.has(id(other)), false)
  assert.equal(
    JSON.stringify([...replay.selectedDecisions]),
    '[]',
    'another seat quest-card probe result must not leave the target replay',
  )

  const honestlyLabelledOtherTrace = {
    ...relabelledTrace,
    viewerSeat: other.seat,
  } as unknown as DecisionTrace
  const filtered = authoritativeDecisionReplay(
    artifact,
    target.seat,
    [honestlyLabelledOtherTrace],
  )
  assert.equal(filtered.operations.selectedActionsProbed, 0)
  assert.equal(filtered.selectedDecisions.size, 0)
})

test('operation counts prove linear projection plus emitted bytes', async () => {
  const artifact = await completedArtifact('phase7r2c3-linear', 10)
  const timeline = decisionReplayTimeline(artifact)
  const decisions = timeline.snapshots.length
  const legacyPrefixApplications =
    decisions * (decisions - 1) / 2

  assert.ok(decisions > 2)
  assert.equal(
    timeline.operations.authoritativeActionsApplied,
    decisions,
  )
  assert.ok(
    timeline.operations.authoritativeActionsApplied
      < legacyPrefixApplications,
  )
  assert.equal(
    timeline.operations.logEventsScanned,
    artifact.log.length,
  )
  assert.equal(
    timeline.operations.seatViewEventsProjected,
    artifact.log.length,
  )
  assert.ok(timeline.operations.snapshotBytesEmitted > artifact.log.length)
})

test('incremental projection rejects another game and a rewritten prefix', () => {
  const game = createGame({
    seed: 'phase7r2c3-projector-binding',
    playerCount: 5,
  })
  let projected = 0
  const projection = createIncrementalPlayerViewProjection(
    game,
    () => projected++,
  )
  assert.equal(projected, game.log.length)
  assert.doesNotThrow(() => projection.viewFor(game, 0))
  assert.equal(projected, game.log.length)

  const impostor = structuredClone(game)
  assert.throws(
    () => projection.viewFor(impostor, 0),
    /projection game mismatch/,
  )

  const mutableGame = structuredClone(game)
  assert.throws(
    () => createIncrementalPlayerViewProjection(mutableGame),
    /projection mutable log/,
  )

  const originalLog = game.log
  const originalFirstEvent = game.log[0]
  assert.throws(() => {
    game.log[0] = {
      ...structuredClone(originalFirstEvent),
      visibility: { only: [0] },
    }
  })
  assert.throws(() => {
    game.log = game.log.slice()
  })
  const privateEvent = game.log.find(
    (event) => event.visibility !== 'public',
  )!
  assert.notEqual(privateEvent.visibility, 'public')
  if (privateEvent.visibility !== 'public') {
    assert.throws(() => privateEvent.visibility.only.push(0))
  }
  assert.equal(game.log, originalLog)
  assert.equal(game.log[0], originalFirstEvent)
  assert.doesNotThrow(() => projection.viewFor(game, 1))
})

test('renamed games preserve initial replay identity across artifact eras', async () => {
  const seed = 'phase7r2c3-rename'
  const game = createGame({
    seed,
    playerCount: 5,
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  })
  const initialName = game.players[0].name
  renamePlayer(game, 0, 'Renamed')
  const agents = new Map(
    game.players.map((player) => [
      player.seat,
      createAgent(
        { type: 'heuristic' },
        { seed, seat: player.seat },
      ),
    ]),
  )
  const result = await runGame({ game, agents })
  const artifact = toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })
  assert.equal(
    (artifact.log[0].payload.names as string[])[0],
    initialName,
  )
  assert.doesNotThrow(() => decisionReplayTimeline(artifact))

  const legacyAliasedArtifact = structuredClone(artifact)
  ;(legacyAliasedArtifact.log[0].payload.names as string[])[0] = 'Renamed'
  assert.doesNotThrow(
    () => decisionReplayTimeline(legacyAliasedArtifact),
  )
})

test('compatibility snapshot boundaries stay local while timelines fail closed', async () => {
  const artifact = await completedArtifact('phase7r2c3-boundary', 5)
  const first = decisionReplayTimeline(artifact).snapshots[0]
  const consequence = artifact.log.find(
    (event) => event.type === 'voteReveal',
  )!
  assert.throws(
    () => snapshotAt(artifact, consequence.seq),
    /not a decision event/,
  )

  const malformedTail = structuredClone(artifact)
  malformedTail.log.push({
    seq: malformedTail.log.length,
    type: 'leadChange',
    visibility: 'public',
    payload: { leader: 0 },
  })
  assert.deepEqual(
    snapshotAt(malformedTail, first.seq),
    first,
    'the compatibility wrapper preserves prefix-local behavior',
  )
  assert.throws(
    () => decisionReplayTimeline(malformedTail),
    /replay incomplete|replay drift/,
  )

  const historical = structuredClone(artifact)
  historical.schema = 2
  assert.throws(
    () => decisionReplayTimeline(historical),
    /below the replayable floor/,
  )
})
