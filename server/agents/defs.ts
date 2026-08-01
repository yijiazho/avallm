// Agent definitions — the agent library. An agent is a CONFIG: identity
// (name/version/author/about/badge) + an engine. For llm engines the config
// owns a typed brain plus the prompt LAYERS (strategy, personality, per-role
// and per-decision-kind guidance, temperature) and may SUGGEST a model; which
// model actually plays is a seat-time decision (resolveModel: lobby override
// > def suggestion > DEFAULT_MODEL — the host pays the bill, so the host gets
// the final say). The output contracts, rules digest, injection guard, and
// view rendering stay engine-owned so a custom agent can't break parsing or
// leak hidden information. Design: docs/design-custom-agents.md.
//
// Three tiers, earlier wins on id collision (collisions are surfaced, not
// silent — see loadAgentLibrary):
//   builtin — roster models plus the local rule-based and composed agents
//   curated — checked-in agent-cards/*.json, version with the repo, read-only
//   user    — data/agents/*.json, created via POST/PUT /api/agents (llm
//             engines only) or dropped in by hand

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MODEL, ROSTER, rosterById } from '../llm/roster.ts'
import { CALL_PARAMS } from '../llm/call-params.ts'
import type { LlmCallKind } from '../llm/call-params.ts'
import { ROLE_ALIGNMENT } from '../engine/rules.ts'
import { agentNameIsReserved } from '../engine/names.ts'
import { resolvePacks } from './packs.ts'
import type { ResolvedPack } from './packs.ts'
import type { Role } from '../engine/types.ts'
import { resolveBrain } from './brain.ts'
import type {
  AgentDef,
  AgentEngine,
  AgentPublicInfo,
  AgentTier,
  ComposedEngine,
  LlmEngine,
  LibraryProblem,
  PromptOverrides,
  TableSeat,
} from './def-types.ts'

// The agent-definition shapes live in def-types.ts so packs.ts can name them
// without importing this module back. They are re-exported here because this is
// where callers have always read them from.
export type {
  AgentDef,
  AgentEngine,
  AgentPublicInfo,
  AgentTier,
  ComposedEngine,
  LlmEngine,
  LibraryProblem,
  PromptOverrides,
  TableSeat,
} from './def-types.ts'

export function engineUsesModel(
  engine: AgentEngine,
): engine is LlmEngine | Extract<ComposedEngine, { adapter: 'bounded-llm' }> {
  return engine.type === 'llm'
    || (engine.type === 'composed' && engine.adapter === 'bounded-llm')
}

export function resolveModel(def: AgentDef, override?: string): string {
  if (!engineUsesModel(def.engine)) {
    throw new Error(`agent ${def.id} does not take a model`)
  }
  return override ?? def.engine.model ?? DEFAULT_MODEL
}

// Stable, replay-oriented identity for the implementation that occupied a
// seat. PublicInfo is deliberately presentation-shaped (its model is an
// OpenRouter slug and several definitions can share it), so it cannot serve as
// artifact provenance. Keep both the definition id and the resolved roster id
// for model-backed definitions; raw built-in model cards retain the compact
// historical `llm:<model>` form.
export function agentDescriptor(def: AgentDef, modelOverride?: string): string {
  if (def.engine.type === 'heuristic') {
    return def.id === 'autopilot' ? 'heuristic' : `def:${def.id}`
  }
  if (!engineUsesModel(def.engine)) return `def:${def.id}`

  const model = resolveModel(def, modelOverride)
  const rawBuiltinModel = def.engine.type === 'llm'
    && def.tier === 'builtin'
    && ROSTER.some((entry) => entry.id === def.id)
  return rawBuiltinModel
    ? `llm:${model}`
    : `def:${def.id}:llm:${model}`
}

// The one place that maps an llm engine config to the prompt layers
// buildMessages consumes. Every path that renders a def's prompt — live play
// (registry.ts), the editor preview (server.ts), and eval bank replay
// (server/eval/bank.ts) — MUST go through this, or a new prompt layer added
// to LlmEngine silently reaches some paths and not others (bank replay would
// then exercise a different prompt than the live game, invalidating its
// verdicts). Adding a layer here updates all callers at once.
export function promptOverridesOf(engine: LlmEngine): PromptOverrides {
  return {
    personality: engine.personality,
    strategy: engine.strategy,
    roleGuidance: engine.roleGuidance,
    roleGuidanceMode: engine.roleGuidanceMode,
    kindGuidance: engine.kindGuidance,
  }
}

// Wire format for lobby tables: a bare agent id (legacy) or {agent, model?}.
// Throws on unknown agents/models and on model overrides for model-free engines,
// so a bad table is rejected at lobby creation, never at game start.
export function parseTableSeat(raw: unknown, agentById: (id: string) => AgentDef): TableSeat {
  const t: Partial<TableSeat> | null = typeof raw === 'string' ? { agent: raw } : raw as Partial<TableSeat>
  if (!t || typeof t !== 'object' || typeof t.agent !== 'string') {
    throw new Error('table entry must be an agent id or {agent, model?}')
  }
  const def = agentById(t.agent) // throws on unknown agent
  if (t.model !== undefined) {
    if (typeof t.model !== 'string') throw new Error('seat model must be a roster id')
    rosterById(t.model) // throws on unknown model
    if (!engineUsesModel(def.engine)) {
      throw new Error(`agent ${def.id} does not take a model`)
    }
  } else if (def.unavailable) {
    // A stale model suggestion is curable by a seat override; without one the
    // seat is rejected here, at lobby creation — never at game start.
    throw new Error(`agent "${def.name}" cannot be seated: ${def.unavailable}`)
  }
  return t.model === undefined ? { agent: t.agent } : { agent: t.agent, model: t.model }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Curated agents ship WITH the repo — read-only, always baked into the deploy
// image, so their home is fixed at the repo-relative path.
export const CURATED_AGENTS_DIR = path.join(__dirname, '..', '..', 'agent-cards')

// User agents are LIVE STATE created at runtime. On a PaaS the container
// filesystem is ephemeral (wiped every redeploy), so the store can be pointed
// at a mounted persistent disk. The composition root (server startup) resolves
// the target from the environment AFTER .env has loaded and calls useDataDir
// ONCE; the whole module then reads this single value, so the boot library scan
// and every later save/delete agree on one directory. Tests and the sim never
// call the setter, so they always use the repo-local default regardless of any
// ambient RAILWAY_*/AVALON_* vars in the developer's shell.
let userAgentsDirPath = path.join(__dirname, '..', '..', 'data', 'agents')

export function userAgentsDir(): string {
  return userAgentsDirPath
}

// Point the user-agents store under `base` (…/agents is appended). Called once
// at startup; an undefined/empty base keeps the repo-local default.
export function useDataDir(base: string | undefined): void {
  if (base) userAgentsDirPath = path.join(base, 'agents')
}

// Exported so the API payload can serve them — the client meter must display
// the same caps the server enforces, not a hardcoded copy.
export const FIELD_CAP = 2000
export const AGGREGATE_CAP = 10_000

function hashColor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 55% 48%)`
}

export function builtinDefs(): AgentDef[] {
  const models: AgentDef[] = ROSTER.map((r) => ({
    id: r.id,
    name: r.displayName,
    author: 'built-in',
    version: 1,
    // No table-manner blurb: how a model actually plays Avalon is unmeasured,
    // so we don't assert it. Cost tier and badge carry the honest signal.
    badge: r.badge,
    engine: { type: 'llm', model: r.id },
    tier: 'builtin' as const,
  }))
  return [
    ...models,
    {
      id: 'autopilot',
      name: 'Rule-based',
      author: 'built-in',
      version: 1,
      about: 'The rule-based player from the strategy playbook. Free, instant, and unimaginative.',
      badge: { color: '#5a5f73' },
      engine: { type: 'heuristic' },
      tier: 'builtin',
    },
    {
      id: 'probabilistic',
      name: 'Probabilistic',
      author: 'built-in',
      version: 1,
      about: 'The deterministic full-role policy. It reasons over exact joint worlds and plays without model calls or table talk.',
      badge: { color: '#8b6fd6' },
      engine: {
        type: 'composed',
        brain: 'full-role',
        adapter: 'none',
      },
      tier: 'builtin',
    },
    {
      id: 'probabilistic-llm',
      name: 'Probabilistic + LLM',
      author: 'built-in',
      version: 1,
      about: 'The same full-role probabilistic mechanics, with a bounded LLM planner and voice that cannot override the committed action.',
      badge: { color: '#b56fe0' },
      engine: {
        type: 'composed',
        brain: 'full-role',
        adapter: 'bounded-llm',
        model: DEFAULT_MODEL,
      },
      tier: 'builtin',
    },
  ]
}

// Windows textareas paste \r\n, which inflates char caps and puts stray \r
// into prompts — normalize every custom text field at the validation boundary.
const normText = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

export function customChars(e: AgentEngine): number {
  if (e.type !== 'llm') return 0
  return (e.strategy?.length ?? 0)
    + (e.personality?.length ?? 0)
    + Object.values(e.roleGuidance ?? {}).reduce((n, t) => n + (t?.length ?? 0), 0)
    + Object.values(e.kindGuidance ?? {}).reduce((n, t) => n + (t?.length ?? 0), 0)
}

function validateGuidanceMap(
  map: Record<string, unknown>, field: string, noun: string, validKeys: (k: string) => boolean,
): void {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${field} must be an object of ${noun} -> text`)
  }
  // validKeys callers must use Object.hasOwn, never `in`: `in` walks the
  // prototype chain, so "toString"/"__proto__" would pass as valid keys.
  for (const [key, text] of Object.entries(map)) {
    if (!validKeys(key)) throw new Error(`${field}: unknown ${noun} "${key}"`)
    if (typeof text !== 'string' || text.length > FIELD_CAP) {
      throw new Error(`${field}.${key} must be a string (max ${FIELD_CAP} chars)`)
    }
  }
}

export interface ValidateOpts {
  // Lenient library-load mode: accept defs whose roster model id has
  // disappeared so they can be surfaced as `unavailable` instead of silently
  // skipped. POST/PUT always validate strictly.
  allowUnknownModel?: boolean
}

// Normalizes IN PLACE: the returned AgentDef is the same object as `raw`, with
// its name trimmed, version coerced, and every custom text field run through
// normText. Callers that must not mutate the input should clone before calling.
export function validateDef(raw: unknown, opts: ValidateOpts = {}): AgentDef {
  const d = raw as Partial<AgentDef> & { version?: number | string }
  if (!d || typeof d !== 'object') throw new Error('agent def must be an object')
  if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(d.id)) {
    throw new Error('agent id must be a short kebab-case slug')
  }
  // Agent-card names are public metadata rather than table identities. Strip
  // prompt-structure markup, collapse whitespace, and retain the historical
  // rejection of control-like identity words ("You", "system", ...), while
  // allowing role-themed card labels such as "Merlin". Enforced HERE so every
  // ingest path (POST, PUT, file-drop, curated) is covered.
  if (typeof d.name !== 'string') throw new Error('agent name required (max 40 chars)')
  d.name = d.name.replace(/[<>{}[\]|\\]/g, '').replace(/\s+/g, ' ').trim()
  if (!d.name || d.name.length > 40) throw new Error('agent name required (max 40 chars)')
  if (agentNameIsReserved(d.name)) throw new Error(`"${d.name}" can't be used as an agent name: it's a reserved word`)
  // Legacy defs carry version: '1.0' — read any string as its leading number.
  if (typeof d.version === 'string') d.version = Math.trunc(parseFloat(d.version)) || 1
  if (d.version !== undefined && (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1)) {
    throw new Error('version must be a positive integer')
  }
  const e = d.engine as AgentEngine | undefined
  if (!e || typeof e !== 'object') throw new Error('agent engine required')
  if (e.type === 'llm') {
    // The model is an optional SUGGESTION (resolveModel backstops).
    if (e.model !== undefined) {
      if (typeof e.model !== 'string') throw new Error('model must be a roster id')
      if (!opts.allowUnknownModel) rosterById(e.model) // throws on unknown model
    }
    for (const field of ['personality', 'strategy'] as const) {
      const v = e[field]
      if (v !== undefined) {
        if (typeof v !== 'string' || v.length > FIELD_CAP) {
          throw new Error(`${field} must be a string (max ${FIELD_CAP} chars)`)
        }
        e[field] = normText(v)
      }
    }
    if (e.roleGuidance !== undefined) {
      validateGuidanceMap(e.roleGuidance, 'roleGuidance', 'role', (k) => Object.hasOwn(ROLE_ALIGNMENT, k))
      for (const k of Object.keys(e.roleGuidance)) {
        e.roleGuidance[k as Role] = normText(e.roleGuidance[k as Role]!)
      }
    }
    if (e.roleGuidanceMode !== undefined && e.roleGuidanceMode !== 'replace' && e.roleGuidanceMode !== 'append') {
      throw new Error(`roleGuidanceMode must be "replace" or "append"`)
    }
    if (e.kindGuidance !== undefined) {
      validateGuidanceMap(e.kindGuidance, 'kindGuidance', 'kind', (k) => Object.hasOwn(CALL_PARAMS, k))
      for (const k of Object.keys(e.kindGuidance)) {
        e.kindGuidance[k as LlmCallKind] = normText(e.kindGuidance[k as LlmCallKind]!)
      }
    }
    if (e.temperature !== undefined) {
      if (typeof e.temperature !== 'number' || !Number.isFinite(e.temperature)
        || e.temperature < 0 || e.temperature > 1) {
        throw new Error('temperature must be a number in [0, 1]')
      }
    }
    // The resolver is the one validation authority for component values and
    // cross-component compatibility.
    resolveBrain(e)
    if (customChars(e) > AGGREGATE_CAP) {
      throw new Error(`custom prompt text exceeds ${AGGREGATE_CAP} chars total`)
    }
  } else if (e.type === 'composed') {
    if (e.brain !== 'good-base' && e.brain !== 'full-role') {
      throw new Error('composed brain must be "good-base" or "full-role"')
    }
    if (e.adapter !== 'none' && e.adapter !== 'bounded-llm') {
      throw new Error('composed adapter must be "none" or "bounded-llm"')
    }
    if (e.adapter === 'none' && Object.hasOwn(e, 'model')) {
      throw new Error('model requires the bounded-llm composed adapter')
    }
    if (e.adapter === 'bounded-llm' && e.model !== undefined) {
      if (typeof e.model !== 'string') throw new Error('model must be a roster id')
      if (!opts.allowUnknownModel) rosterById(e.model)
    }
    resolveBrain(e)
  } else if (e.type !== 'heuristic') {
    throw new Error(`unknown engine type: ${String((e as any).type)}`)
  }
  return d as AgentDef
}

export interface AgentLibrary {
  agents: AgentDef[]
  packs: ResolvedPack[]
  problems: LibraryProblem[]
}

function loadTier(
  dir: string, tier: AgentTier, seen: Set<string>,
  agents: AgentDef[], problems: LibraryProblem[],
): void {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const def = validateDef(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), { allowUnknownModel: true })
      // Filename must equal the internal id: saveCustomDef/deleteCustomDef
      // address defs as `${id}.json`, so a mismatched hand-dropped file would
      // make PUT write a duplicate and DELETE a silent no-op. Enforce the
      // invariant at the load boundary instead of trusting every writer.
      if (def.id !== file.slice(0, -'.json'.length)) {
        throw new Error(`file name must match its id — rename to ${def.id}.json`)
      }
      if (seen.has(def.id)) {
        // Earlier tiers win, but a vanished agent is a bug report, not a shrug.
        const reason = `id "${def.id}" is shadowed by a ${agents.find((a) => a.id === def.id)?.tier} agent — rename the file's id to restore it`
        console.warn(`[agents] ${file}: ${reason}`)
        problems.push({ file: `${tier}/${file}`, reason })
        continue
      }
      seen.add(def.id)
      // Only a STALE suggestion is a problem; no suggestion at all is fine
      // (the seat override or DEFAULT_MODEL backstops it).
      const suggested = engineUsesModel(def.engine)
        ? def.engine.model
        : undefined
      if (suggested !== undefined && !ROSTER.some((r) => r.id === suggested)) {
        def.unavailable = `model "${suggested}" is no longer in the roster; pick a new model`
      }
      agents.push({ ...def, tier })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[agents] skipping ${file}: ${reason}`)
      problems.push({ file: `${tier}/${file}`, reason: `unreadable (${reason})` })
    }
  }
}

export function loadAgentLibrary(): AgentLibrary {
  const agents = builtinDefs()
  const problems: LibraryProblem[] = []
  const seen = new Set(agents.map((d) => d.id))
  loadTier(CURATED_AGENTS_DIR, 'curated', seen, agents, problems)
  loadTier(userAgentsDir(), 'user', seen, agents, problems)
  // Packs are resolved AFTER every tier loads: a pack member can be shadowed
  // or made unavailable by the same load, and that must surface as a problem
  // rather than a silently shorter pack.
  const resolved = resolvePacks(agents)
  problems.push(...resolved.problems)
  return { agents, packs: resolved.packs, problems }
}

// Atomic write (temp + rename): a Railway redeploy mid-write must not leave
// truncated JSON that silently drops the agent from the next boot's library.
export function saveCustomDef(def: AgentDef): void {
  const dir = userAgentsDir()
  fs.mkdirSync(dir, { recursive: true })
  const { tier, unavailable, ...persisted } = def
  const file = path.join(dir, `${def.id}.json`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2))
  fs.renameSync(tmp, file)
}

export function deleteCustomDef(id: string): void {
  fs.rmSync(path.join(userAgentsDir(), `${id}.json`), { force: true })
}

// Whether ANY file (including corrupt/skipped ones that never made it into
// the library) already claims this id on disk — id allocation must not
// silently clobber a broken file the user was told to fix.
export function customDefFileExists(id: string): boolean {
  return fs.existsSync(path.join(userAgentsDir(), `${id}.json`))
}

export function publicInfo(def: AgentDef, modelOverride?: string): AgentPublicInfo {
  // The OpenRouter slug, not a marketing name — "deepseek/deepseek-v4-flash"
  // tells you exactly what you're playing against. Always the RESOLVED model
  // (seat override > def suggestion > default), so the badge never lies about
  // which model is actually answering; a stale suggestion renders as
  // "<id> (unavailable)" instead of throwing so the library can list it.
  const e = def.engine
  // Prompt layers remain LLM-engine-only. A composed hybrid can use a model
  // without inheriting the raw-LLM prompt customization surface.
  const llm = e.type === 'llm' ? e : undefined
  const usesModel = engineUsesModel(e)
  let model = e.type === 'composed' ? 'probabilistic' : 'rule-based'
  if (usesModel) {
    // resolveModel owns the precedence; it cannot throw in this branch.
    const resolved = resolveModel(def, modelOverride)
    model = ROSTER.find((r) => r.id === resolved)?.slug ?? `${resolved} (unavailable)`
  }
  return {
    id: def.id,
    name: def.name,
    version: def.version,
    author: def.author,
    about: def.about,
    model,
    usesModel,
    color: def.badge?.color ?? hashColor(def.id),
    personality: llm?.personality,
    strategy: llm?.strategy,
    roleGuidance: llm?.roleGuidance,
    roleGuidanceMode: llm?.roleGuidanceMode,
    kindGuidance: llm?.kindGuidance,
    temperature: llm?.temperature,
    suggestedModel: usesModel ? e.model : undefined,
    tunedChars: customChars(e),
    custom: def.tier === 'user',
    tier: def.tier ?? 'user',
    unavailable: def.unavailable,
    // resolveBrain is engine-agnostic (it accepts the heuristic source too), so
    // calling it unconditionally here cannot throw for a non-llm engine.
    brain: resolveBrain(e),
  }
}
