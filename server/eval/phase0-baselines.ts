// Phase 0 baseline recorders.
//
// `heuristic` reruns the free architecture bank and writes the compact
// architecture report. `observed-llm` summarizes already-paid archived
// playtests without making any network call. The latter preserves the evidence
// available at migration start; new paired LLM evidence must come from
// architecture-bench.ts with its explicit --allow-paid gate.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { builtinDefs } from '../agents/defs.ts'
import {
  PHASE0_COMPONENT_VERSIONS,
  runArchitectureBench,
} from './architecture-bench.ts'
import { architectureReport } from './architecture-report.ts'
import { readArtifacts } from './artifact.ts'
import type { ArchitectureBenchmarkReport } from './architecture-report.ts'
import type { GameArtifact } from './artifact.ts'
import type { DecisionKind, Role, Seat } from '../engine/types.ts'

export const HEURISTIC_BASELINE_FILE = 'docs/baselines/phase0-heuristic-standard-v1.json'
export const OBSERVED_LLM_BASELINE_FILE = 'docs/baselines/phase0-prompt-guided-observed.json'
export const OBSERVED_LLM_BASELINE_SCHEMA = 1

export async function buildHeuristicBaseline(): Promise<ArchitectureBenchmarkReport> {
  const agent = builtinDefs().find((def) => def.id === 'autopilot')!
  const historicalComponents = {
    agent: 'autopilot@v1',
    model: 'none',
    belief: 'none',
    policy: PHASE0_COMPONENT_VERSIONS.heuristicPolicy,
    communication: 'none',
  }
  const artifacts = await runArchitectureBench({
    variants: [{
      id: 'heuristic-v1',
      agent,
      // Historical Phase 0 identity is intentionally frozen. New architecture
      // artifacts use the richer resolved BrainSpec component bundle. Run with
      // the current truthful identity, then project the unchanged behavior
      // back onto its historical label below.
      components: {},
    }],
  })
  for (const artifact of artifacts) {
    artifact.architecture!.components = { ...historicalComponents }
  }
  return architectureReport(artifacts)
}

interface ObservedDimension {
  id: string
  seatGames?: number
  wins?: number
  decisions: number
  calls: number | null
  cost: number | null
  degraded: number
}

export interface ObservedPromptBaseline {
  schema: number
  architecture: {
    belief: 'none'
    policy: string
  }
  source: {
    kind: 'archived-playtests'
    directory: string
    costPrecision: 'transcript-rounded-4dp'
    files: { file: string; sha256: string }[]
    seeds: string[]
  }
  games: number
  seatGames: number
  winners: Record<string, number>
  decisions: number
  calls: number
  cost: number
  degraded: number
  byRole: ObservedDimension[]
  byDecisionKind: ObservedDimension[]
  byModel: ObservedDimension[]
}

interface SeatObservation {
  role: Role
  model: string
  won: boolean
  decisions: Record<string, number>
  calls: number
  cost: number
  degraded: Record<string, number>
}

const roundCost = (value: number): number => Math.round(value * 10_000) / 10_000

const DECISION_KINDS: readonly DecisionKind[] = [
  'discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate',
]

function action(type: string, payload: Record<string, unknown>): {
  kind: DecisionKind
  seat: Seat
} | undefined {
  switch (type) {
    case 'utterance': return { kind: 'discuss', seat: payload.seat as Seat }
    case 'proposal': return { kind: 'propose', seat: payload.leader as Seat }
    case 'proposalLocked':
    case 'proposalRevised': return { kind: 'finalize', seat: payload.leader as Seat }
    case 'voteCast': return { kind: 'vote', seat: payload.seat as Seat }
    case 'questCard': return { kind: 'quest', seat: payload.seat as Seat }
    case 'assassination': return { kind: 'assassinate', seat: payload.assassin as Seat }
    default: return undefined
  }
}

function transcriptSpend(text: string): Map<string, { calls: number; cost: number }> {
  const out = new Map<string, { calls: number; cost: number }>()
  const pattern = /^  ([a-z0-9-]+): \$([0-9.]+) over ([0-9]+) calls/gim
  for (const match of text.matchAll(pattern)) {
    out.set(match[1], { cost: Number(match[2]), calls: Number(match[3]) })
  }
  return out
}

function hashFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function sumDimension(id: string, seats: SeatObservation[]): ObservedDimension {
  return {
    id,
    seatGames: seats.length,
    wins: seats.filter((seat) => seat.won).length,
    decisions: seats.reduce(
      (sum, seat) => sum + Object.values(seat.decisions).reduce((a, b) => a + b, 0),
      0,
    ),
    calls: seats.reduce((sum, seat) => sum + seat.calls, 0),
    cost: roundCost(seats.reduce((sum, seat) => sum + seat.cost, 0)),
    degraded: seats.reduce(
      (sum, seat) => sum + Object.values(seat.degraded).reduce((a, b) => a + b, 0),
      0,
    ),
  }
}

export function buildObservedPromptBaseline(directory: string): ObservedPromptBaseline {
  const artifactFiles = fs.readdirSync(directory)
    .filter((file) => /^game\d+-artifact\.jsonl$/.test(file))
    .sort()
  if (!artifactFiles.length) throw new Error(`${directory}: no gameN-artifact.jsonl files`)

  const artifacts: GameArtifact[] = []
  const seats: SeatObservation[] = []
  const sourceFiles: { file: string; sha256: string }[] = []
  for (const artifactName of artifactFiles) {
    const prefix = artifactName.replace('-artifact.jsonl', '')
    const transcriptName = `${prefix}-transcript.txt`
    const artifactFile = path.join(directory, artifactName)
    const transcriptFile = path.join(directory, transcriptName)
    if (!fs.existsSync(transcriptFile)) throw new Error(`${transcriptFile}: matching transcript missing`)
    const gameArtifacts = readArtifacts(artifactFile)
    if (gameArtifacts.length !== 1) throw new Error(`${artifactFile}: expected exactly one game`)
    const artifact = gameArtifacts[0]
    artifacts.push(artifact)
    sourceFiles.push(
      { file: artifactName, sha256: hashFile(artifactFile) },
      { file: transcriptName, sha256: hashFile(transcriptFile) },
    )
    const spend = transcriptSpend(fs.readFileSync(transcriptFile, 'utf8'))
    const models = artifact.players.map((player) => player.agent.replace(/^llm:/, ''))
    if (new Set(models).size !== models.length) {
      throw new Error(
        `${artifactFile}: duplicate model seats cannot be attributed from model-level transcript spend`,
      )
    }

    const decisions = artifact.players.map(() => Object.fromEntries(
      DECISION_KINDS.map((kind) => [kind, 0]),
    ) as Record<string, number>)
    for (const event of artifact.log) {
      const observed = action(event.type, event.payload)
      if (observed) decisions[observed.seat][observed.kind]++
    }
    const degraded = artifact.players.map(() => Object.fromEntries(
      DECISION_KINDS.map((kind) => [kind, 0]),
    ) as Record<string, number>)
    for (const item of artifact.degraded) degraded[item.seat][item.kind]++

    for (const player of artifact.players) {
      const model = player.agent.replace(/^llm:/, '')
      const modelSpend = spend.get(model)
      if (!modelSpend) throw new Error(`${transcriptFile}: no spend line for ${model}`)
      seats.push({
        role: player.role,
        model,
        won: player.alignment === artifact.winner,
        decisions: decisions[player.seat],
        calls: modelSpend.calls,
        cost: modelSpend.cost,
        degraded: degraded[player.seat],
      })
    }
  }

  const byRole = [...new Set(seats.map((seat) => seat.role))].sort()
    .map((role) => sumDimension(role, seats.filter((seat) => seat.role === role)))
  const byModel = [...new Set(seats.map((seat) => seat.model))].sort()
    .map((model) => sumDimension(model, seats.filter((seat) => seat.model === model)))
  const byDecisionKind = DECISION_KINDS.map((kind): ObservedDimension => ({
    id: kind,
    decisions: seats.reduce((sum, seat) => sum + seat.decisions[kind], 0),
    // These archived transcripts printed exact spend per model but not per
    // call tag, so inventing a kind-level allocation would be false precision.
    calls: null,
    cost: null,
    degraded: seats.reduce((sum, seat) => sum + seat.degraded[kind], 0),
  }))
  const winners = artifacts.reduce<Record<string, number>>((acc, artifact) => {
    acc[artifact.winner] = (acc[artifact.winner] ?? 0) + 1
    return acc
  }, {})
  const overall = sumDimension('all', seats)
  return {
    schema: OBSERVED_LLM_BASELINE_SCHEMA,
    architecture: { belief: 'none', policy: 'prompt-guided-observed-2026-07-24' },
    source: {
      kind: 'archived-playtests',
      directory: path.basename(directory),
      costPrecision: 'transcript-rounded-4dp',
      files: sourceFiles,
      seeds: artifacts.map((artifact) => artifact.seed),
    },
    games: artifacts.length,
    seatGames: seats.length,
    winners,
    decisions: overall.decisions,
    calls: overall.calls!,
    cost: overall.cost!,
    degraded: overall.degraded,
    byRole,
    byDecisionKind,
    byModel,
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
    },
  })
  const [command] = positionals
  if (command === 'heuristic') {
    const out = values.out ?? HEURISTIC_BASELINE_FILE
    writeJson(out, await buildHeuristicBaseline())
    console.log(`${out}: wrote free Phase 0 heuristic baseline`)
    return
  }
  if (command === 'observed-llm') {
    if (!values.dir) throw new Error('observed-llm requires --dir <archived-playtests>')
    const out = values.out ?? OBSERVED_LLM_BASELINE_FILE
    writeJson(out, buildObservedPromptBaseline(values.dir))
    console.log(`${out}: wrote archived prompt-guided baseline (no LLM calls made)`)
    return
  }
  throw new Error('usage: node server/eval/phase0-baselines.ts <heuristic|observed-llm> [--dir path] [--out file]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
