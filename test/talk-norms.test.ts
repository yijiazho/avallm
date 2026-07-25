// The anti-house-style talk norms (2026-07-24 playtests): with one shared
// voice spec and no persona, every bot converged on the same debate-club
// register — essay grammar, the same accusation re-argued a dozen times,
// constant maximum intensity, "that's not X, it's Y" reframes, and spoken
// lean announcements duplicating the structured lean signal. These norms are
// the shared floor that personality work layers on top of, so pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RULES_DIGEST, INJECTION_GUARD, TABLE_TALK_NORMS, GOOD_SHARED, EVIL_SHARED,
  ROLE_GUIDANCE, OUTPUT_CONTRACTS,
} from '../server/agents/prompts.ts'

test('TABLE_TALK_NORMS carries the anti-house-style rules', () => {
  assert.match(TABLE_TALK_NORMS, /Write the way people SPEAK/)
  assert.match(TABLE_TALK_NORMS, /Make a point ONCE/)
  assert.match(TABLE_TALK_NORMS, /Vary your temperature/)
  assert.match(TABLE_TALK_NORMS, /Don't announce your lean in words/)
  assert.match(TABLE_TALK_NORMS, /Don't open every line with someone's name/)
})

// Style bleeds from the prompt into the speech it asks for: bots echoed the
// norms' own punctuation back at the table, and the bullet banning dashes
// once contained two of them. Every layer that lands in a speech-turn prompt
// must therefore be dash-free — not just the norms. (Comments are exempt:
// they never reach the model.)
test('no prompt layer shows the model a dash it is told not to use', () => {
  const layers: [string, string][] = [
    ['RULES_DIGEST', RULES_DIGEST],
    ['INJECTION_GUARD', INJECTION_GUARD],
    ['TABLE_TALK_NORMS', TABLE_TALK_NORMS],
    ['GOOD_SHARED', GOOD_SHARED],
    ['EVIL_SHARED', EVIL_SHARED],
    ...Object.entries(ROLE_GUIDANCE),
    ...Object.entries(OUTPUT_CONTRACTS),
  ]
  for (const [name, text] of layers) {
    assert.doesNotMatch(text, /[—–]/, `${name} contains an em or en dash`)
  }
})
