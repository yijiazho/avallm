// The agent plugin boundary (design doc §1 "Pluggable agents").
// An agent receives ONLY its seat's PlayerView — never raw Game state.

import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { LlmBrainConfig } from './brain.ts'
import type { AppliedDecisionOutcome, DecisionTrace } from './trace.ts'

// The applied-decision resolution vocabulary and outcome shape live below this
// boundary so private cognition and the trace module can name them without
// importing this file back. They are re-exported here because callers have
// always read them from `./types.ts`.
export {
  APPLIED_DECISION_RESOLUTIONS,
  isAppliedDecisionResolution,
} from './applied-decision.ts'
export type { AppliedDecisionResolution } from './applied-decision.ts'
export type { AppliedDecisionOutcome } from './trace.ts'

export interface AvalonAgent {
  /**
   * Every agent returns the trace-bearing envelope. An agent with nothing to
   * report supplies only the decision. Outside producers may still send a
   * bare decision on the wire; `parseExternalDecisionReply` converts at that
   * boundary, so runners never see two shapes.
   */
  decide(req: DecisionRequest, view: PlayerView): Promise<AgentDecision>
  /**
   * The single trace-lifecycle hook. Hosts never call it directly: they call
   * recordAppliedDecision() (server/agents/applied-trace.ts), which invokes it
   * exactly once per decision and only after the engine has accepted an
   * action, so no trace can describe a rejected one. What it returns is the
   * finalized record and may differ from the provisional envelope trace;
   * undefined declines to acknowledge, which the host records as degraded
   * rather than trusting the provisional trace.
   */
  finalizeAppliedTrace?(
    outcome: AppliedDecisionOutcome,
  ): DecisionTrace | undefined
  /**
   * Private trace sink of last resort, used only when the host provides none.
   * A destination, not part of the lifecycle: the host still owns what gets
   * persisted and when.
   */
  privateTraceSink?(trace: DecisionTrace): void
}

/** The one shape decide() returns: the engine action plus private telemetry. */
export interface AgentDecision {
  decision: Decision
  trace?: DecisionTrace
}

/**
 * Named opt-in composed-brain configurations. A preset, not an open component
 * bag: the registry owns the wiring so no caller can seat a half-configured
 * stack, and each preset names exactly one measured evaluation arm.
 *
 * `good-base` is the Phase 4 structured good scorer. `full-role` is the
 * complete Phase 7F role stack behind one immutable scorer identity. Neither is
 * the default; promotion remains a separate decision with paired evidence.
 */
export const COMPOSED_BRAIN_PRESETS = Object.freeze(
  ['good-base', 'full-role'] as const,
)

/** Derived from the list, so the two can never name different sets. */
export type ComposedBrainPreset = (typeof COMPOSED_BRAIN_PRESETS)[number]

export type AgentSpec =
  | { type: 'heuristic' }
  | { type: 'random' }
  | {
      type: 'llm'
      model: string
      brain?: LlmBrainConfig
    }
  /** API-free structured brain. It makes no model call on its own. */
  | { type: 'composed'; brain: ComposedBrainPreset }
  // Milestone 3: { type: 'human' } is constructed directly by the server/CLIs

export interface AgentContext {
  seed: string   // the game seed — agents derive their own RNG from it
  seat: number
  /** Private evaluation sink. It never enters PlayerView or engine state. */
  onDecisionTrace?: (trace: DecisionTrace) => void
}
