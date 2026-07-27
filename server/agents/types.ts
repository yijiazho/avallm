// The agent plugin boundary (design doc §1 "Pluggable agents").
// An agent receives ONLY its seat's PlayerView — never raw Game state.

import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { ExperimentalBeliefMode } from './experimental.ts'
import type { DecisionTrace } from './trace.ts'

export interface AvalonAgent {
  decide(req: DecisionRequest, view: PlayerView): Promise<Decision>
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
  dispose?(): void
}

export type AgentSpec =
  | { type: 'heuristic' }
  | { type: 'random' }
  | { type: 'stdio'; cmd: string; args: string[]; label?: string }
  | { type: 'llm'; model: string; beliefMode?: ExperimentalBeliefMode }
  // Milestone 3: { type: 'human' } is constructed directly by the server/CLIs

export interface AgentContext {
  seed: string   // the game seed — agents derive their own RNG from it
  seat: number
  /** Private evaluation sink. It never enters PlayerView or engine state. */
  onDecisionTrace?: (trace: DecisionTrace) => void
}
