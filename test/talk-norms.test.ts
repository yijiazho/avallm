// The anti-house-style talk norms (2026-07-24 playtests): with one shared
// voice spec and no persona, every bot converged on the same debate-club
// register — essay grammar, the same accusation re-argued a dozen times,
// constant maximum intensity, "that's not X, it's Y" reframes, and spoken
// lean announcements duplicating the structured lean signal. These norms are
// the shared floor that personality work layers on top of, so pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TABLE_TALK_NORMS } from '../server/agents/prompts.ts'

test('TABLE_TALK_NORMS carries the anti-house-style rules', () => {
  assert.match(TABLE_TALK_NORMS, /Write SPEECH, not prose/)
  assert.match(TABLE_TALK_NORMS, /Make a point ONCE/)
  assert.match(TABLE_TALK_NORMS, /Vary your temperature/)
  assert.match(TABLE_TALK_NORMS, /don't announce your lean in words/)
  assert.match(TABLE_TALK_NORMS, /don't open every line with someone's name/)
})
