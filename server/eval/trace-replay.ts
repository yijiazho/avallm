import { isDeepStrictEqual } from 'node:util'
import { applyDecisionWithOutcome } from '../engine/game.ts'
import type { AppliedPlanHistoryEntry } from '../agents/cognition/plan-memory.ts'
import {
  decisionTraceId,
  type DecisionTrace,
} from '../agents/trace.ts'
import type { GameArtifact } from './artifact.ts'
import {
  replayGame,
  snapshotAt,
  type DecisionSnapshot,
} from './replay.ts'
import type { Seat } from '../engine/types.ts'

const DECISION_EVENT_TYPES = new Set([
  'utterance',
  'proposal',
  'proposalLocked',
  'proposalRevised',
  'voteCast',
  'questCard',
  'assassination',
])

function viewCursor(snapshot: DecisionSnapshot): number {
  return snapshot.view.events.reduce(
    (cursor, event) => Math.max(cursor, event.seq),
    -1,
  )
}

/**
 * Reconstruct the complete expected target-seat trace set from authoritative
 * action events. Trace payloads are deliberately not consulted.
 */
export function authoritativeDecisionSnapshots(
  artifact: GameArtifact,
  targetSeat: Seat,
): ReadonlyMap<string, DecisionSnapshot> {
  const snapshots = new Map<string, DecisionSnapshot>()
  for (const event of artifact.log) {
    if (!DECISION_EVENT_TYPES.has(event.type)) continue
    const snapshot = snapshotAt(artifact, event.seq)
    if (snapshot.seat !== targetSeat) continue
    const id = decisionTraceId(
      snapshot.req,
      snapshot.view,
      viewCursor(snapshot),
    )
    if (snapshots.has(id)) {
      throw new Error(`duplicate authoritative decision identity ${id}`)
    }
    snapshots.set(id, snapshot)
  }
  return snapshots
}

export function exactTargetTraceCoverage(
  snapshots: ReadonlyMap<string, DecisionSnapshot>,
  traces: readonly DecisionTrace[],
  targetSeat: Seat,
): boolean {
  if (traces.length !== snapshots.size) return false
  const counts = new Map<string, number>()
  for (const trace of traces) {
    if (trace.viewerSeat !== targetSeat || !snapshots.has(trace.decisionId)) {
      return false
    }
    counts.set(trace.decisionId, (counts.get(trace.decisionId) ?? 0) + 1)
  }
  return [...snapshots.keys()].every((id) => counts.get(id) === 1)
}

export function decisionTraceReplayJoin(
  snapshot: DecisionSnapshot | undefined,
  trace: DecisionTrace,
): boolean {
  return !!snapshot
    && trace.viewerSeat === snapshot.seat
    && isDeepStrictEqual(trace.request, snapshot.req)
    && trace.beliefThroughSeq === viewCursor(snapshot)
    && isDeepStrictEqual(trace.action, snapshot.original)
}

/**
 * Re-run the selected decision against the exact predecision state. This
 * proves selected-applied normalization and illegal-fallback non-mutation
 * without trusting either the trace action or serialized outcome labels.
 */
export function selectedDecisionReplayJoin(
  artifact: GameArtifact,
  snapshot: DecisionSnapshot,
  outcome: AppliedPlanHistoryEntry,
): boolean {
  if (outcome.resolution === 'fallback-after-agent-error') {
    return outcome.selected === undefined
  }
  if (!outcome.selected) return false
  const game = replayGame(artifact, snapshot.firstSeq)
  const before = structuredClone(game)
  try {
    const applied = applyDecisionWithOutcome(
      game,
      snapshot.seat,
      outcome.selected.decision,
    ).appliedDecision
    return (
      outcome.resolution === 'selected-applied'
      && isDeepStrictEqual(applied, snapshot.original)
    )
  } catch {
    return (
      outcome.resolution === 'fallback-after-illegal-decision'
      && isDeepStrictEqual(game, before)
    )
  }
}
