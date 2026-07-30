// The shipped talk pacing, pinned.
//
// It used to live in two places: the engine default in createGame, and a verbatim
// copy in server.ts's live-game path. Nothing checked that they agreed, so the
// product pacing could be changed in one and silently not the other. Changing it
// (3,2 -> 2,1, on playback feedback that rounds drag) is what surfaced that, and
// the whole suite passed either way, which is the other half of the problem.
//
// So this asserts the value AND that the web path still inherits it, behaviourally
// rather than by reading the config back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import type { Game } from '../server/engine/types.ts'

const fresh = () => createGame({ seed: 'talk-default', playerCount: 5, roles: DEFAULT_ROLES[5] })

test('the default talk config is 2,1 with the leader closing', () => {
  const g = fresh()
  assert.equal(g.config.talk.maxRounds, 2)
  assert.equal(g.config.talk.maxRoundsAfterChange, 1)
  assert.equal(g.config.talk.leaderInDiscussion, 'last')
})

// Count discussion rounds by watching the round number the engine reports, since
// that is what actually caps the table. Reading maxRounds back would pass even if
// endDiscussion stopped honouring it.
function runDiscussion(g: Game): number {
  let seen = 0
  while (g.phase === 'discussion') {
    seen = Math.max(seen, g.discussion!.roundNum)
    const [d] = expectedDecisions(g)
    // Say something substantive so the transcript shows the round actually
    // happened; an empty pass counts as a turn either way.
    applyDecision(g, d.seat, { kind: 'discuss', say: `seat ${d.seat} has a view` })
  }
  return seen
}

test('a default game actually runs two rounds, and one after a revision', () => {
  const g = fresh()
  applyDecision(g, g.leaderSeat, { kind: 'propose', team: [0, 1] })
  assert.equal(runDiscussion(g), 2, 'initial segment')

  assert.equal(g.phase, 'finalize')
  applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: false, team: [0, 2] })
  assert.equal(runDiscussion(g), 1, 'post-revision segment')
})

test('the live-game path does not carry its own copy of the pacing', () => {
  // The fixture game for /api/agents/preview sets talk deliberately (it needs a
  // short, fixed shape). The LOBBY path must not, or the product default is
  // maintained in two files again. One occurrence is the fixture; two means the
  // duplicate is back.
  const src = fs.readFileSync(new URL('../server/server.ts', import.meta.url), 'utf8')
  const overrides = src.match(/talk:\s*\{\s*maxRounds/g) ?? []
  assert.equal(overrides.length, 1,
    `expected only the /api/agents fixture to set talk, found ${overrides.length} overrides in server.ts`)
})
