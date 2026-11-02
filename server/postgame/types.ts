// The post-game record lives BESIDE the game, not inside it. A review is
// meta-game: it can arrive late, fail, be rewritten, and contains model prose.
// Putting it in game.log would force a schema bump, break replay equivalence,
// and leak into every PlayerView. It is therefore not a DecisionKind, not a
// GameEvent, and not a PlayerView extension.
//
// server/postgame/ may import server/engine, server/llm, and server/archive.
// The engine and every decision agent must never import this module.

import type { DecisionKind, Seat } from '../engine/types.ts'

export const POSTGAME_VERSION = 1

/** Caps shared by the parser, the prompt contract, and the renderer. */
export const POSTGAME_MAX_DECISIONS = 4
export const POSTGAME_MAX_COMMENTS = 2
export const POSTGAME_SUMMARY_MAX_CHARS = 600
export const POSTGAME_LESSON_MAX_CHARS = 400
export const POSTGAME_ASSESSMENT_MAX_CHARS = 400
export const POSTGAME_ALTERNATIVE_MAX_CHARS = 400
export const POSTGAME_COMMENT_MAX_CHARS = 300
export const POSTGAME_ERROR_MAX_CHARS = 500
/** Human-authored note cap (REVIEW-003 owns the endpoint that enforces it). */
export const REVIEW_NOTE_CAP = 2000
/** Default character budget for one seat's rendered decision ledger. */
export const POSTGAME_LEDGER_MAX_CHARS = 8000

export type PostgameStatus = 'running' | 'complete' | 'partial' | 'failed'
export type PostgameSeatStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'unavailable'

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
  summary: string
  decisions: PostgameDecision[]
  commentary: PostgameComment[]
  lesson: string
}

export interface PostgameSeat {
  seat: Seat
  kind: 'agent' | 'human'
  model?: string
  status: PostgameSeatStatus
  /** Agent self-review. Absent for humans unless a model coached them. */
  review?: PostgameReview
  /** Human-authored note, stored verbatim and sanitized only when rendered. */
  note?: string
  error?: string
  cost?: { promptTokens: number; completionTokens: number; usd: number }
}

export interface PostgameRecord {
  version: 1
  startedAt: string
  completedAt?: string
  status: PostgameStatus
  seats: Record<Seat, PostgameSeat>
}

/** The seat facts a fresh record needs; no review or status yet. */
export interface PostgameSeatInit {
  seat: Seat
  kind: 'agent' | 'human'
  model?: string
}

/**
 * Start a record with every seat pending. The caller supplies `startedAt` when
 * it needs deterministic output; the default keeps the convenience constructor
 * usable from the runner.
 */
export function postgameRecord(
  seats: readonly PostgameSeatInit[],
  startedAt: string = new Date().toISOString(),
): PostgameRecord {
  const bySeat: Record<Seat, PostgameSeat> = {}
  for (const seat of seats) {
    bySeat[seat.seat] = {
      seat: seat.seat,
      kind: seat.kind,
      ...(seat.model === undefined ? {} : { model: seat.model }),
      status: 'pending',
    }
  }
  return {
    version: POSTGAME_VERSION,
    startedAt,
    status: 'running',
    seats: bySeat,
  }
}
