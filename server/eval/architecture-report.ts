// Compact, machine-readable architecture comparison report.
//
// The report is intentionally narrower than report.ts: it summarizes only the
// role seat selected by each architecture-bank case and groups operational
// results by role, decision/call kind, model, and component-version bundle.

import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readArtifacts } from './artifact.ts'
import { computeMetrics } from './metrics.ts'
import type { ArchitectureRunMetadata, GameArtifact } from './artifact.ts'
import type { DecisionKind, Role } from '../engine/types.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from '../agents/belief/language-factor.ts'
import {
  validatePublicObserverSnapshot,
} from '../agents/analysis/observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../agents/analysis/observer-types.ts'

export const ARCHITECTURE_REPORT_SCHEMA = 2

export interface RateEstimate {
  successes: number
  trials: number
  rate: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface RateDeltaEstimate {
  delta: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface LatencySummary {
  samples: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface ArchitectureDecisionQuality {
  targetWinRate: RateEstimate
  cleanInitialProposalRate: RateEstimate
  voteTruthAccuracy: RateEstimate
  plannerOverrideRate: RateEstimate
  seededVoteVariationRate: RateEstimate
  voteApproveRate: RateEstimate
  meanProposalCleanProbability: number | null
  meanProposalPosteriorRegret: number | null
  meanVoteUtilityRegret: number | null
}

export interface ArchitectureSafetySummary {
  hiddenInformationChecks: number
  hiddenInformationViolations: number
  traceAttributionChecks: number
  traceAttributionViolations: number
}

export interface ArchitectureRoleSummary {
  role: Role
  games: number
  wins: number
  voteScore: number | null
  forcedViolations: number
  degraded: number
  calls: number
  cost: number
  decisionQuality: ArchitectureDecisionQuality
  latency: LatencySummary
  safety: ArchitectureSafetySummary
}

export interface ArchitectureKindSummary {
  kind: string
  decisions: number
  calls: number
  degraded: number
  cost: number
}

export interface ArchitectureModelSummary {
  model: string
  calls: number
  cost: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  reasoningLeaks: number
}

export interface ArchitectureVariantSummary {
  id: string
  components: Record<string, string>
  games: number
  wins: number
  forcedViolations: number
  degraded: number
  calls: number
  cost: number
  decisionQuality: ArchitectureDecisionQuality
  latency: LatencySummary
  safety: ArchitectureSafetySummary
  byRole: ArchitectureRoleSummary[]
  byKind: ArchitectureKindSummary[]
  byModel: ArchitectureModelSummary[]
}

export interface ArchitectureComparison {
  baseline: string
  candidate: string
  matchedCases: number
  wins: number
  forcedViolations: number
  degraded: number
  cost: number
  targetWinRateDelta: RateDeltaEstimate
  cleanInitialProposalRateDelta: RateDeltaEstimate
  voteTruthAccuracyDelta: RateDeltaEstimate
}

export interface ArchitectureBenchmarkReport {
  schema: number
  bank: string
  cases: string[]
  variants: ArchitectureVariantSummary[]
  comparisons: ArchitectureComparison[]
}

interface GameObservation {
  artifact: GameArtifact
  meta: ArchitectureRunMetadata
  won: boolean
  voteScore: number | null
  forced: number
  degraded: number
  decisions: Map<string, number>
  calls: Map<string, { calls: number; cost: number }>
  models: Map<string, ArchitectureModelSummary>
  cost: number
  callCount: number
  cleanInitialProposals: number
  initialProposals: number
  correctVotes: number
  votes: number
  plannerOverrides: number
  plannerSelections: number
  seededVoteVariations: number
  scoredVotes: number
  approveVotes: number
  proposalCleanProbabilities: number[]
  proposalPosteriorRegrets: number[]
  voteUtilityRegrets: number[]
  latencyMs: number[]
  safety: ArchitectureSafetySummary
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount)
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

function publicSpeech(trace: NonNullable<GameArtifact['decisionTraces']>[number]): string {
  const action = trace.action
  if (action.kind === 'discuss') return action.say ?? ''
  if (action.kind === 'propose') return action.pitch ?? ''
  if (action.kind === 'finalize') return action.reason ?? ''
  return ''
}

function architectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
): ArchitectureSafetySummary {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const publicLog = JSON.stringify(
    artifact.log.filter((event) => event.visibility === 'public'),
  )
  if (
    /decisionTrace|candidateScores|topHypotheses|communicationIntent|beliefProvenance|beliefPlayerMarginals|beliefTeamAssessments|publicObserver/.test(
      publicLog,
    )
  ) {
    hiddenInformationViolations++
  }
  const traces = artifact.decisionTraces ?? []
  const declaresBoundedLanguage =
    meta.components.languageEvidence === LANGUAGE_FACTOR_BUNDLE_VERSION
  const declaresPublicObserver =
    meta.components.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
  if (
    (declaresBoundedLanguage || declaresPublicObserver)
    && traces.length === 0
  ) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  for (const trace of traces) {
    traceAttributionChecks++
    const versions = trace.componentVersions
    const languageEnabled = declaresBoundedLanguage
    const stableKeys = [
      'brain',
      'factors',
      'languageEvidence',
      ...(meta.components.observerModel === undefined
        ? []
        : ['observerModel']),
      'policy',
      'scorer',
      'planner',
      'voice',
      ...(languageEnabled
        ? ['mechanicalBelief', 'beliefPipeline']
        : ['belief']),
    ]
    const invalidDeclaration = languageEnabled
      ? (
          meta.components.belief !== undefined
          || !meta.components.mechanicalBelief
          || !meta.components.beliefPipeline
        )
      : (
          meta.components.mechanicalBelief !== undefined
          || meta.components.beliefPipeline !== undefined
        )
    const invalidTraceShape = languageEnabled
      ? (
          !versions?.mechanicalBelief
          || !versions.beliefPipeline
        )
      : (
          versions?.mechanicalBelief !== undefined
          || versions?.beliefPipeline !== undefined
        )
    if (
      trace.viewerSeat !== meta.targetSeat
      || trace.agentMode !== meta.components.mode
      || !versions
      || versions.belief !== trace.beliefModelVersion
      || invalidDeclaration
      || invalidTraceShape
      || (
        declaresPublicObserver
          ? !validatePublicObserverSnapshot(trace.publicObserver)
          : trace.publicObserver !== undefined
      )
      || stableKeys.some(
        (key) =>
          versions[key as keyof typeof versions]
          !== meta.components[key],
      )
    ) {
      traceAttributionViolations++
    }
    const speech = publicSpeech(trace)
    if (!speech) continue
    hiddenInformationChecks++
    const intent = trace.communicationIntent
    const numericSecrets = [
      ...(intent?.uncertainty
        ? Object.values(intent.uncertainty)
            .filter(
              (value): value is number =>
                typeof value === 'number'
                && Number.isFinite(value)
                && !Number.isInteger(value),
            )
            .map(String)
        : []),
      ...((trace.beliefPlayerMarginals ?? [])
        .flatMap((marginal) => [
          marginal.goodProbability,
          marginal.evilProbability,
        ])
        .filter((value) => !Number.isInteger(value))
        .map(String)),
    ]
    const forbidden = [
      trace.beliefModelVersion,
      ...trace.topHypotheses.map((hypothesis) => hypothesis.worldKey),
      ...(intent?.conceal ?? []),
      ...numericSecrets,
    ].filter((value) => value.length > 0)
    if (forbidden.some((value) => speech.includes(value))) {
      hiddenInformationViolations++
    }
  }
  return {
    hiddenInformationChecks,
    hiddenInformationViolations,
    traceAttributionChecks,
    traceAttributionViolations,
  }
}

function observe(a: GameArtifact): GameObservation {
  const meta = a.architecture
  if (!meta) throw new Error(`artifact ${a.id} has no architecture metadata`)
  const player = a.players[meta.targetSeat]
  if (!player || player.role !== meta.targetRole) {
    throw new Error(`${a.id}: architecture target seat/role does not match the archived deal`)
  }
  const metrics = computeMetrics(a)
  const seatMetrics = metrics.seats[meta.targetSeat]
  const decisions = new Map<string, number>()
  let cleanInitialProposals = 0
  let initialProposals = 0
  let correctVotes = 0
  let votes = 0
  let approveVotes = 0
  for (const ev of a.log) {
    const p = ev.payload
    const seat = ev.type === 'proposal' || ev.type === 'proposalLocked' || ev.type === 'proposalRevised'
      ? p.leader
      : ev.type === 'assassination'
        ? p.assassin
        : p.seat
    const kind = actionKind(a, ev.type, seat)
    if (kind) increment(decisions, kind)
    if (ev.type === 'proposal' && p.leader === meta.targetSeat) {
      initialProposals++
      if (
        (p.team as number[]).every(
          (teamSeat) => a.players[teamSeat].alignment === 'good',
        )
      ) {
        cleanInitialProposals++
      }
    }
    if (ev.type === 'voteReveal') {
      const targetVote = (
        p.votes as Array<{ seat: number; vote: string }>
      ).find((vote) => vote.seat === meta.targetSeat)
      if (targetVote) {
        const teamHasEvil = (p.team as number[]).some(
          (teamSeat) => a.players[teamSeat].alignment === 'evil',
        )
        votes++
        if (targetVote.vote === 'approve') approveVotes++
        if ((targetVote.vote === 'reject') === teamHasEvil) {
          correctVotes++
        }
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
  for (const trace of a.decisionTraces ?? []) {
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
          .map((score) => score.features!.cleanProbability),
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
          .map((score) => score.features!.baseUtility),
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
    meta,
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
    correctVotes,
    votes,
    plannerOverrides,
    plannerSelections,
    seededVoteVariations,
    scoredVotes,
    approveVotes,
    proposalCleanProbabilities,
    proposalPosteriorRegrets,
    voteUtilityRegrets,
    latencyMs,
    safety: architectureSafety(a, meta),
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function rate(successes: number, trials: number): RateEstimate {
  if (!trials) {
    return { successes, trials, rate: null, interval95: null }
  }
  const estimate = successes / trials
  const z = 1.959963984540054
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (estimate + z2 / (2 * trials)) / denominator
  const radius = z * Math.sqrt(
    estimate * (1 - estimate) / trials
    + z2 / (4 * trials * trials),
  ) / denominator
  return {
    successes,
    trials,
    rate: estimate,
    interval95: {
      low: Math.max(0, center - radius),
      high: Math.min(1, center + radius),
    },
  }
}

function nearestRank(values: readonly number[], probability: number): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(
    0,
    Math.ceil(probability * ordered.length) - 1,
  )]
}

interface RateCount {
  successes: number
  trials: number
}

function seededState(value: string): number {
  let state = 2166136261
  for (const character of value) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  return state >>> 0 || 1
}

function pairedBootstrapRateDelta(
  pairs: readonly Readonly<{
    baseline: GameObservation
    candidate: GameObservation
  }>[],
  select: (game: GameObservation) => RateCount,
  seed: string,
): RateDeltaEstimate {
  const aggregate = (
    selected: readonly GameObservation[],
  ): RateCount => selected.reduce<RateCount>(
    (total, game) => {
      const value = select(game)
      return {
        successes: total.successes + value.successes,
        trials: total.trials + value.trials,
      }
    },
    { successes: 0, trials: 0 },
  )
  const baseline = aggregate(pairs.map((pair) => pair.baseline))
  const candidate = aggregate(pairs.map((pair) => pair.candidate))
  if (!pairs.length || !baseline.trials || !candidate.trials) {
    return { delta: null, interval95: null }
  }
  const delta =
    candidate.successes / candidate.trials
    - baseline.successes / baseline.trials
  let state = seededState(seed)
  const random = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const samples: number[] = []
  for (let repetition = 0; repetition < 5_000; repetition++) {
    const selected: Array<(typeof pairs)[number]> = []
    for (let index = 0; index < pairs.length; index++) {
      selected.push(pairs[Math.floor(random() * pairs.length)])
    }
    const sampledBaseline = aggregate(
      selected.map((pair) => pair.baseline),
    )
    const sampledCandidate = aggregate(
      selected.map((pair) => pair.candidate),
    )
    if (!sampledBaseline.trials || !sampledCandidate.trials) continue
    samples.push(
      sampledCandidate.successes / sampledCandidate.trials
      - sampledBaseline.successes / sampledBaseline.trials,
    )
  }
  return {
    delta,
    interval95: samples.length
      ? {
          low: nearestRank(samples, 0.025)!,
          high: nearestRank(samples, 0.975)!,
        }
      : null,
  }
}

function latency(games: readonly GameObservation[]): LatencySummary {
  const values = games.flatMap((game) => game.latencyMs)
  return {
    samples: values.length,
    medianMs: values.length
      ? values.length % 2
        ? [...values].sort((left, right) => left - right)[
            Math.floor(values.length / 2)
          ]
        : (() => {
            const ordered = [...values].sort((left, right) => left - right)
            const middle = values.length / 2
            return (ordered[middle - 1] + ordered[middle]) / 2
          })()
      : null,
    p95Ms: nearestRank(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  }
}

function decisionQuality(
  games: readonly GameObservation[],
): ArchitectureDecisionQuality {
  const sum = (select: (game: GameObservation) => number) =>
    games.reduce((total, game) => total + select(game), 0)
  return {
    targetWinRate: rate(
      games.filter((game) => game.won).length,
      games.length,
    ),
    cleanInitialProposalRate: rate(
      sum((game) => game.cleanInitialProposals),
      sum((game) => game.initialProposals),
    ),
    voteTruthAccuracy: rate(
      sum((game) => game.correctVotes),
      sum((game) => game.votes),
    ),
    plannerOverrideRate: rate(
      sum((game) => game.plannerOverrides),
      sum((game) => game.plannerSelections),
    ),
    seededVoteVariationRate: rate(
      sum((game) => game.seededVoteVariations),
      sum((game) => game.scoredVotes),
    ),
    voteApproveRate: rate(
      sum((game) => game.approveVotes),
      sum((game) => game.votes),
    ),
    meanProposalCleanProbability: mean(
      games.flatMap((game) => game.proposalCleanProbabilities),
    ),
    meanProposalPosteriorRegret: mean(
      games.flatMap((game) => game.proposalPosteriorRegrets),
    ),
    meanVoteUtilityRegret: mean(
      games.flatMap((game) => game.voteUtilityRegrets),
    ),
  }
}

function safety(
  games: readonly GameObservation[],
): ArchitectureSafetySummary {
  return games.reduce<ArchitectureSafetySummary>(
    (summary, game) => ({
      hiddenInformationChecks:
        summary.hiddenInformationChecks
        + game.safety.hiddenInformationChecks,
      hiddenInformationViolations:
        summary.hiddenInformationViolations
        + game.safety.hiddenInformationViolations,
      traceAttributionChecks:
        summary.traceAttributionChecks
        + game.safety.traceAttributionChecks,
      traceAttributionViolations:
        summary.traceAttributionViolations
        + game.safety.traceAttributionViolations,
    }),
    {
      hiddenInformationChecks: 0,
      hiddenInformationViolations: 0,
      traceAttributionChecks: 0,
      traceAttributionViolations: 0,
    },
  )
}

function summarizeVariant(id: string, games: GameObservation[]): ArchitectureVariantSummary {
  const componentKeys = games.map((g) => JSON.stringify(g.meta.components))
  if (new Set(componentKeys).size !== 1) {
    throw new Error(`variant ${id} has inconsistent component versions`)
  }
  const roles = [...new Set(games.map((g) => g.meta.targetRole))].sort()
  const kinds = [...new Set(games.flatMap((g) => [
    ...g.decisions.keys(),
    ...g.calls.keys(),
    ...g.artifact.degraded
      .filter((d) => d.seat === g.meta.targetSeat)
      .map((d) => d.kind),
  ]))].sort()
  const modelIds = [...new Set(games.flatMap((g) => [...g.models.keys()]))].sort()

  return {
    id,
    components: { ...games[0].meta.components },
    games: games.length,
    wins: games.filter((g) => g.won).length,
    forcedViolations: games.reduce((sum, g) => sum + g.forced, 0),
    degraded: games.reduce((sum, g) => sum + g.degraded, 0),
    calls: games.reduce((sum, g) => sum + g.callCount, 0),
    cost: games.reduce((sum, g) => sum + g.cost, 0),
    decisionQuality: decisionQuality(games),
    latency: latency(games),
    safety: safety(games),
    byRole: roles.map((role) => {
      const selected = games.filter((g) => g.meta.targetRole === role)
      return {
        role,
        games: selected.length,
        wins: selected.filter((g) => g.won).length,
        voteScore: mean(selected.map((g) => g.voteScore).filter((v): v is number => v !== null)),
        forcedViolations: selected.reduce((sum, g) => sum + g.forced, 0),
        degraded: selected.reduce((sum, g) => sum + g.degraded, 0),
        calls: selected.reduce((sum, g) => sum + g.callCount, 0),
        cost: selected.reduce((sum, g) => sum + g.cost, 0),
        decisionQuality: decisionQuality(selected),
        latency: latency(selected),
        safety: safety(selected),
      }
    }),
    byKind: kinds.map((kind) => ({
      kind,
      decisions: games.reduce((sum, g) => sum + (g.decisions.get(kind) ?? 0), 0),
      calls: games.reduce((sum, g) => sum + (g.calls.get(kind)?.calls ?? 0), 0),
      degraded: games.reduce(
        (sum, g) => sum + g.artifact.degraded.filter(
          (d) => d.seat === g.meta.targetSeat && d.kind === kind,
        ).length,
        0,
      ),
      cost: games.reduce((sum, g) => sum + (g.calls.get(kind)?.cost ?? 0), 0),
    })),
    byModel: modelIds.map((model) => {
      const entries = games.map((g) => g.models.get(model)).filter((v): v is ArchitectureModelSummary => !!v)
      return {
        model,
        calls: entries.reduce((sum, entry) => sum + entry.calls, 0),
        cost: entries.reduce((sum, entry) => sum + entry.cost, 0),
        promptTokens: entries.reduce((sum, entry) => sum + entry.promptTokens, 0),
        completionTokens: entries.reduce((sum, entry) => sum + entry.completionTokens, 0),
        reasoningTokens: entries.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
        reasoningLeaks: entries.reduce((sum, entry) => sum + entry.reasoningLeaks, 0),
      }
    }),
  }
}

function assertMatched(a: GameObservation, b: GameObservation): void {
  const comparable = {
    seed: a.artifact.seed,
    playerCount: a.artifact.playerCount,
    roles: a.artifact.roles,
    talk: a.artifact.talk,
    deal: a.artifact.players.map((p) => p.role),
    targetRole: a.meta.targetRole,
    targetSeat: a.meta.targetSeat,
    names: a.artifact.players.map((p) => p.name),
    opponents: a.artifact.players.map((p) => p.seat === a.meta.targetSeat ? '<variant>' : p.agent),
  }
  const other = {
    seed: b.artifact.seed,
    playerCount: b.artifact.playerCount,
    roles: b.artifact.roles,
    talk: b.artifact.talk,
    deal: b.artifact.players.map((p) => p.role),
    targetRole: b.meta.targetRole,
    targetSeat: b.meta.targetSeat,
    names: b.artifact.players.map((p) => p.name),
    opponents: b.artifact.players.map((p) => p.seat === b.meta.targetSeat ? '<variant>' : p.agent),
  }
  if (JSON.stringify(comparable) !== JSON.stringify(other)) {
    throw new Error(`${a.meta.caseId}: variants are not matched on deal and table configuration`)
  }
}

export function architectureReport(artifacts: readonly GameArtifact[]): ArchitectureBenchmarkReport {
  if (!artifacts.length) throw new Error('architecture report requires at least one artifact')
  const games = artifacts.map(observe)
  const banks = new Set(games.map((g) => g.meta.bank))
  if (banks.size !== 1) throw new Error('architecture report cannot mix seed banks')
  const cells = new Set<string>()
  for (const game of games) {
    const cell = `${game.meta.variant}\0${game.meta.caseId}`
    if (cells.has(cell)) {
      throw new Error(
        `duplicate architecture result for variant ${game.meta.variant}, case ${game.meta.caseId}`,
      )
    }
    cells.add(cell)
  }
  const caseIds = [...new Set(games.map((g) => g.meta.caseId))].sort()
  // Preserve artifact order: the runner writes the declared baseline first.
  // Alphabetical sorting can silently turn "candidate" into the baseline.
  const variantIds = [...new Set(games.map((g) => g.meta.variant))]
  const byVariant = new Map(
    variantIds.map((id) => [id, games.filter((game) => game.meta.variant === id)]),
  )
  const variants = variantIds.map((id) => summarizeVariant(id, byVariant.get(id)!))

  const comparisons: ArchitectureComparison[] = []
  if (variantIds.length > 1) {
    const baseline = variantIds[0]
    const baselineByCase = new Map(byVariant.get(baseline)!.map((g) => [g.meta.caseId, g]))
    for (const candidate of variantIds.slice(1)) {
      const pairs = byVariant.get(candidate)!.flatMap((candidateGame) => {
        const baselineGame = baselineByCase.get(candidateGame.meta.caseId)
        if (!baselineGame) return []
        assertMatched(baselineGame, candidateGame)
        return [{
          baseline: baselineGame,
          candidate: candidateGame,
        }]
      })
      const deltas = pairs.map(({ baseline: base, candidate: next }) => ({
        wins: Number(next.won) - Number(base.won),
        forced: next.forced - base.forced,
        degraded: next.degraded - base.degraded,
        cost: next.cost - base.cost,
      }))
      comparisons.push({
        baseline,
        candidate,
        matchedCases: deltas.length,
        wins: deltas.reduce((sum, delta) => sum + delta.wins, 0),
        forcedViolations: deltas.reduce((sum, delta) => sum + delta.forced, 0),
        degraded: deltas.reduce((sum, delta) => sum + delta.degraded, 0),
        cost: deltas.reduce((sum, delta) => sum + delta.cost, 0),
        targetWinRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: Number(game.won),
            trials: 1,
          }),
          `${games[0].meta.bank}:${baseline}:${candidate}:wins`,
        ),
        cleanInitialProposalRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.cleanInitialProposals,
            trials: game.initialProposals,
          }),
          `${games[0].meta.bank}:${baseline}:${candidate}:proposals`,
        ),
        voteTruthAccuracyDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.correctVotes,
            trials: game.votes,
          }),
          `${games[0].meta.bank}:${baseline}:${candidate}:votes`,
        ),
      })
    }
  }

  return {
    schema: ARCHITECTURE_REPORT_SCHEMA,
    bank: games[0].meta.bank,
    cases: caseIds,
    variants,
    comparisons,
  }
}

const fixed = (value: number): string => value.toFixed(4)
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
const renderRate = (value: RateEstimate): string =>
  value.rate === null || !value.interval95
    ? `n/a (0/${value.trials})`
    : `${percent(value.rate)} (${value.successes}/${value.trials}, `
      + `95% ${percent(value.interval95.low)}-${percent(value.interval95.high)})`
const renderDelta = (value: RateDeltaEstimate): string =>
  value.delta === null || !value.interval95
    ? 'n/a'
    : `${value.delta >= 0 ? '+' : ''}${percent(value.delta)} `
      + `(95% ${percent(value.interval95.low)} to ${percent(value.interval95.high)})`
const renderMilliseconds = (value: number | null): string =>
  value === null ? 'n/a' : `${value.toFixed(2)}ms`

export function renderArchitectureReport(report: ArchitectureBenchmarkReport): string {
  const lines = [
    `ARCHITECTURE ${report.bank}  ${report.cases.length} cases`,
  ]
  for (const variant of report.variants) {
    lines.push(
      `${variant.id}: ${variant.wins}/${variant.games} target-side wins, `
      + `${variant.forcedViolations} forced, ${variant.degraded} degraded, `
      + `${variant.calls} calls, $${fixed(variant.cost)}`,
    )
    lines.push(`  components ${Object.entries(variant.components).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    lines.push(`  roles ${variant.byRole.map((r) =>
      `${r.role}:${r.wins}/${r.games},d${r.degraded},$${fixed(r.cost)}`).join(' ')}`)
    lines.push(
      `  quality win ${renderRate(variant.decisionQuality.targetWinRate)}; `
      + `clean-proposal ${renderRate(
        variant.decisionQuality.cleanInitialProposalRate,
      )}; vote-truth ${renderRate(
        variant.decisionQuality.voteTruthAccuracy,
      )}`,
    )
    lines.push(
      `  variation planner-override ${renderRate(
        variant.decisionQuality.plannerOverrideRate,
      )}; seeded-vote ${renderRate(
        variant.decisionQuality.seededVoteVariationRate,
      )}; approve ${renderRate(variant.decisionQuality.voteApproveRate)}`,
    )
    lines.push(
      `  values proposal-clean ${
        variant.decisionQuality.meanProposalCleanProbability?.toFixed(4)
        ?? 'n/a'
      } proposal-regret ${
        variant.decisionQuality.meanProposalPosteriorRegret?.toFixed(4)
        ?? 'n/a'
      } vote-regret ${
        variant.decisionQuality.meanVoteUtilityRegret?.toFixed(4)
        ?? 'n/a'
      }`,
    )
    lines.push(
      `  latency ${variant.latency.samples} samples, median `
      + `${renderMilliseconds(variant.latency.medianMs)}, p95 `
      + `${renderMilliseconds(variant.latency.p95Ms)}, max `
      + renderMilliseconds(variant.latency.maxMs),
    )
    lines.push(
      `  safety hidden ${variant.safety.hiddenInformationViolations}/`
      + `${variant.safety.hiddenInformationChecks}, attribution `
      + `${variant.safety.traceAttributionViolations}/`
      + variant.safety.traceAttributionChecks,
    )
    lines.push(`  kinds ${variant.byKind.map((k) =>
      `${k.kind}:${k.decisions}d/${k.calls}c/${k.degraded}x/$${fixed(k.cost)}`).join(' ')}`)
    if (variant.byModel.length) {
      lines.push(`  models ${variant.byModel.map((m) =>
        `${m.model}:${m.calls}c/$${fixed(m.cost)}`).join(' ')}`)
    }
  }
  for (const comparison of report.comparisons) {
    lines.push(
      `DELTA ${comparison.candidate} - ${comparison.baseline} (${comparison.matchedCases} matched): `
      + `wins ${comparison.wins >= 0 ? '+' : ''}${comparison.wins}, `
      + `forced ${comparison.forcedViolations >= 0 ? '+' : ''}${comparison.forcedViolations}, `
      + `degraded ${comparison.degraded >= 0 ? '+' : ''}${comparison.degraded}, `
      + `cost ${comparison.cost >= 0 ? '+' : ''}$${fixed(comparison.cost)}`,
    )
    lines.push(
      `  rate deltas win ${renderDelta(comparison.targetWinRateDelta)}; `
      + `clean-proposal ${renderDelta(
        comparison.cleanInitialProposalRateDelta,
      )}; vote-truth ${renderDelta(
        comparison.voteTruthAccuracyDelta,
      )}`,
    )
  }
  return lines.join('\n')
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  })
  if (!positionals.length) {
    console.error('usage: node server/eval/architecture-report.ts <artifacts.jsonl> [...more] [--json] [--out file]')
    process.exit(1)
  }
  const report = architectureReport(positionals.flatMap((file) => readArtifacts(file)))
  const rendered = values.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderArchitectureReport(report)}\n`
  if (values.out) fs.writeFileSync(values.out, rendered)
  else process.stdout.write(rendered)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
