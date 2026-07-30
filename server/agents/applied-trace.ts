// The post-legality trace lifecycle, owned in one place (design doc §9).
//
// Every host (the sim runner, the web server's pump, the eval drivers) calls
// recordAppliedDecision() once per decision, AFTER the engine has accepted an
// action. Everything the boundary used to spread across three optional agent
// methods and duplicate in each runner lives here: detach the host's own
// request, view, and action so a hook cannot reach back into them; ask the
// agent to finalize; check the finalized trace still joins to what the engine
// accepted; degrade instead of trusting a mismatch; then persist. A runner that
// forgets a step is no longer possible, because there is one step.

import {
  bindFallbackAppliedTrace,
  degradedAppliedOutcomeTrace,
  validateFinalizedAppliedTraceHostJoin,
  type DecisionTrace,
} from './trace.ts'
import type {
  AppliedDecisionOutcome,
  AppliedDecisionResolution,
  AvalonAgent,
} from './types.ts'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'

export interface AppliedDecisionInput {
  agent: AvalonAgent
  req: DecisionRequest
  /** The view the agent decided from, captured before the action applied. */
  view: PlayerView
  /** The agent's own decision, absent when decide() failed outright. */
  selectedDecision?: Decision
  /** What the engine accepted; it can differ from the selection. */
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  /** The trace carried by the decide() envelope, if the agent sent one. */
  provisionalTrace?: DecisionTrace
  /** Host sink. Without one, the agent's private sink is used instead. */
  sink?: (trace: DecisionTrace) => void
}

function finalize(input: AppliedDecisionInput): DecisionTrace | undefined {
  const hook = input.agent.finalizeAppliedTrace
  if (!hook) {
    // No acknowledgment: the envelope trace stands for an accepted selection,
    // and a trace for a rejected action is dropped rather than relabeled.
    return input.resolution === 'selected-applied'
      ? input.provisionalTrace
      : undefined
  }
  try {
    const hostOutcome: AppliedDecisionOutcome = {
      request: { ...input.req },
      view: structuredClone(input.view),
      ...(input.selectedDecision
        ? { selectedDecision: structuredClone(input.selectedDecision) }
        : {}),
      appliedDecision: structuredClone(input.appliedDecision),
      resolution: input.resolution,
      ...(input.provisionalTrace
        ? { provisionalTrace: structuredClone(input.provisionalTrace) }
        : {}),
    }
    // The hook gets its own copy, so mutating it cannot move the host's join.
    const supplied = hook.call(input.agent, structuredClone(hostOutcome))
    const returned = supplied ? structuredClone(supplied) : undefined
    if (input.provisionalTrace) {
      return returned
        && validateFinalizedAppliedTraceHostJoin(returned, hostOutcome)
        ? returned
        : degradedAppliedOutcomeTrace(
            input.provisionalTrace,
            input.appliedDecision,
            input.resolution,
          )
    }
    // decide() produced no trace, so there is no provisional record to join
    // against and nothing to degrade from either. An agent may still hand back
    // its own account of a fallback it did not choose; bind that to the accepted
    // action so every persisted trace names what the engine actually applied.
    // Only a fallback earns that lane: at 'selected-applied' the agent had the
    // envelope and declined it, so an unjoinable trace stays dropped.
    return returned && input.resolution !== 'selected-applied'
      ? bindFallbackAppliedTrace(
          returned,
          input.appliedDecision,
          input.resolution,
        )
      : undefined
  } catch {
    return degradedAppliedOutcomeTrace(
      input.provisionalTrace,
      input.appliedDecision,
      input.resolution,
    )
  }
}

/**
 * Finalize and persist the private trace for a decision the engine already
 * accepted. Returns the persisted trace so a host that keeps its own store can
 * record it, and never throws: private telemetry must never turn a legal
 * action into a stalled game.
 */
export function recordAppliedDecision(
  input: AppliedDecisionInput,
): DecisionTrace | undefined {
  let finalized: DecisionTrace | undefined
  try {
    finalized = finalize(input)
  } catch {
    return undefined
  }
  if (!finalized) return undefined
  try {
    if (input.sink) input.sink(finalized)
    else input.agent.privateTraceSink?.(finalized)
  } catch {
    // Optional telemetry must never turn a legal action into a stalled game.
  }
  return finalized
}
