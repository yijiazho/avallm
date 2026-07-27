// Phase 0 architecture benchmark runner.
//
// It reuses the normal game runner, agent registry, artifact format, and fixed
// architecture bank. Only the selected role seat changes between variants;
// every opponent remains the same heuristic baseline. LLM variants require an
// explicit allowPaid flag so importing or smoke-testing this module cannot
// spend money accidentally.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../engine/game.ts'
import { createAgent, createAgentFromDef } from '../agents/registry.ts'
import { loadAgentLibrary, resolveModel } from '../agents/defs.ts'
import { runGame } from '../sim/runner.ts'
import { appendArtifact, toArtifact } from './artifact.ts'
import {
  ARCHITECTURE_BANK,
  ARCHITECTURE_BANK_ID,
  validateArchitectureBank,
} from './architecture-bank.ts'
import type { AgentDef } from '../agents/defs.ts'
import type { AvalonAgent } from '../agents/types.ts'
import type { OpenRouterClient, SpendEntry } from '../llm/openrouter.ts'
import type { GameArtifact } from './artifact.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'
import type { Seat } from '../engine/types.ts'

export interface ArchitectureVariant {
  id: string
  agent: AgentDef
  modelOverride?: string
  components: Record<string, string>
}

export interface ArchitectureBenchOpts {
  variants: readonly ArchitectureVariant[]
  cases?: readonly ArchitectureBankCase[]
  bankId?: string
  out?: string
  allowPaid?: boolean
  onProgress?: (line: string) => void
}

type SpendMap = Record<string, SpendEntry>

export const PHASE0_COMPONENT_VERSIONS = {
  heuristicPolicy: 'heuristic-v1',
  promptGuidedPolicy: 'prompt-guided-v1',
  promptGuidedCommunication: 'prompt-voice-v1',
} as const

export function copySpend(spend: SpendMap): SpendMap {
  return structuredClone(spend)
}

export function spendDelta(before: SpendMap, after: SpendMap): SpendMap {
  const delta: SpendMap = {}
  for (const [tag, end] of Object.entries(after)) {
    const start = before[tag]
    const providers: Record<string, number> = {}
    for (const [provider, count] of Object.entries(end.providers)) {
      const change = count - (start?.providers[provider] ?? 0)
      if (change) providers[provider] = change
    }
    const entry: SpendEntry = {
      cost: end.cost - (start?.cost ?? 0),
      calls: end.calls - (start?.calls ?? 0),
      prompt: end.prompt - (start?.prompt ?? 0),
      completion: end.completion - (start?.completion ?? 0),
      reasoning: end.reasoning - (start?.reasoning ?? 0),
      reasoningLeakCalls: end.reasoningLeakCalls - (start?.reasoningLeakCalls ?? 0),
      providerViolationCalls: end.providerViolationCalls - (start?.providerViolationCalls ?? 0),
      model: end.model,
      providers,
    }
    if (
      entry.calls
      || entry.cost
      || entry.prompt
      || entry.completion
      || entry.reasoning
      || entry.reasoningLeakCalls
      || entry.providerViolationCalls
    ) {
      delta[tag] = entry
    }
  }
  return delta
}

function isPaid(variant: ArchitectureVariant): boolean {
  return variant.agent.engine.type === 'llm'
}

export function defaultComponents(def: AgentDef, modelOverride?: string): Record<string, string> {
  const version = def.version ? `v${def.version}` : 'unversioned'
  if (def.engine.type === 'heuristic') {
    return {
      agent: `${def.id}@${version}`,
      model: 'none',
      belief: 'none',
      policy: PHASE0_COMPONENT_VERSIONS.heuristicPolicy,
      communication: 'none',
    }
  }
  if (def.engine.type === 'stdio') {
    return {
      agent: `${def.id}@${version}`,
      model: 'external',
      belief: 'external',
      policy: 'external',
      communication: 'external',
    }
  }
  return {
    agent: `${def.id}@${version}`,
    model: resolveModel(def, modelOverride),
    belief: 'none',
    policy: PHASE0_COMPONENT_VERSIONS.promptGuidedPolicy,
    communication: PHASE0_COMPONENT_VERSIONS.promptGuidedCommunication,
  }
}

export async function runArchitectureBench(opts: ArchitectureBenchOpts): Promise<GameArtifact[]> {
  if (!opts.variants.length) throw new Error('architecture benchmark requires at least one variant')
  const cases = opts.cases ?? ARCHITECTURE_BANK
  const bankId = opts.bankId ?? ARCHITECTURE_BANK_ID
  validateArchitectureBank(cases, { requireCoverage: opts.cases === undefined })

  const variantIds = new Set<string>()
  for (const variant of opts.variants) {
    if (variantIds.has(variant.id)) throw new Error(`duplicate architecture variant id: ${variant.id}`)
    variantIds.add(variant.id)
  }
  if (opts.variants.some(isPaid) && !opts.allowPaid) {
    throw new Error('LLM architecture variants spend money; pass allowPaid: true (CLI: --allow-paid)')
  }

  const artifacts: GameArtifact[] = []
  for (const c of cases) {
    for (const variant of opts.variants) {
      const game = createGame({
        id: `architecture-${bankId}-${c.id}-${variant.id}`,
        seed: c.seed,
        playerCount: c.playerCount,
        roles: [...c.roles],
        talk: c.talk,
      })
      const target = game.players.find((p) => p.role === c.targetRole)
      if (!target || target.seat !== c.expectedTargetSeat) {
        throw new Error(
          `${c.id}: target deal drifted; expected ${c.targetRole} at seat ${c.expectedTargetSeat}, `
          + `found ${target?.seat ?? 'no seat'}`,
        )
      }

      const agents = new Map<Seat, AvalonAgent>()
      const descriptors = game.players.map(() => 'heuristic')
      for (const player of game.players) {
        const ctx = { seed: c.seed, seat: player.seat }
        if (player.seat === target.seat) {
          agents.set(player.seat, createAgentFromDef(variant.agent, ctx, variant.modelOverride))
          descriptors[player.seat] = `def:${variant.agent.id}`
        } else {
          agents.set(player.seat, createAgent({ type: 'heuristic' }, ctx))
        }
      }

      let before: SpendMap | undefined
      let client: OpenRouterClient | undefined
      if (isPaid(variant)) {
        const clientModule = await import('../llm/client.ts')
        client = clientModule.getClient()
        before = copySpend(client.getSpend())
      }
      const result = await runGame({ game, agents })
      const llmTags = before ? spendDelta(before, copySpend(client!.getSpend())) : undefined
      const artifact = toArtifact(game, {
        agents: descriptors,
        degraded: result.degraded,
        steps: result.steps,
        tags: {
          architectureBank: bankId,
          architectureCase: c.id,
          architectureVariant: variant.id,
        },
        architecture: {
          bank: bankId,
          caseId: c.id,
          targetRole: c.targetRole,
          targetSeat: target.seat,
          variant: variant.id,
          components: { ...variant.components },
        },
        ...(llmTags ? { telemetry: { llm: { tags: llmTags } } } : {}),
      })
      if (opts.out) appendArtifact(opts.out, artifact)
      artifacts.push(artifact)
      const targetWon = target.alignment === game.winner
      const cost = llmTags
        ? Object.values(llmTags).reduce((sum, entry) => sum + entry.cost, 0)
        : 0
      opts.onProgress?.(
        `${c.id.padEnd(13)} ${variant.id.padEnd(20)} ${targetWon ? 'win ' : 'loss'}`
        + `  degraded ${result.degraded.filter((d) => d.seat === target.seat).length}`
        + (cost ? `  $${cost.toFixed(4)}` : ''),
      )
    }
  }
  return artifacts
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string', default: 'autopilot' },
      candidate: { type: 'string' },
      out: { type: 'string', default: `data/eval/architecture-${ARCHITECTURE_BANK_ID}.jsonl` },
      'allow-paid': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  })
  const library = loadAgentLibrary().agents
  const byId = (id: string): AgentDef => {
    const def = library.find((candidate) => candidate.id === id)
    if (!def) throw new Error(`no agent "${id}" in the library`)
    return def
  }
  const defs = [byId(values.baseline!), ...(values.candidate ? [byId(values.candidate)] : [])]
  const variants = defs.map((agent) => ({
    id: `${agent.id}-${agent.version ? `v${agent.version}` : 'unversioned'}`,
    agent,
    components: defaultComponents(agent),
  }))
  const artifacts = await runArchitectureBench({
    variants,
    out: values.out,
    allowPaid: values['allow-paid'],
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  console.log(`\n${artifacts.length} architecture game(s) -> ${values.out}`)
  console.log(`report: node server/eval/architecture-report.ts ${values.out}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
