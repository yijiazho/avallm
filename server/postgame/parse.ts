// Tolerant parsing for the post-game review reply. This is deliberately
// separate from the decision parser: a review must never be mistakable for a
// Decision, and a model failure here is a status on one seat, never an error
// thrown into the finished game.
//
// The ladder is strict JSON, then the first {...} object inside prose or a
// fenced code block. Every citation is checked against the finished log,
// because an archived game is immutable and a review that cites a decision the
// seat did not make is not usable evidence.

import { isDecisionKind } from '../engine/types.ts'
import { decisionKindOf, decisionSeatOf } from './prompts.ts'
import {
  POSTGAME_ALTERNATIVE_MAX_CHARS,
  POSTGAME_ASSESSMENT_MAX_CHARS,
  POSTGAME_COMMENT_MAX_CHARS,
  POSTGAME_LESSON_MAX_CHARS,
  POSTGAME_MAX_COMMENTS,
  POSTGAME_MAX_DECISIONS,
  POSTGAME_STATEMENT_MAX_CHARS,
  POSTGAME_SUMMARY_MAX_CHARS,
} from './types.ts'
import type { DecisionKind, GameEvent, Seat } from '../engine/types.ts'
import type { PostgameView } from '../engine/view.ts'
import type {
  PostgameComment,
  PostgameDecision,
  PostgameReview,
  PostgameTurn,
} from './types.ts'

export type PostgameParseResult =
  | { ok: true; review: PostgameReview }
  | { ok: false; error: string }

export type PostgameTalkParseResult =
  | { ok: true; turn: PostgameTurn }
  | { ok: false; error: string }

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function extractObject(content: string): Record<string, unknown> | null {
  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      return asObject(JSON.parse(text))
    } catch {
      return null
    }
  }
  const direct = tryParse(content.trim())
  if (direct) return direct
  // Greedy first-{ to last-} so trailing prose or a ```json fence does not
  // truncate the object.
  const match = content.match(/\{[\s\S]*\}/)
  return match ? tryParse(match[0]) : null
}

const clamp = (value: string, max: number): string => value.trim().slice(0, max)

function requiredText(
  object: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  const value = object[key]
  if (typeof value !== 'string') return null
  const text = clamp(value, max)
  return text.length ? text : null
}

function citedDecision(
  value: unknown,
  view: PostgameView,
  eventsBySeq: ReadonlyMap<number, GameEvent>,
): PostgameDecision | string {
  const object = asObject(value)
  if (!object) return 'decision entry is not an object'
  const seq = object.seq
  if (!Number.isInteger(seq)) return 'decision seq is not an integer'
  const ev = eventsBySeq.get(seq as number)
  if (!ev) return `decision seq ${String(seq)} is not in the game log`
  if (decisionSeatOf(ev) !== view.seat) {
    return `decision seq ${String(seq)} does not belong to seat ${view.seat}`
  }
  const actualKind = decisionKindOf(ev)
  if (!actualKind) return `event seq ${String(seq)} is not a reviewable decision`
  const rawKind = object.kind
  if (typeof rawKind !== 'string') return `decision seq ${String(seq)} has no kind`
  const normalized = rawKind.trim()
  const matches = normalized === actualKind
    || normalized === ev.type
    || (ev.type === 'thinking'
      && isDecisionKind(normalized)
      && normalized === ev.payload.kind)
  if (!matches) {
    return `decision seq ${String(seq)} is a ${actualKind}, not a ${normalized}`
  }
  const assessment = requiredText(object, 'assessment', POSTGAME_ASSESSMENT_MAX_CHARS)
  if (!assessment) return `decision seq ${String(seq)} has no assessment`
  const alternativeRaw = object.alternative
  const alternative = typeof alternativeRaw === 'string'
    ? clamp(alternativeRaw, POSTGAME_ALTERNATIVE_MAX_CHARS)
    : ''
  return {
    seq: seq as number,
    kind: actualKind as DecisionKind,
    assessment,
    ...(alternative ? { alternative } : {}),
  }
}

function citedComment(
  value: unknown,
  view: PostgameView,
): PostgameComment | string {
  const object = asObject(value)
  if (!object) return 'commentary entry is not an object'
  const seat = object.seat
  if (!Number.isInteger(seat) || !view.players[seat as Seat]) {
    return `commentary seat ${String(seat)} is not at this table`
  }
  const note = requiredText(object, 'note', POSTGAME_COMMENT_MAX_CHARS)
  if (!note) return `commentary for seat ${String(seat)} has no note`
  return { seat: seat as Seat, note }
}

type CitedEvidence = {
  decisions: PostgameDecision[]
  commentary: PostgameComment[]
}

function parseEvidence(
  object: Record<string, unknown>,
  view: PostgameView,
): CitedEvidence | string {
  const rawDecisions = object.decisions
  if (!Array.isArray(rawDecisions)) return 'decisions must be an array'
  const rawComments = object.commentary
  if (!Array.isArray(rawComments)) return 'commentary must be an array'

  const eventsBySeq = new Map<number, GameEvent>()
  for (const ev of view.events) eventsBySeq.set(ev.seq, ev)

  const decisions: PostgameDecision[] = []
  for (const raw of rawDecisions.slice(0, POSTGAME_MAX_DECISIONS)) {
    const parsed = citedDecision(raw, view, eventsBySeq)
    if (typeof parsed === 'string') return parsed
    decisions.push(parsed)
  }

  const commentary: PostgameComment[] = []
  for (const raw of rawComments.slice(0, POSTGAME_MAX_COMMENTS)) {
    const parsed = citedComment(raw, view)
    if (typeof parsed === 'string') return parsed
    commentary.push(parsed)
  }
  return { decisions, commentary }
}

export function parsePostgameReply(
  content: string,
  view: PostgameView,
): PostgameParseResult {
  try {
    const object = extractObject(content)
    if (!object) return { ok: false, error: 'expected one JSON object' }

    const summary = requiredText(object, 'summary', POSTGAME_SUMMARY_MAX_CHARS)
    if (!summary) return { ok: false, error: 'missing summary' }
    const lesson = requiredText(object, 'lesson', POSTGAME_LESSON_MAX_CHARS)
    if (!lesson) return { ok: false, error: 'missing lesson' }
    // Legacy review-as-turn records may still carry a statement. New reviews
    // put the spoken words in the separate table talk.
    const statementRaw = object.statement
    const statement = typeof statementRaw === 'string'
      ? clamp(statementRaw, POSTGAME_STATEMENT_MAX_CHARS)
      : ''

    const evidence = parseEvidence(object, view)
    if (typeof evidence === 'string') return { ok: false, error: evidence }

    return {
      ok: true,
      review: {
        ...(statement ? { statement } : {}),
        summary,
        decisions: evidence.decisions,
        commentary: evidence.commentary,
        lesson,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `could not parse review: ${message}` }
  }
}

export function parsePostgameTalkReply(
  content: string,
  view: PostgameView,
): PostgameTalkParseResult {
  try {
    const object = extractObject(content)
    if (!object) return { ok: false, error: 'expected one JSON object' }

    const statement = requiredText(
      object,
      'statement',
      POSTGAME_STATEMENT_MAX_CHARS,
    )
    if (!statement) return { ok: false, error: 'missing statement' }

    const evidence = parseEvidence(object, view)
    if (typeof evidence === 'string') return { ok: false, error: evidence }

    return {
      ok: true,
      turn: {
        seat: view.seat,
        statement,
        decisions: evidence.decisions,
        commentary: evidence.commentary,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `could not parse table talk: ${message}` }
  }
}
