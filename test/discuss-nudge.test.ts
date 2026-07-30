// Experiment 4 (a84664a): the discuss ask must not teach passivity as a
// statistic. "most players pass by round 2" was removed because it encouraged
// bots to stay quiet when their own public record demanded a reaction, and it
// cost 12 commitment-failure incidents. That prohibition is permanent.
//
// A later round now carries a NARROWER rule: do not restate a point you have
// already made. The distinction is the whole reason this is safe to reintroduce
// where the statistic was not. The statistic suppressed speech by default; this
// suppresses only duplication, and names the two things a later round exists
// for (a response you owe, a read that changed) as still being speech. Both
// halves are pinned below, because dropping either one turns this back into the
// clause that caused the incidents.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages } from '../server/agents/prompts.ts'

// maxRounds 3 so every round asserted on below is one the engine can really
// reach; discussionRound is still set directly, since driving a live game to
// round 3 would say nothing extra about a prompt that reads only that field.
const askAtRound = (round: number): string => {
  const g = createGame({ seed: 'nudge', playerCount: 5, talk: { maxRounds: 3, maxRoundsAfterChange: 1 } })
  const view = viewFor(g, 0)
  view.discussionRound = round
  const [, user] = buildMessages('discuss', view, '', {})
  return user.content
}

test('the discuss ask never teaches passivity as a statistic', () => {
  for (const round of [1, 2, 3]) {
    assert.ok(
      !askAtRound(round).includes('most players pass by round 2'),
      `round ${round}: the "most players pass by round 2" clause must stay removed`,
    )
  }
})

test('round 1 asks for speech on a real signal and allows a genuine pass', () => {
  const ask = askAtRound(1)
  assert.match(ask, /Speak when you have something real to add/)
  assert.match(ask, /a fresh read, a contradiction to point out, or a result or vote that implicates you/)
  assert.match(ask, /Pass when you genuinely have nothing to add and nothing is aimed at you\./)
})

test('a later round bars restatement while protecting the turns it exists for', () => {
  const ask = askAtRound(2)
  // The narrow target: duplication, named as a tell rather than as a norm.
  assert.match(ask, /repeating a point you already made/)
  // The guardrail. A later round is where an accused seat answers, so every
  // reason to speak has to survive alongside the bar on restating. The
  // implicating result or vote is the essential one: it is the case
  // addressNote cannot cover, because directAddresses needs a name mention and
  // a quest result names nobody, and it is the case a84664a's incidents were.
  assert.match(ask, /a response you owe someone/)
  assert.match(ask, /a quest result or vote that implicates you/)
  assert.match(ask, /a read that changed/)
})
