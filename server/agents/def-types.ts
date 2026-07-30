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
import type { BrainSpec, LlmBrainConfig } from './brain.ts'
import type { ComposedBrainPreset } from './types.ts'

// The prompt-layer overrides an llm agent may carry: persona and strategy prose
// plus per-role and per-decision-kind guidance. Extracted so the three places
// that model the same field set — LlmEngine (stored config), AgentPublicInfo
// (what the client sees), and promptOverridesOf's return (the subset
// buildMessages consumes) — share one definition and cannot drift.
//
// Distinct from prompts.ts's PromptOverrides (a Record<string, string> of
// already-rendered slot text): a different concept, deliberately not merged.
export interface PromptOverrides {
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  // 'replace' (default) swaps out the baseline guidance for that role;
  // 'append' layers the custom text under it, so the agent still rides
  // baseline strategy improvements.
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
}

export interface LlmEngine extends PromptOverrides {
  type: 'llm'
  model?: string // roster id — a SUGGESTION; seat-time override wins, DEFAULT_MODEL backstops
  temperature?: number // global sampling override, must be in [0, 1]
  /** Strategic components, independent of model and prompt/persona layers. */
  brain?: LlmBrainConfig
}

export type ComposedEngine =
  | {
      type: 'composed'
      brain: ComposedBrainPreset
      adapter: 'none'
    }
  | {
      type: 'composed'
      brain: ComposedBrainPreset
      adapter: 'bounded-llm'
      model?: string
    }

// The library-config axis: what a def may declare (llm, composed, or
// heuristic). The broader internal/sim construction axis is AgentSpec
// (types.ts), which also carries the random kind the library never exposes.
export type AgentEngine =
  | LlmEngine
  | ComposedEngine
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
export interface AgentPublicInfo extends PromptOverrides {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  model: string          // resolved model slug, 'rule-based', or 'probabilistic'
  usesModel: boolean     // whether the seat accepts a roster-model override
  color: string
  temperature?: number
  suggestedModel?: string // the def's RAW model suggestion (roster id), if any —
                          // `model` above is always the resolved display slug
  tunedChars: number     // aggregate custom prompt text, 0 for baseline agents
  custom: boolean        // editable (user tier)
  tier: AgentTier
  unavailable?: string
  brain?: BrainSpec
}

// One seat at a lobby table: which agent plays it, and (optionally) which
// model it runs on — a host-side, per-lobby choice for model-backed engines
// that outranks the def's own suggestion. Model resolution order:
// seat override > def.engine.model > DEFAULT_MODEL.
export interface TableSeat {
  agent: string
  model?: string // roster id
}
