// Headless driver: pumps expectedDecisions through agents until gameOver.
// Simultaneous kinds (vote, quest) fan out in parallel — matches the rules
// and collapses the worst latency moments once agents are LLMs.
// Any agent failure or illegal decision degrades to the heuristic, loudly
// recorded — the game never stalls on a bad agent.

import { applyDecisionWithOutcome, expectedDecisions } from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import {
  normalizeAgentOutput,
  type AppliedDecisionResolution,
  type AvalonAgent,
} from '../agents/types.ts'
import {
  degradedAppliedOutcomeTrace,
  validateFinalizedAppliedTraceHostJoin,
  type DecisionTrace,
} from '../agents/trace.ts'
import type { Decision, DecisionRequest, Game, GameEvent, Seat } from '../engine/types.ts'

export interface DegradedDecision {
  seat: Seat
  kind: DecisionRequest['kind']
  atEvent: number
  error: string
}

export interface RunResult {
  game: Game
  degraded: DegradedDecision[]
  steps: number
}

export interface RunOpts {
  game: Game
  agents: Map<Seat, AvalonAgent>
  onEvent?: (ev: GameEvent) => void | Promise<void>
  /** Private trace sink; traces never enter Game or PlayerView. */
  onDecisionTrace?: (trace: DecisionTrace) => void
  maxSteps?: number
}

function recordFallbackTrace(
  agent: AvalonAgent,
  req: DecisionRequest,
  view: ReturnType<typeof viewFor>,
  decision: Decision,
): void {
  try {
    agent.recordFallbackTrace?.(req, view, decision)
  } catch {
    // Optional telemetry must never turn a legal fallback into a stalled game.
  }
}

function recordAppliedTrace(
  agent: AvalonAgent,
  trace: DecisionTrace | undefined,
  sink: RunOpts['onDecisionTrace'],
): void {
  if (!trace) return
  try {
    if (sink) sink(trace)
    else agent.recordDecisionTrace?.(trace)
  } catch {
    // Optional telemetry must never turn a legal action into a stalled game.
  }
}

function finalizeAppliedTrace(
  agent: AvalonAgent,
  input: {
    req: DecisionRequest
    view: ReturnType<typeof viewFor>
    selectedDecision?: Decision
    appliedDecision: Decision
    resolution: AppliedDecisionResolution
    trace?: DecisionTrace
  },
): DecisionTrace | undefined {
  if (!agent.recordAppliedDecisionOutcome) {
    return input.resolution === 'selected-applied' ? input.trace : undefined
  }
  try {
    const hostOutcome = {
      request: { ...input.req },
      view: structuredClone(input.view),
      ...(input.selectedDecision
        ? { selectedDecision: structuredClone(input.selectedDecision) }
        : {}),
      appliedDecision: structuredClone(input.appliedDecision),
      resolution: input.resolution,
      ...(input.trace
        ? { provisionalTrace: structuredClone(input.trace) }
        : {}),
    }
    const finalized = agent.recordAppliedDecisionOutcome(
      structuredClone(hostOutcome),
    )
    const detached = finalized ? structuredClone(finalized) : undefined
    return detached
      && validateFinalizedAppliedTraceHostJoin(
        detached,
        hostOutcome,
      )
      ? detached
      : degradedAppliedOutcomeTrace(
          input.trace,
          input.appliedDecision,
          input.resolution,
        )
  } catch {
    return degradedAppliedOutcomeTrace(
      input.trace,
      input.appliedDecision,
      input.resolution,
    )
  }
}

export async function runGame(opts: RunOpts): Promise<RunResult> {
  const { game, agents } = opts
  const maxSteps = opts.maxSteps ?? 5000
  const degraded: DegradedDecision[] = []
  let steps = 0
  let emitted = 0

  const flushEvents = async () => {
    if (!opts.onEvent) return
    while (emitted < game.log.length) {
      await opts.onEvent(game.log[emitted++])
    }
  }
  await flushEvents()

  const decideOne = async (
    req: DecisionRequest,
  ): Promise<{
    req: DecisionRequest
    view: ReturnType<typeof viewFor>
    agent: AvalonAgent
    decision: Decision
    trace?: DecisionTrace
    selected: boolean
  }> => {
    const view = viewFor(game, req.seat)
    const agent = agents.get(req.seat)
    if (!agent) throw new Error(`no agent for seat ${req.seat}`)
    try {
      const output = normalizeAgentOutput(await agent.decide(req, view))
      const decision = output.decision
      return { req, view, agent, decision, trace: output.trace, selected: true }
    } catch (err) {
      degraded.push({
        seat: req.seat, kind: req.kind, atEvent: game.log.length,
        error: err instanceof Error ? err.message : String(err),
      })
      const decision = heuristicDecide(req, view, game.seed)
      recordFallbackTrace(agent, req, view, decision)
      return { req, view, agent, decision, selected: false }
    }
  }

  while (game.phase !== 'gameOver') {
    if (++steps > maxSteps) {
      throw new Error(`game exceeded ${maxSteps} decision steps — engine stuck?`)
    }
    const reqs = expectedDecisions(game)
    if (reqs.length === 0) throw new Error(`no expected decisions in phase ${game.phase}`)

    // All current requests are independent (same phase), so resolve together.
    const results = reqs.length === 1
      ? [await decideOne(reqs[0])]
      : await Promise.all(reqs.map(decideOne))

    for (const { req, view, agent, decision, trace, selected } of results) {
      let appliedDecision: Decision
      let resolution: AppliedDecisionResolution
      let selectedDecision: Decision | undefined
      try {
        appliedDecision = applyDecisionWithOutcome(
          game,
          req.seat,
          decision,
        ).appliedDecision
        selectedDecision = selected ? decision : undefined
        resolution = selected
          ? 'selected-applied'
          : 'fallback-after-agent-error'
      } catch (err) {
        // Illegal decision (bad team, bad target...): substitute the heuristic.
        degraded.push({
          seat: req.seat, kind: req.kind, atEvent: game.log.length,
          error: err instanceof Error ? err.message : String(err),
        })
        const fallback = heuristicDecide(req, viewFor(game, req.seat), game.seed)
        recordFallbackTrace(agent, req, view, fallback)
        appliedDecision = applyDecisionWithOutcome(
          game,
          req.seat,
          fallback,
        ).appliedDecision
        selectedDecision = decision
        resolution = 'fallback-after-illegal-decision'
      }
      // Optional cognition and telemetry are outside the legality transaction.
      const finalized = finalizeAppliedTrace(agent, {
        req,
        view,
        ...(selectedDecision ? { selectedDecision } : {}),
        appliedDecision,
        resolution,
        trace,
      })
      recordAppliedTrace(agent, finalized, opts.onDecisionTrace)
      await flushEvents()
    }
  }

  for (const agent of agents.values()) agent.dispose?.()
  return { game, degraded, steps }
}
