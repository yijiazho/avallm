// Pure Markdown rendering for the reveal and the copyable transcript. It
// receives the finished record and a seat-name lookup, so it never needs a
// Game, a session, or the clock. Caps are re-applied here as a backstop: a
// record can arrive from an older archive or a hand-written fixture, and the
// renderer must not let one verbose field dominate the document.

import {
  POSTGAME_ALTERNATIVE_MAX_CHARS,
  POSTGAME_ASSESSMENT_MAX_CHARS,
  POSTGAME_COMMENT_MAX_CHARS,
  POSTGAME_ERROR_MAX_CHARS,
  POSTGAME_LESSON_MAX_CHARS,
  POSTGAME_MAX_COMMENTS,
  POSTGAME_MAX_DECISIONS,
  POSTGAME_STATEMENT_MAX_CHARS,
  POSTGAME_SUMMARY_MAX_CHARS,
  REVIEW_NOTE_CAP,
} from './types.ts'
import type {
  PostgameComment,
  PostgameDecision,
  PostgameRecord,
  PostgameSeat,
} from './types.ts'

const clamp = (text: string, max: number): string => text.trim().slice(0, max)

function renderDecision(decision: PostgameDecision): string[] {
  const lines = [
    `- #${decision.seq} ${decision.kind}: ${clamp(decision.assessment, POSTGAME_ASSESSMENT_MAX_CHARS)}`,
  ]
  if (decision.alternative) {
    lines.push(`  - alternative: ${clamp(decision.alternative, POSTGAME_ALTERNATIVE_MAX_CHARS)}`)
  }
  return lines
}

function renderComment(
  comment: PostgameComment,
  nameOf: (seat: number) => string,
): string {
  return `- on ${nameOf(comment.seat)} (seat ${comment.seat}): ${clamp(comment.note, POSTGAME_COMMENT_MAX_CHARS)}`
}

function renderSeat(
  seat: PostgameSeat,
  nameOf: (seat: number) => string,
): string[] {
  const out: string[] = []
  out.push(`### ${nameOf(seat.seat)} (seat ${seat.seat})`)
  out.push('')
  const identity = seat.model ? `${seat.kind}, ${seat.model}` : seat.kind
  out.push(`- status: **${seat.status}** (${identity})`)
  if (seat.cost) {
    out.push(`- cost: $${seat.cost.usd.toFixed(4)} (${seat.cost.promptTokens} prompt, ${seat.cost.completionTokens} completion tokens)`)
  }
  if (seat.error) {
    out.push(`- error: ${clamp(seat.error, POSTGAME_ERROR_MAX_CHARS)}`)
  }
  if (seat.note) {
    out.push(`- note: ${clamp(seat.note, REVIEW_NOTE_CAP)}`)
  }
  if (seat.review) {
    out.push('')
    out.push(`**Summary:** ${clamp(seat.review.summary, POSTGAME_SUMMARY_MAX_CHARS)}`)
    if (seat.review.decisions.length) {
      out.push('')
      out.push('**Decisions reviewed:**')
      for (const decision of seat.review.decisions.slice(0, POSTGAME_MAX_DECISIONS)) {
        out.push(...renderDecision(decision))
      }
    }
    if (seat.review.commentary.length) {
      out.push('')
      out.push('**Comments on the table:**')
      for (const comment of seat.review.commentary.slice(0, POSTGAME_MAX_COMMENTS)) {
        out.push(renderComment(comment, nameOf))
      }
    }
    out.push('')
    out.push(`**Lesson:** ${clamp(seat.review.lesson, POSTGAME_LESSON_MAX_CHARS)}`)
  }
  out.push('')
  return out
}

function renderTableTalk(
  record: PostgameRecord,
  nameOf: (seat: number) => string,
): string[] {
  if (!record.turnOrder?.length) return []
  const turns = record.turnOrder
    .map((seat) => record.seats[seat])
    .filter((seat): seat is PostgameSeat => seat?.review !== undefined)
  if (!turns.length) return []
  const out: string[] = ['### Table talk', '']
  turns.forEach((seat, index) => {
    const statement = seat.review?.statement ?? seat.review?.summary ?? ''
    out.push(`${index + 1}. ${nameOf(seat.seat)} (seat ${seat.seat}): "${clamp(statement, POSTGAME_STATEMENT_MAX_CHARS)}"`)
  })
  out.push('')
  return out
}

export function renderPostgameMarkdown(
  record: PostgameRecord,
  nameOf: (seat: number) => string,
): string {
  const out: string[] = []
  out.push('## Post-game review')
  out.push('')
  out.push(`- status: **${record.status}**`)
  out.push(`- started: ${record.startedAt}`)
  if (record.completedAt) out.push(`- completed: ${record.completedAt}`)
  out.push('')

  const seats = Object.values(record.seats).slice().sort((a, b) => a.seat - b.seat)
  if (!seats.length) {
    out.push('(no seats)')
    out.push('')
    return out.join('\n')
  }
  out.push(...renderTableTalk(record, nameOf))
  for (const seat of seats) out.push(...renderSeat(seat, nameOf))
  return out.join('\n')
}
