// The agent-definition data shapes: what an agent IS as configuration, with no
// loading, validation, or resolution logic attached. Those live in defs.ts,
// which re-exports every type here so existing importers still read them from
// `./defs.ts`.
//
// This leaf exists so pack curation (packs.ts) can name an AgentDef without
// importing defs.ts, which in turn imports resolvePacks back from packs.ts.
// Splitting the shapes out of the module that consumes packs turns that mutual
// reference into one direction.

import type { LlmCallKind } from '../llm/call-params.ts'
import type { Role } from '../engine/types.ts'
import type { ExperimentalBeliefMode, BrainSpec, LlmBrainConfig } from './brain.ts'

export interface LlmEngine {
  type: 'llm'
  model?: string // roster id — a SUGGESTION; seat-time override wins, DEFAULT_MODEL backstops
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  // 'replace' (default) swaps out the baseline guidance for that role;
  // 'append' layers the custom text under it, so the agent still rides
  // baseline strategy improvements.
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
  temperature?: number // global sampling override, must be in [0, 1]
  /** Strategic components, independent of model and prompt/persona layers. */
  brain?: LlmBrainConfig
  /** Explicit, nondefault Phase 2 cognition visibility experiment. */
  beliefMode?: ExperimentalBeliefMode
}

export type AgentEngine =
  | LlmEngine
  | { type: 'heuristic' }

export type AgentTier = 'builtin' | 'curated' | 'user'

export interface AgentDef {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  badge?: { color?: string }
  engine: AgentEngine
  tier?: AgentTier        // assigned at load, not persisted
  unavailable?: string    // reason this agent can't be seated (assigned at load)
}

// A library-load problem worth showing users, not just console logs
// (corrupt file, cross-tier id shadowing).
export interface LibraryProblem {
  file: string
  reason: string
}

// What the client sees. Custom prompt configs are deliberately public —
// transparency is part of the premise, and secrecy is unenforceable under a
// shared invite code (design doc §4).
export interface AgentPublicInfo {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  model: string          // display name of the model, or 'rule-based'
  color: string
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
  temperature?: number
  suggestedModel?: string // the def's RAW model suggestion (roster id), if any —
                          // `model` above is always the resolved display slug
  tunedChars: number     // aggregate custom prompt text, 0 for baseline agents
  custom: boolean        // editable (user tier)
  tier: AgentTier
  unavailable?: string
  beliefMode?: ExperimentalBeliefMode
  brain?: BrainSpec
}

// One seat at a lobby table: which agent plays it, and (optionally) which
// model it runs on — a host-side, per-lobby choice that outranks the def's own
// suggestion. Model resolution order: seat override > def.engine.model >
// DEFAULT_MODEL.
export interface TableSeat {
  agent: string
  model?: string // roster id
}
