// test-lane: fast
// Markdown rendering is the transcript/UI view of the record. It re-applies
// the record caps so a verbose or hand-written record cannot dominate a copied
// log, and it never needs a Game or a clock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPostgameMarkdown } from '../../server/postgame/render.ts'
import {
  POSTGAME_ASSESSMENT_MAX_CHARS,
  POSTGAME_COMMENT_MAX_CHARS,
  POSTGAME_LESSON_MAX_CHARS,
  POSTGAME_MAX_COMMENTS,
  POSTGAME_MAX_DECISIONS,
  POSTGAME_SUMMARY_MAX_CHARS,
  postgameRecord,
} from '../../server/postgame/types.ts'
import type { PostgameRecord } from '../../server/postgame/types.ts'

const names = ['Alice', 'Bob', 'Cara']

function completedRecord(): PostgameRecord {
  const record = postgameRecord([
    { seat: 0, kind: 'agent', model: 'test/model' },
    { seat: 1, kind: 'human' },
  ], '2026-01-01T00:00:00.000Z')
  record.status = 'complete'
  record.completedAt = '2026-01-01T00:01:00.000Z'
  record.seats[0]!.status = 'complete'
  record.seats[0]!.cost = { promptTokens: 10, completionTokens: 20, usd: 0.0123 }
  record.seats[0]!.review = {
    statement: 'I would not repeat the second team.',
    summary: 'This is the summary.',
    decisions: Array.from({ length: 6 }, (_, index) => ({
      seq: index + 1,
      kind: 'vote',
      assessment: `assessment ${index}`,
      alternative: `alternative ${index}`,
    })),
    commentary: Array.from({ length: 4 }, (_, index) => ({
      seat: index + 1,
      note: `comment ${index}`,
    })),
    lesson: 'This is the lesson.',
  }
  record.seats[1]!.status = 'complete'
  record.seats[1]!.note = 'A human note.'
  return record
}

test('postgameRecord starts every seat pending and running', () => {
  const record = postgameRecord([
    { seat: 0, kind: 'agent', model: 'test/model' },
    { seat: 1, kind: 'human' },
  ], '2026-01-01T00:00:00.000Z')
  assert.equal(record.version, 1)
  assert.equal(record.status, 'running')
  assert.equal(record.startedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(record.seats[0]!.status, 'pending')
  assert.equal(record.seats[1]!.status, 'pending')
  assert.equal(record.seats[0]!.kind, 'agent')
  assert.equal(record.seats[1]!.kind, 'human')
})

test('the renderer shows statuses, citations, notes, and the lesson', () => {
  const markdown = renderPostgameMarkdown(completedRecord(), (seat) => names[seat] ?? `seat ${seat}`)
  assert.match(markdown, /^## Post-game review/m)
  assert.match(markdown, /status: \*\*complete\*\*/)
  assert.match(markdown, /### Table talk/)
  assert.match(markdown, /1\. Alice \(seat 0\): "I would not repeat the second team\."/)
  assert.match(markdown, /Alice \(seat 0\)/)
  assert.match(markdown, /Bob \(seat 1\)/)
  assert.match(markdown, /#1 vote: assessment 0/)
  assert.match(markdown, /alternative: alternative 0/)
  assert.match(markdown, /on Bob \(seat 1\): comment 0/)
  assert.match(markdown, /A human note\./)
  assert.match(markdown, /This is the lesson\./)
  assert.match(markdown, /cost: \$0\.0123/)
})

test('table talk follows turnOrder rather than seat order', () => {
  const record = postgameRecord([
    { seat: 0, kind: 'agent', model: 'test/a' },
    { seat: 1, kind: 'agent', model: 'test/b' },
  ], '2026-01-01T00:00:00.000Z')
  record.status = 'complete'
  record.turnOrder = [1, 0]
  record.seats[0]!.status = 'complete'
  record.seats[1]!.status = 'complete'
  record.seats[0]!.review = {
    statement: 'The first speaker is seat one.',
    summary: 'Summary zero.',
    decisions: [],
    commentary: [],
    lesson: 'Lesson zero.',
  }
  record.seats[1]!.review = {
    statement: 'The second speaker is seat zero.',
    summary: 'Summary one.',
    decisions: [],
    commentary: [],
    lesson: 'Lesson one.',
  }
  const markdown = renderPostgameMarkdown(record, (seat) => names[seat] ?? `seat ${seat}`)
  const one = markdown.indexOf('1. Bob (seat 1)')
  const two = markdown.indexOf('2. Alice (seat 0)')
  assert.ok(one >= 0)
  assert.ok(two > one)
})

test('the renderer clamps arrays and field lengths', () => {
  const record = completedRecord()
  const review = record.seats[0]!.review!
  review.summary = 's'.repeat(2_000)
  review.lesson = 'l'.repeat(2_000)
  for (const decision of review.decisions) {
    decision.assessment = 'a'.repeat(2_000)
    decision.alternative = 'b'.repeat(2_000)
  }
  for (const comment of review.commentary) {
    comment.note = 'n'.repeat(2_000)
  }

  const markdown = renderPostgameMarkdown(record, (seat) => names[seat] ?? `seat ${seat}`)
  const renderedDecisions = markdown.match(/^- #\d+ vote:/gm) ?? []
  const renderedComments = markdown.match(/^- on /gm) ?? []
  assert.equal(renderedDecisions.length, POSTGAME_MAX_DECISIONS)
  assert.equal(renderedComments.length, POSTGAME_MAX_COMMENTS)
  assert.ok(markdown.includes('s'.repeat(POSTGAME_SUMMARY_MAX_CHARS)))
  assert.ok(!markdown.includes('s'.repeat(POSTGAME_SUMMARY_MAX_CHARS + 1)))
  assert.ok(markdown.includes('l'.repeat(POSTGAME_LESSON_MAX_CHARS)))
  assert.ok(!markdown.includes('l'.repeat(POSTGAME_LESSON_MAX_CHARS + 1)))
  assert.ok(markdown.includes('a'.repeat(POSTGAME_ASSESSMENT_MAX_CHARS)))
  assert.ok(!markdown.includes('a'.repeat(POSTGAME_ASSESSMENT_MAX_CHARS + 1)))
  assert.ok(markdown.includes('n'.repeat(POSTGAME_COMMENT_MAX_CHARS)))
  assert.ok(!markdown.includes('n'.repeat(POSTGAME_COMMENT_MAX_CHARS + 1)))
})

test('the renderer shows failures without inventing a review', () => {
  const record = postgameRecord([
    { seat: 0, kind: 'agent', model: 'test/model' },
  ], '2026-01-01T00:00:00.000Z')
  record.status = 'failed'
  record.completedAt = '2026-01-01T00:02:00.000Z'
  record.seats[0]!.status = 'failed'
  record.seats[0]!.error = 'model returned no JSON'
  const markdown = renderPostgameMarkdown(record, (seat) => names[seat] ?? `seat ${seat}`)
  assert.match(markdown, /status: \*\*failed\*\*/)
  assert.match(markdown, /error: model returned no JSON/)
  assert.doesNotMatch(markdown, /\*\*Summary:\*\*/)
})
