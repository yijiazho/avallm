// The wire contract the server actually sends is owned by server/engine/types.ts
// and re-exported here rather than restated. These were previously hand-mirrored
// declarations, and they had drifted: the transcript entries had lost the `prop`
// segment tag the server sends, GameEvent.type had widened from EventType to
// string, and GameEvent.payload had widened to `any`, which turned every payload
// read in the client into an unchecked one. Nothing linked the two files, so
// nothing could have caught that.
//
// The import is type-only, so it is erased at build time and the client keeps its
// own dependency tree; server/engine/types.ts imports nothing itself. Everything
// below this block is genuinely client-only: HTTP payload shapes that have no
// server-side declaration to share.
export type {
  Alignment,
  DecisionRequest,
  EventType,
  GameEvent,
  Phase,
  PlayerView,
  PrivateInfo,
  ProposalRecord,
  PublicPlayer,
  Quest,
  Role,
  Seat,
  TalkConfig,
  Visibility,
} from '../../server/engine/types.ts'

import type {
  Alignment,
  DecisionRequest,
  GameEvent,
  PlayerView,
  Seat,
} from '../../server/engine/types.ts'

export interface AgentInfo {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  model: string
  color: string
  personality?: string
  strategy?: string
  roleGuidance?: Record<string, string>
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Record<string, string>
  temperature?: number
  // The def's raw model suggestion (roster id), if any; `model` is always the
  // resolved display slug.
  suggestedModel?: string
  tunedChars: number
  custom: boolean
  tier: 'builtin' | 'curated' | 'user'
  unavailable?: string
}

// One bot seat sent to the server: which agent, and optionally which model
// it runs on (overrides the agent's own suggestion; server default backstops).
export interface TableSeat {
  agent: string
  model?: string
}

// A curated set of library agents the setup screen can seat in one click.
// `agents` are library ids in fill order; a pack shorter than the table fills
// the rest from the default library (server/agents/packs.ts).
export interface AgentPack {
  id: string
  name: string
  blurb: string
  agents: string[]
}

export interface Library {
  agents: AgentInfo[]
  packs?: AgentPack[]
  problems?: { file: string; reason: string }[]
  models: { id: string; name: string; slug: string; tier: string }[]
  baseline?: {
    rulesDigest: string
    // Shared per-alignment fragment (keyed 'good'/'evil') prepended to every
    // role's guidance and not overridable; roleGuidance is the per-role layer.
    alignmentGuidance?: Record<string, string>
    roleGuidance: Record<string, string>
    tableTalkNorms?: string
    outputContracts?: Record<string, string>
    kinds?: string[]
    previewRoles?: string[]
    caps?: { field: number; aggregate: number }
  }
  gated?: boolean
  // Informational only — the server's seating order for its own no-table
  // fallback. The setup screen does NOT honor it: auto-filled seats shuffle
  // flat over every built-in model (see defaultTable in App.tsx). Don't wire a
  // preference back onto this without changing that deliberately.
  defaultTable?: string[]
  defaultModel?: string
}

export interface PreviewResponse {
  messages: { role: string; content: string }[]
  rolesInPlay: string[]
  kinds: string[]
  tokenEstimate: number
  error?: string
}

export interface ServerPayload {
  view: PlayerView
  ask: DecisionRequest[]
  acting: Seat[]
  waitingOn: string[]
  degraded: number
  degradedSeqs: number[]
  bots: Record<number, AgentInfo>
  spectator: boolean
}

export interface LobbyPayload {
  id: string
  status: 'open' | 'started'
  gameId?: string
  playerCount: number
  humanSeats: number
  openSeats: number
  members: string[]
  spectators: number
  hostName: string
  table: { id: string; name: string; model: string }[]
}

export interface RevealPlayer {
  seat: Seat
  name: string
  role: string
  alignment: Alignment
}

export interface RevealPayload {
  players: RevealPlayer[]
  log: GameEvent[]
  degraded: { seat: Seat; kind: string; error: string }[]
  // Def snapshots taken at game start — the configs that actually played.
  agents?: Record<number, AgentInfo>
}

