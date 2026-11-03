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
export const POSTGAME_STATEMENT_MAX_CHARS = 500
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
  /**
   * Legacy spoken turn from the review-as-turn design. New records put the
   * spoken words in `PostgameRecord.tableTalk`; this stays optional so older
   * archives still render.
   */
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

export interface PostgameSeat {
  seat: Seat
  kind: 'agent' | 'human'
  model?: string
  status: PostgameSeatStatus
  /** Agent self-review. Absent for humans unless a model coached them. */
  review?: PostgameReview
  /** Human-authored note, stored verbatim and sanitized only when rendered. */
  note?: string
  /** Review failure. A failed review is a status, not a game error. */
  error?: string
  /** Table-talk failure. The review can still run from the other turns. */
  talkError?: string
  /** Review spend. */
  cost?: { promptTokens: number; completionTokens: number; usd: number }
  /** Table-talk spend, kept separate so the two paid phases are visible. */
  talkCost?: { promptTokens: number; completionTokens: number; usd: number }
}

export type PostgamePhase = 'talk' | 'review'

export interface PostgameRecord {
  version: 1
  startedAt: string
  completedAt?: string
  status: PostgameStatus
  /** Which phase the running record is in; absent on older records. */
  phase?: PostgamePhase
  seats: Record<Seat, PostgameSeat>
  /**
   * The table talk that ran before the independent reviews. Present (possibly
   * empty) on new records; absent on records written before the split.
   */
  tableTalk?: PostgameTurn[]
  /** Legacy turn order from the review-as-turn design; optional. */
  turnOrder?: Seat[]
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
    phase: 'talk',
    seats: bySeat,
    tableTalk: [],
  }
}

/** The seats that received a model call. Humans and model-free agents are not here. */
export function modeledSeats(record: PostgameRecord): PostgameSeat[] {
  return Object.values(record.seats).filter(
    (seat) => seat.kind === 'agent' && seat.model !== undefined,
  )
}

/**
 * Terminal aggregation over MODEL seats only. A human note is optional, so a
 * human seat left pending never keeps the record running and never turns an
 * otherwise-complete record into a failure. This is the one place both the
 * runner and the boot settlement ask "is the fan-out over?".
 */
export function postgameStatusFromSeats(
  seats: readonly PostgameSeat[],
): PostgameStatus {
  const modeled = seats.filter(
    (seat) => seat.kind === 'agent' && seat.model !== undefined,
  )
  if (modeled.some((seat) => seat.status === 'pending' || seat.status === 'running')) {
    return 'running'
  }
  if (modeled.every((seat) => seat.status === 'complete' || seat.status === 'unavailable')) {
    return 'complete'
  }
  const completed = modeled.filter((seat) => seat.status === 'complete').length
  const failed = modeled.filter((seat) => seat.status === 'failed').length
  if (completed > 0 && failed > 0) return 'partial'
  if (completed === 0) return failed > 0 ? 'failed' : 'complete'
  return 'partial'
}

/**
 * A process restart cannot resume a paid fan-out. Settle an archive record left
 * running without spending money: every model seat that did not finish becomes
 * failed, and the record is partial when at least one seat completed.
 */
export function settleInterruptedPostgame(
  record: PostgameRecord,
  completedAt: string,
): PostgameRecord {
  const modeled = modeledSeats(record)
  for (const seat of modeled) {
    if (seat.status === 'pending' || seat.status === 'running') {
      seat.status = 'failed'
      seat.error ??= 'review interrupted by a server restart'
    }
  }
  record.status = modeled.some((seat) => seat.status === 'complete')
    ? 'partial'
    : 'failed'
  record.completedAt = completedAt
  return record
}
