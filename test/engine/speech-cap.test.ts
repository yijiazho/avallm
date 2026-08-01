// test-lane: fast
// Spoken text is capped at a word boundary, not sliced mid-word.
//
// A live table saw a turn end as "...testing Gemini or s". Spoken text is not
// only displayed: every other seat reads it inside their next prompt, and bots
// mimic the prose they are shown, so a ragged edge is something the table can
// learn to imitate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capSpeech } from '../../server/engine/names.ts'
import { createGame, applyDecision, expectedDecisions } from '../../server/engine/game.ts'
import { DEFAULT_ROLES } from '../../server/engine/rules.ts'

test('short text passes through untouched', () => {
  assert.equal(capSpeech('all good here', 600), 'all good here')
  // Exactly at the cap is not over it.
  assert.equal(capSpeech('x'.repeat(50), 50), 'x'.repeat(50))
})

test('a long turn is cut at a word boundary and marked', () => {
  const text = 'It smells like you are either testing Gemini or something else entirely'
  const out = capSpeech(text, 40)
  assert.ok(out.endsWith('…'), `expected a truncation marker, got ${JSON.stringify(out)}`)
  assert.ok(out.length <= 40, `cap exceeded: ${out.length}`)
  // The whole point: the visible text ends on a complete word.
  const body = out.slice(0, -1)
  assert.ok(text.startsWith(body), 'body must be a prefix of the original')
  assert.ok(!body.endsWith(' '), 'trailing space should be trimmed before the marker')
  const nextChar = text[body.length]
  assert.equal(nextChar, ' ', `cut landed mid-word: ...${JSON.stringify(body.slice(-12))}`)
})

test('a single enormous token still gets capped', () => {
  // No space to break on, so the hard cut has to win rather than the cap failing.
  const out = capSpeech('x'.repeat(500), 40)
  assert.ok(out.length <= 40)
  assert.ok(out.endsWith('…'))
})

test('the engine caps spoken text, not just the helper', () => {
  const g = createGame({ seed: 'cap', playerCount: 5, roles: DEFAULT_ROLES[5] })
  const size = g.quests[0]!.teamSize
  const team = Array.from({ length: size }, (_, i) => (g.leaderSeat + i) % 5)
  applyDecision(g, g.leaderSeat, { kind: 'propose', team, pitch: 'word '.repeat(200) })
  const proposal = g.log.find((e) => e.type === 'proposal')
  const pitch = (proposal!.payload as { pitch?: string }).pitch!
  assert.ok(pitch.length <= 400)
  assert.ok(pitch.endsWith('…'))
  assert.doesNotMatch(pitch, /\bwor…$/, 'pitch was cut mid-word')

  while (g.phase === 'discussion') {
    const [d] = expectedDecisions(g)
    applyDecision(g, d!.seat, { kind: 'discuss', say: d!.seat === team[0] ? 'talking '.repeat(200) : '' })
  }
  const said = g.log
    .filter((e) => e.type === 'utterance')
    .map((e) => (e.payload as { text?: string }).text ?? '')
    .find((t) => t.length > 100)
  if (said) {
    assert.ok(said.length <= 600)
    assert.ok(said.endsWith('…'))
    assert.doesNotMatch(said, /\btalkin…$/, 'utterance was cut mid-word')
  }
})
