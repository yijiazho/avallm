// test-lane: fast
// The parser is the safety valve between model output and the record. It must
// accept strict and fenced JSON, validate every citation against the finished
// log, clamp the caps, and return an error rather than throwing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../server/engine/game.ts'
import { viewForPostgame } from '../../server/engine/view.ts'
import { parsePostgameReply } from '../../server/postgame/parse.ts'
import {
  POSTGAME_ALTERNATIVE_MAX_CHARS,
  POSTGAME_ASSESSMENT_MAX_CHARS,
  POSTGAME_COMMENT_MAX_CHARS,
  POSTGAME_LESSON_MAX_CHARS,
  POSTGAME_MAX_COMMENTS,
  POSTGAME_MAX_DECISIONS,
  POSTGAME_STATEMENT_MAX_CHARS,
  POSTGAME_SUMMARY_MAX_CHARS,
} from '../../server/postgame/types.ts'
import type { PostgameView } from '../../server/engine/view.ts'
import type {
  Decision,
  DecisionRequest,
  Game,
  GameEvent,
} from '../../server/engine/types.ts'

function decisionFor(game: Game, request: DecisionRequest): Decision {
  const quest = game.quests[game.round - 1]!
  switch (request.kind) {
    case 'discuss':
      return { kind: 'discuss', say: `talk from seat ${request.seat}` }
    case 'propose': {
      const team = Array.from({ length: quest.teamSize }, (_, i) => i)
      return { kind: 'propose', team, pitch: `pitch from seat ${request.seat}` }
    }
    case 'finalize':
      return { kind: 'finalize', stick: true }
    case 'vote':
      return { kind: 'vote', vote: 'approve' }
    case 'quest':
      return { kind: 'quest', card: 'success' }
    case 'assassinate': {
      const target = game.players.find(
        (player) => player.alignment === 'good' && player.seat !== request.seat,
      )?.seat ?? ((request.seat + 1) % game.config.playerCount)
      return { kind: 'assassinate', target }
    }
  }
}

function playedGame(seed = 'postgame-parse'): Game {
  const game = createGame({
    seed,
    playerCount: 7,
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
  })
  let steps = 0
  while (game.phase !== 'gameOver') {
    const [request] = expectedDecisions(game)
    if (!request) throw new Error('no decision owed before gameOver')
    applyDecision(game, request.seat, decisionFor(game, request))
    if (++steps > 2000) throw new Error('game did not finish')
  }
  return game
}

function fixture(): {
  game: Game
  view: PostgameView
  ownProposal: Extract<GameEvent, { type: 'proposal' }>
  ownVote: Extract<GameEvent, { type: 'voteCast' }>
  otherSeat: number
} {
  const game = playedGame()
  const proposal = game.log.find((event) => event.type === 'proposal')
  assert.ok(proposal?.type === 'proposal')
  const seat = proposal.payload.leader
  const view = viewForPostgame(game, seat)
  const ownVote = game.log.find(
    (event) => event.type === 'voteCast' && event.payload.seat === seat,
  )
  assert.ok(ownVote?.type === 'voteCast')
  return {
    game,
    view,
    ownProposal: proposal,
    ownVote,
    otherSeat: (seat + 1) % game.config.playerCount,
  }
}

function baseReview(
  proposalSeq: number,
  otherSeat: number,
): Record<string, unknown> {
  return {
    statement: 'I would take back the second team.',
    summary: 'A short review of this finished game.',
    decisions: [
      {
        seq: proposalSeq,
        kind: 'propose',
        assessment: 'The team was reasonable.',
        alternative: 'I could have widened it.',
      },
    ],
    commentary: [{ seat: otherSeat, note: 'A short note about this seat.' }],
    lesson: 'Check the vote record before revising.',
  }
}

test('strict JSON parses and keeps the citation', () => {
  const { view, ownProposal, otherSeat } = fixture()
  const result = parsePostgameReply(
    JSON.stringify(baseReview(ownProposal.seq, otherSeat)),
    view,
  )
  assert.ok(result.ok)
  assert.equal(result.review.statement, 'I would take back the second team.')
  assert.equal(result.review.decisions.length, 1)
  assert.equal(result.review.decisions[0]!.seq, ownProposal.seq)
  assert.equal(result.review.decisions[0]!.kind, 'propose')
  assert.equal(result.review.commentary[0]!.seat, otherSeat)
})

test('fenced JSON and an event-type citation also parse', () => {
  const { view, ownProposal, otherSeat } = fixture()
  const review = baseReview(ownProposal.seq, otherSeat)
  ;(review.decisions as Record<string, unknown>[])[0]!.kind = 'proposal'
  const content = `Here is the review:\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\`\nDone.`
  const result = parsePostgameReply(content, view)
  assert.ok(result.ok)
  assert.equal(result.review.decisions[0]!.kind, 'propose')
})

test('a truncated reply returns an error instead of throwing', () => {
  const { view, ownProposal, otherSeat } = fixture()
  const content = JSON.stringify(baseReview(ownProposal.seq, otherSeat)).slice(0, -12)
  const result = parsePostgameReply(content, view)
  assert.equal(result.ok, false)
})

test('unknown seq, wrong owner, and kind mismatch are rejected', () => {
  const { game, view, ownVote, otherSeat } = fixture()

  const unknown = baseReview(999_999, otherSeat)
  const unknownResult = parsePostgameReply(JSON.stringify(unknown), view)
  assert.equal(unknownResult.ok, false)

  const otherEvent = game.log.find(
    (event) => event.type === 'voteCast' && event.payload.seat !== view.seat,
  )
  assert.ok(otherEvent)
  const wrongOwner = baseReview(otherEvent.seq, otherSeat)
  ;(wrongOwner.decisions as Record<string, unknown>[])[0]!.kind = 'vote'
  const wrongOwnerResult = parsePostgameReply(JSON.stringify(wrongOwner), view)
  assert.equal(wrongOwnerResult.ok, false)
  assert.match(wrongOwnerResult.ok ? '' : wrongOwnerResult.error, /does not belong/)

  const wrongKind = baseReview(ownVote.seq, otherSeat)
  ;(wrongKind.decisions as Record<string, unknown>[])[0]!.kind = 'propose'
  const wrongKindResult = parsePostgameReply(JSON.stringify(wrongKind), view)
  assert.equal(wrongKindResult.ok, false)
  assert.match(wrongKindResult.ok ? '' : wrongKindResult.error, /not a/)
})

test('caps clamp array lengths and field lengths', () => {
  const { view, ownProposal, otherSeat } = fixture()
  const review = baseReview(ownProposal.seq, otherSeat)
  const decision = (review.decisions as Record<string, unknown>[])[0]!
  const comment = (review.commentary as Record<string, unknown>[])[0]!
  review.statement = 't'.repeat(2_000)
  review.summary = 's'.repeat(2_000)
  review.lesson = 'l'.repeat(2_000)
  decision.assessment = 'a'.repeat(2_000)
  decision.alternative = 'b'.repeat(2_000)
  comment.note = 'n'.repeat(2_000)
  review.decisions = Array.from({ length: 10 }, () => ({ ...decision }))
  review.commentary = Array.from({ length: 5 }, () => ({ ...comment }))

  const result = parsePostgameReply(JSON.stringify(review), view)
  assert.ok(result.ok)
  assert.equal(result.review.decisions.length, POSTGAME_MAX_DECISIONS)
  assert.equal(result.review.commentary.length, POSTGAME_MAX_COMMENTS)
  assert.equal(result.review.statement?.length, POSTGAME_STATEMENT_MAX_CHARS)
  assert.equal(result.review.summary.length, POSTGAME_SUMMARY_MAX_CHARS)
  assert.equal(result.review.lesson.length, POSTGAME_LESSON_MAX_CHARS)
  assert.equal(
    result.review.decisions[0]!.assessment.length,
    POSTGAME_ASSESSMENT_MAX_CHARS,
  )
  assert.equal(
    result.review.decisions[0]!.alternative?.length,
    POSTGAME_ALTERNATIVE_MAX_CHARS,
  )
  assert.equal(
    result.review.commentary[0]!.note.length,
    POSTGAME_COMMENT_MAX_CHARS,
  )
})

test('a missing statement still parses for older records', () => {
  const { view, ownProposal, otherSeat } = fixture()
  const review = baseReview(ownProposal.seq, otherSeat)
  delete review.statement
  const result = parsePostgameReply(JSON.stringify(review), view)
  assert.ok(result.ok)
  assert.equal(result.review.statement, undefined)
})

test('a non-object reply and non-string input return errors', () => {
  const { view } = fixture()
  assert.equal(parsePostgameReply('not json at all', view).ok, false)
  assert.equal(
    parsePostgameReply(null as unknown as string, view).ok,
    false,
  )
})
