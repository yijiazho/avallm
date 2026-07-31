import { isDeepStrictEqual } from 'node:util'
import type { AppliedPlanHistoryEntry } from '../../agents/cognition/plan-memory.ts'
import {
  decisionTraceId,
  type DecisionTrace,
} from '../../agents/trace.ts'
import type { GameArtifact } from '../core/artifact.ts'
import {
  decisionReplayTimeline,
  type DecisionSnapshot,
  type ReplayOperationCounts,
  type SelectedDecisionProbe,
  type SelectedDecisionReplay,
} from './replay.ts'
import type { Seat } from '../../engine/types.ts'

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
  return authoritativeDecisionReplay(
    artifact,
    targetSeat,
    [],
  ).snapshots
}

export interface AuthoritativeDecisionReplay {
  snapshots: ReadonlyMap<string, DecisionSnapshot>
  selectedDecisions: ReadonlyMap<string, SelectedDecisionReplay>
  operations: ReplayOperationCounts
}

/**
 * Build the complete authoritative target-seat decision timeline in one
 * replay. Optional selected plan outcomes are probed against their exact
 * predecision states during the same pass.
 */
export function authoritativeDecisionReplay(
  artifact: GameArtifact,
  targetSeat: Seat,
  traces: readonly DecisionTrace[],
): AuthoritativeDecisionReplay {
  const selectedProbes: SelectedDecisionProbe[] = []
  const selectedIds = new Set<string>()
  for (const trace of traces) {
    if (trace.viewerSeat !== targetSeat) continue
    const selected = trace.privatePlanOutcome?.selected?.decision
    if (!selected) continue
    if (selectedIds.has(trace.decisionId)) {
      throw new Error(
        `duplicate selected decision identity ${trace.decisionId}`,
      )
    }
    selectedIds.add(trace.decisionId)
    selectedProbes.push({
      targetSeat,
      decisionId: trace.decisionId,
      decision: selected,
    })
  }
  const timeline = decisionReplayTimeline(artifact, {
    selectedDecisions: selectedProbes,
  })
  const snapshots = new Map<string, DecisionSnapshot>()
  for (const snapshot of timeline.snapshots) {
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
  return Object.freeze({
    snapshots,
    selectedDecisions: new Map(
      [...timeline.selectedDecisions].filter(
        ([, selected]) => selected.targetSeat === targetSeat,
      ),
    ),
    operations: timeline.operations,
  })
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
  replayOrArtifact:
    | Pick<AuthoritativeDecisionReplay, 'selectedDecisions'>
    | GameArtifact,
  snapshot: DecisionSnapshot,
  outcome: AppliedPlanHistoryEntry,
): boolean {
  if (outcome.resolution === 'fallback-after-agent-error') {
    return outcome.selected === undefined
  }
  if (!outcome.selected) return false
  const id = decisionTraceId(
    snapshot.req,
    snapshot.view,
    viewCursor(snapshot),
  )
  const replay = 'selectedDecisions' in replayOrArtifact
    ? replayOrArtifact
    : authoritativeDecisionReplay(
        replayOrArtifact,
        snapshot.seat,
        [{
          decisionId: id,
          viewerSeat: snapshot.seat,
          privatePlanOutcome: outcome,
        } as DecisionTrace],
      )
  const selected = replay.selectedDecisions.get(id)
  return selected?.status === 'applied'
    ? (
        selected.targetSeat === snapshot.seat
        && outcome.resolution === 'selected-applied'
        && isDeepStrictEqual(
          selected.appliedDecision,
          snapshot.original,
        )
      )
    : (
        selected?.status === 'rejected'
        && selected.targetSeat === snapshot.seat
        && outcome.resolution === 'fallback-after-illegal-decision'
        && selected.stateUnchanged
      )
}
