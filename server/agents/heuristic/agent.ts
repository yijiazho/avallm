import type { AgentContext, AvalonAgent } from '../types.ts'
import { heuristicDecide } from '../policy/heuristic-fallback.ts'

/** Construct the selectable deterministic baseline around the shared fallback. */
export function createHeuristicAgent(ctx: AgentContext): AvalonAgent {
  return {
    decide: async (req, view) => ({
      decision: heuristicDecide(req, view, ctx.seed),
    }),
  }
}
