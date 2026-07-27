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

export const ARCHITECTURE_REPORT_SCHEMA = 1

export interface ArchitectureRoleSummary {
  role: Role
  games: number
  wins: number
  voteScore: number | null
  forcedViolations: number
  degraded: number
  calls: number
  cost: number
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
  for (const ev of a.log) {
    const p = ev.payload
    const seat = ev.type === 'proposal' || ev.type === 'proposalLocked' || ev.type === 'proposalRevised'
      ? p.leader
      : ev.type === 'assassination'
        ? p.assassin
        : p.seat
    const kind = actionKind(a, ev.type, seat)
    if (kind) increment(decisions, kind)
  }

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
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
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
      const deltas = byVariant.get(candidate)!.flatMap((candidateGame) => {
        const baselineGame = baselineByCase.get(candidateGame.meta.caseId)
        if (!baselineGame) return []
        assertMatched(baselineGame, candidateGame)
        return [{
          wins: Number(candidateGame.won) - Number(baselineGame.won),
          forced: candidateGame.forced - baselineGame.forced,
          degraded: candidateGame.degraded - baselineGame.degraded,
          cost: candidateGame.cost - baselineGame.cost,
        }]
      })
      comparisons.push({
        baseline,
        candidate,
        matchedCases: deltas.length,
        wins: deltas.reduce((sum, delta) => sum + delta.wins, 0),
        forcedViolations: deltas.reduce((sum, delta) => sum + delta.forced, 0),
        degraded: deltas.reduce((sum, delta) => sum + delta.degraded, 0),
        cost: deltas.reduce((sum, delta) => sum + delta.cost, 0),
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
