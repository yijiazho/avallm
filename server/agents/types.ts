// The agent plugin boundary (design doc §1 "Pluggable agents").
// An agent receives ONLY its seat's PlayerView — never raw Game state.

import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { ExperimentalBeliefMode } from './experimental.ts'
import type { LlmBrainConfig } from './brain.ts'
import type { DecisionTrace } from './trace.ts'

export interface AvalonAgent {
  /**
   * Legacy agents may return a bare Decision. Composed agents return the
   * trace-bearing envelope. Runners normalize both during the migration.
   */
  decide(req: DecisionRequest, view: PlayerView): Promise<AgentOutput>
  /** Persist a trace supplied through AgentDecision in the private sink. */
  recordDecisionTrace?(trace: DecisionTrace): void
  /**
   * Optional private telemetry hook. Runners call this only when the decision
   * ultimately applied was their heuristic fallback rather than decide()'s
   * result. It does not affect gameplay or enter PlayerView.
   */
  recordFallbackTrace?(
    req: DecisionRequest,
    view: PlayerView,
    decision: Decision,
  ): void
  /**
   * Private post-legality acknowledgment. Runners invoke it only after the
   * applied decision has passed engine legality. A returned detached trace is
   * the finalized trace that runners persist in place of the provisional one.
   */
  recordAppliedDecisionOutcome?(
    outcome: AppliedDecisionOutcome,
  ): DecisionTrace | undefined
  dispose?(): void
}

export type AppliedDecisionResolution =
  | 'selected-applied'
  | 'fallback-after-agent-error'
  | 'fallback-after-illegal-decision'

export interface AppliedDecisionOutcome {
  request: DecisionRequest
  view: PlayerView
  selectedDecision?: Decision
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  provisionalTrace?: DecisionTrace
}

export interface AgentDecision {
  decision: Decision
  trace?: DecisionTrace
}

export type AgentOutput = Decision | AgentDecision

export function isAgentDecision(output: AgentOutput): output is AgentDecision {
  return (
    typeof output === 'object'
    && output !== null
    && 'decision' in output
    && typeof output.decision === 'object'
    && output.decision !== null
  )
}

export function normalizeAgentOutput(output: AgentOutput): AgentDecision {
  return isAgentDecision(output) ? output : { decision: output }
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
export type ComposedBrainPreset = 'good-base' | 'full-role'

export const COMPOSED_BRAIN_PRESETS: readonly ComposedBrainPreset[] =
  Object.freeze(['good-base', 'full-role'])

export type AgentSpec =
  | { type: 'heuristic' }
  | { type: 'random' }
  | { type: 'stdio'; cmd: string; args: string[]; label?: string }
  | {
      type: 'llm'
      model: string
      brain?: LlmBrainConfig
      beliefMode?: ExperimentalBeliefMode
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
