// Headless driver: pumps expectedDecisions through agents until gameOver.
// Simultaneous kinds (vote, quest) fan out in parallel — matches the rules
// and collapses the worst latency moments once agents are LLMs.
// Any agent failure or illegal decision degrades to the heuristic, loudly
// recorded — the game never stalls on a bad agent.

import { applyDecisionWithOutcome, expectedDecisions } from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import { heuristicDecide } from '../agents/heuristic.ts'
import type { AvalonAgent } from '../agents/types.ts'
import { recordAppliedDecision } from '../agents/applied-trace.ts'
import type { DecisionTrace } from '../agents/trace.ts'
import type { Decision, DecisionRequest, Game, GameEvent, PlayerView, Seat } from '../engine/types.ts'

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

// What one agent produced for one request, before the engine has ruled on it.
// `selected` records whether this came from the agent (true) or is already a
// heuristic stand-in because the agent's decide() threw (false).
interface DecideOutcome {
  req: DecisionRequest
  /** The view the agent decided from, captured before any action applied. */
  view: PlayerView
  agent: AvalonAgent
  decision: Decision
  trace?: DecisionTrace
  selected: boolean
}

// How the engine resolved one DecideOutcome. Each member names one resolution
// and carries only the decisions meaningful for it, so there is no field that
// means different things per branch:
//  - selected-applied: the agent's decision was accepted unchanged.
//  - fallback-after-agent-error: decide() threw, a heuristic stood in; there
//    is no agent decision to report.
//  - fallback-after-illegal-decision: the agent's decision was rejected as
//    illegal and a heuristic stood in; `rejectedDecision` is that rejected one.
type ApplyResolution =
  | { resolution: 'selected-applied'; appliedDecision: Decision; agentDecision: Decision }
  | { resolution: 'fallback-after-agent-error'; appliedDecision: Decision }
  | { resolution: 'fallback-after-illegal-decision'; appliedDecision: Decision; rejectedDecision: Decision }

export async function runGame(opts: RunOpts): Promise<RunResult> {
  const { game, agents } = opts
  const maxSteps = opts.maxSteps ?? 5000
  const degraded: DegradedDecision[] = []
  let steps = 0
  let emitted = 0

  const flushEvents = async () => {
    if (!opts.onEvent) return
    while (emitted < game.log.length) {
      await opts.onEvent(game.log[emitted++]!)
    }
  }
  await flushEvents()

  const decideOne = async (req: DecisionRequest): Promise<DecideOutcome> => {
    const view = viewFor(game, req.seat)
    const agent = agents.get(req.seat)
    if (!agent) throw new Error(`no agent for seat ${req.seat}`)
    try {
      const output = await agent.decide(req, view)
      const decision = output.decision
      return {
        req,
        view,
        agent,
        decision,
        ...(output.trace === undefined ? {} : { trace: output.trace }),
        selected: true,
      }
    } catch (err) {
      degraded.push({
        seat: req.seat, kind: req.kind, atEvent: game.log.length,
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        req,
        view,
        agent,
        decision: heuristicDecide(req, view, game.seed),
        selected: false,
      }
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
      ? [await decideOne(reqs[0]!)]
      : await Promise.all(reqs.map(decideOne))

    for (const { req, view, agent, decision, trace, selected } of results) {
      let applied: ApplyResolution
      try {
        const appliedDecision = applyDecisionWithOutcome(
          game,
          req.seat,
          decision,
        ).appliedDecision
        applied = selected
          ? { resolution: 'selected-applied', appliedDecision, agentDecision: decision }
          : { resolution: 'fallback-after-agent-error', appliedDecision }
      } catch (err) {
        // Illegal decision (bad team, bad target...): substitute the heuristic.
        degraded.push({
          seat: req.seat, kind: req.kind, atEvent: game.log.length,
          error: err instanceof Error ? err.message : String(err),
        })
        const fallback = heuristicDecide(req, viewFor(game, req.seat), game.seed)
        const appliedDecision = applyDecisionWithOutcome(
          game,
          req.seat,
          fallback,
        ).appliedDecision
        applied = { resolution: 'fallback-after-illegal-decision', appliedDecision, rejectedDecision: decision }
      }
      // The agent's own decision, if we have one to report: the accepted
      // selection, or the one the engine rejected as illegal. Absent when
      // decide() failed outright (a heuristic stood in with no agent decision).
      const selectedDecision =
        applied.resolution === 'selected-applied' ? applied.agentDecision
        : applied.resolution === 'fallback-after-illegal-decision' ? applied.rejectedDecision
        : undefined
      // Optional cognition and telemetry are outside the legality transaction:
      // one call owns finalizing and persisting, and it runs only now that the
      // engine has accepted an action.
      recordAppliedDecision({
        agent,
        req,
        view,
        ...(selectedDecision ? { selectedDecision } : {}),
        appliedDecision: applied.appliedDecision,
        resolution: applied.resolution,
        ...(trace ? { provisionalTrace: trace } : {}),
        ...(opts.onDecisionTrace ? { sink: opts.onDecisionTrace } : {}),
      })
      await flushEvents()
    }
  }

  return { game, degraded, steps }
}
