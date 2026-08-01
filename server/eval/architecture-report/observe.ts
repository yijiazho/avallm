// One archived game in, one GameObservation out. The only place the report
// reads a raw artifact.
//
// Everything downstream of here aggregates: summarize.ts folds observations
// into variants, render.ts spells them. That separation matters because the
// walk below is where a per-game figure is DEFINED, and a definition that also
// lived in the aggregator would have two homes. The clean-proposal count, the
// vote confusion, the planner override, and the regret series are each computed
// once here from the log and the admitted traces, so a question about what a
// published number counts has exactly one file to read.
//
// The walk is also the point where trace evidence stops being self-reported:
// safety.ts runs first and only its admitted traces reach the metrics below, so
// a trace that failed attribution cannot contribute a regret sample or an
// override to any number this report publishes.

import {
  computeMetrics,
} from '../core/metrics.ts'
import {
  artifactPlayerAt,
  type GameArtifact,
} from '../core/artifact.ts'
import {
  countVoteByDirection,
  emptyVoteConfusion,
  teamIsDirty,
} from '../runs/vote-direction.ts'
import type {
  DecisionKind,
  GameEvent,
  Seat,
} from '../../engine/types.ts'
import {
  snapshotDecisionTraceInput,
} from '../../agents/admission/composed-trace.ts'
import type {
  ArchitectureModelSummary,
  GameObservation,
} from './types.ts'
import {
  artifactArchitectureAdmission,
} from './artifact-admission.ts'
import {
  architectureSafety,
} from './safety.ts'

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

// The seat that ACTED in an event, narrowed off the discriminated payload, or
// undefined for events with no single actor (voteReveal, questResult, game
// setup/over). Fed to actionKind, which only compares it against the target.
function actorSeatOf(ev: GameEvent): Seat | undefined {
  switch (ev.type) {
    case 'proposal':
    case 'proposalLocked':
    case 'proposalRevised':
      return ev.payload.leader
    case 'assassination':
      return ev.payload.assassin
    case 'utterance':
    case 'voteCast':
    case 'questCard':
    case 'thinking':
    case 'scratchpad':
    case 'roleDealt':
    case 'knowledge':
    case 'leadChange':
    case 'rename':
      return ev.payload.seat
    case 'gameCreated':
    case 'voteReveal':
    case 'questResult':
    case 'gameOver':
      return undefined
  }
}

function actionKind(a: GameArtifact, type: string, seat: unknown): DecisionKind | undefined {
  const target = a.architecture!.targetSeat
  if (seat !== target) return undefined
  switch (type) {
    case 'utterance': return 'discuss'
    case 'proposal': return 'propose'
    case 'proposalLocked':
    case 'proposalRevised': return 'finalize'
    case 'voteCast': return 'vote'
    case 'questCard': return 'quest'
    case 'assassination': return 'assassinate'
    default: return undefined
  }
}

export function observe(a: GameArtifact): GameObservation {
  const meta = a.architecture
  if (!meta) throw new Error(`artifact ${a.id} has no architecture metadata`)
  const architectureAdmission = artifactArchitectureAdmission(a)
  const traceCandidates = (a.decisionTraces ?? []).map((trace) =>
    snapshotDecisionTraceInput(trace))
  const player = a.players[meta.targetSeat]
  if (!player || player.role !== meta.targetRole) {
    throw new Error(`${a.id}: architecture target seat/role does not match the archived deal`)
  }
  const traceSafety = architectureSafety(
    a,
    meta,
    architectureAdmission,
    traceCandidates,
  )
  const decisionTraces = traceSafety.traces
  const metrics = computeMetrics(a)
  const seatMetrics = metrics.seats.find((seat) => seat.seat === meta.targetSeat)
  if (!seatMetrics) {
    throw new Error(`${a.id}: metrics are missing target seat ${meta.targetSeat}`)
  }
  const decisions = new Map<string, number>()
  let cleanInitialProposals = 0
  let initialProposals = 0
  const voteConfusion = emptyVoteConfusion()
  for (const ev of a.log) {
    const seat = actorSeatOf(ev)
    const kind = actionKind(a, ev.type, seat)
    if (kind) increment(decisions, kind)
    if (ev.type === 'proposal' && ev.payload.leader === meta.targetSeat) {
      initialProposals++
      if (
        ev.payload.team.every(
          (teamSeat) => artifactPlayerAt(a, teamSeat).alignment === 'good',
        )
      ) {
        cleanInitialProposals++
      }
    }
    if (ev.type === 'voteReveal') {
      const targetVote = ev.payload.votes
        .find((vote) => vote.seat === meta.targetSeat)
      if (targetVote) {
        countVoteByDirection(
          voteConfusion,
          targetVote.vote,
          teamIsDirty(a.players, ev.payload.team, a.id),
        )
      }
    }
  }

  let plannerOverrides = 0
  let plannerSelections = 0
  let seededVoteVariations = 0
  let scoredVotes = 0
  const proposalCleanProbabilities: number[] = []
  const proposalPosteriorRegrets: number[] = []
  const voteUtilityRegrets: number[] = []
  for (const trace of decisionTraces) {
    if (
      trace.plannerCandidateId
      && trace.plannerCandidateId === trace.chosenCandidateId
    ) {
      plannerSelections++
      if (trace.chosenCandidateId !== trace.structuredCandidateId) {
        plannerOverrides++
      }
    }
    const chosen = trace.candidateScores?.find(
      (score) => score.candidateId === trace.chosenCandidateId,
    )
    if (chosen?.features?.version === 'good-proposal-features-v1') {
      proposalCleanProbabilities.push(chosen.features.cleanProbability)
      const best = Math.max(
        ...trace.candidateScores!
          .filter(
            (score) =>
              score.viable
              && score.features?.version === 'good-proposal-features-v1',
          )
          .flatMap((score) =>
            score.features?.version === 'good-proposal-features-v1'
              ? [score.features.cleanProbability]
              : []),
      )
      proposalPosteriorRegrets.push(
        Math.max(0, best - chosen.features.cleanProbability),
      )
    }
    if (chosen?.features?.version === 'good-vote-features-v1') {
      scoredVotes++
      if (
        chosen.features.selectionMode === 'seeded-band'
        && chosen.features.inViableBand
        && chosen.features.seedBucket !== undefined
      ) {
        seededVoteVariations++
      }
      const best = Math.max(
        ...trace.candidateScores!
          .filter(
            (score) =>
              score.features?.version === 'good-vote-features-v1',
          )
          .flatMap((score) =>
            score.features?.version === 'good-vote-features-v1'
              ? [score.features.baseUtility]
              : []),
      )
      voteUtilityRegrets.push(
        Math.max(0, best - chosen.features.baseUtility),
      )
    }
  }
  const latencyMs = (
    a.telemetry?.decisionLatency?.samples ?? []
  ).map((sample) => sample.milliseconds).filter(
    (milliseconds) =>
      Number.isFinite(milliseconds) && milliseconds >= 0,
  )

  const calls = new Map<string, { calls: number; cost: number }>()
  const models = new Map<string, ArchitectureModelSummary>()
  let cost = 0
  let callCount = 0
  for (const [tag, spend] of Object.entries(a.telemetry?.llm?.tags ?? {})) {
    const kind = tag.slice(tag.lastIndexOf('/') + 1)
    const kindAgg = calls.get(kind) ?? { calls: 0, cost: 0 }
    kindAgg.calls += spend.calls
    kindAgg.cost += spend.cost
    calls.set(kind, kindAgg)
    const model = meta.components.model ?? spend.model
    const modelAgg = models.get(model) ?? {
      model, calls: 0, cost: 0, promptTokens: 0, completionTokens: 0,
      reasoningTokens: 0, reasoningLeaks: 0,
    }
    modelAgg.calls += spend.calls
    modelAgg.cost += spend.cost
    modelAgg.promptTokens += spend.prompt
    modelAgg.completionTokens += spend.completion
    modelAgg.reasoningTokens += spend.reasoning
    modelAgg.reasoningLeaks += spend.reasoningLeakCalls
    models.set(model, modelAgg)
    cost += spend.cost
    callCount += spend.calls
  }

  return {
    artifact: a,
    decisionTraces,
    meta,
    architectureAdmission,
    won: player.alignment === a.winner,
    voteScore: seatMetrics.voteScore,
    forced: seatMetrics.forcedPlayViolations,
    degraded: a.degraded.filter((d) => d.seat === meta.targetSeat).length,
    decisions,
    calls,
    models,
    cost,
    callCount,
    cleanInitialProposals,
    initialProposals,
    voteConfusion,
    plannerOverrides,
    plannerSelections,
    seededVoteVariations,
    scoredVotes,
    proposalCleanProbabilities,
    proposalPosteriorRegrets,
    voteUtilityRegrets,
    latencyMs,
    safety: traceSafety.safety,
  }
}
