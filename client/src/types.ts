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
  DecisionKind,
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
  DecisionKind,
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
  usesModel: boolean
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

export interface PostgameDecision {
  seq: number
  kind: DecisionKind
  assessment: string
  alternative?: string
}

export interface PostgameComment {
  seat: Seat
  note: string
}

export interface PostgameReview {
  /** Legacy spoken turn from the review-as-turn design; old records may have it. */
  statement?: string
  summary: string
  decisions: PostgameDecision[]
  commentary: PostgameComment[]
  lesson: string
}

/** One seat's turn in the table talk that runs before the reviews. */
export interface PostgameTurn {
  seat: Seat
  statement: string
  decisions: PostgameDecision[]
  commentary: PostgameComment[]
}

/** Mirrors POSTGAME_STATEMENT_MAX_CHARS on the server; the route is the authority. */
export const POSTGAME_STATEMENT_CAP = 500

export type PostgameStatus = 'running' | 'complete' | 'partial' | 'failed'
export type PostgameSeatStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'unavailable'

export interface PostgameSeat {
  seat: Seat
  kind: 'agent' | 'human'
  model?: string
  status: PostgameSeatStatus
  review?: PostgameReview
  note?: string
  error?: string
  talkError?: string
  cost?: { promptTokens: number; completionTokens: number; usd: number }
  talkCost?: { promptTokens: number; completionTokens: number; usd: number }
}

export type PostgamePhase = 'talk' | 'review'

export interface PostgameRecord {
  version: 1
  startedAt: string
  completedAt?: string
  status: PostgameStatus
  /** Which phase a running record is in; old records may omit it. */
  phase?: PostgamePhase
  seats: Record<Seat, PostgameSeat>
  /** The talk that ran before the reviews; absent on old records. */
  tableTalk?: PostgameTurn[]
  /** Human seats that explicitly passed on their table-talk turn. */
  skippedTalk?: Seat[]
  /** Legacy speaking order from the review-as-turn design; old records may have it. */
  turnOrder?: Seat[]
}

export interface PostgameSummary {
  status: PostgameStatus
  completed: number
  total: number
  rev: number
}

/** GET /api/game/:id/review. The full record is deliberately not in /reveal. */
export interface ReviewPayload {
  postgame?: PostgameRecord
  canReview: boolean
  rev: number
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
  postgame?: PostgameSummary
}

// Mirrors the server's lobby DTO (server/server.ts lobbyPayload). gameId's
// presence follows from status, so the two travel as a discriminated union
// rather than an independent flag plus an optional field.
interface LobbyPayloadCommon {
  id: string
  playerCount: number
  humanSeats: number
  openSeats: number
  members: string[]
  spectators: number
  hostName: string
  table: { id: string; name: string; model: string }[]
}
export type LobbyPayload =
  | (LobbyPayloadCommon & { status: 'open' })
  | (LobbyPayloadCommon & { status: 'started'; gameId: string })

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
  // Only whether this requester may write a note, and the cap the server
  // enforces. The review itself is fetched separately from /review.
  canReview?: boolean
  reviewNoteCap?: number
}
