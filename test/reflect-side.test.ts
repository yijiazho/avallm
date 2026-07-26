// The reflect contract separates WHICH SIDE a seat is on from HOW WELL you read
// them, because one `confidence` field was collapsing the two.
//
// Observed: a Merlin with no Mordred dealt carried two provably-good seats at
// 65-70% for a whole game, and an assassin wrote "Allen is likely a good Servant
// (55%)" about a seat its own partner list proves is good. In both the number is
// really about the ROLE guess, so the alignment certainty the seat actually held
// never made it into its own notes, and the hedge was read back as doubt on the
// next turn.
//
// side + confidence now describe the TEAM only. Doubt about the role belongs in
// the read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDecision } from '../server/agents/parse.ts'
import { OUTPUT_CONTRACTS } from '../server/agents/prompts.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'

// A real view rather than a stub. The reflect branch happens not to read it
// today, so a two-argument call would pass by luck and break silently the moment
// that changes.
const VIEW = viewFor(createGame({ seed: 'reflect', playerCount: 5, roles: DEFAULT_ROLES[5] }), 0)

const reflect = (suspicions: unknown[]) =>
  parseDecision('reflect', JSON.stringify({ suspicions, deductions: [], plan: 'watch the votes' }), VIEW)

test('the contract asks for side, and says what confidence attaches to', () => {
  const c = OUTPUT_CONTRACTS.reflect
  assert.match(c, /"side": "good"\|"evil"\|"unsure"/)
  assert.match(c, /how sure you are of that SIDE/)
  // The instruction that fixes the observed behaviour, not just the field.
  assert.match(c, /use 100 and move on/)
  assert.match(c, /put any doubt about their ROLE in the read/)
})

test('a settled side renders differently from an estimate', () => {
  const d = reflect([
    { seat: 1, side: 'evil', confidence: 100, read: 'my partner, dealt to me' },
    { seat: 2, side: 'good', confidence: 70, read: 'voted against the failed team' },
  ])
  const pad = (d as { scratchpad: string }).scratchpad
  assert.match(pad, /seat 1 \(evil, settled\): my partner/)
  assert.match(pad, /seat 2 \(good 70%\): voted against/)
  // The whole point: a reader can tell proof from estimate at a glance.
  assert.doesNotMatch(pad, /seat 1 \(evil 100%\)/)
})

test('an open side says so rather than showing a number', () => {
  const pad = (reflect([{ seat: 3, side: 'unsure', confidence: 50, read: 'nothing yet' }]) as { scratchpad: string }).scratchpad
  assert.match(pad, /seat 3 \(side open\): nothing yet/)
  assert.doesNotMatch(pad, /50%/, 'a percentage on an open side is the conflation this replaced')
})

test('a model that ignores the side field still produces usable notes', () => {
  // Weaker models drop fields. Losing the entry entirely would be far worse than
  // rendering it in the old shape.
  const pad = (reflect([{ seat: 4, confidence: 65, read: 'quiet all game' }]) as { scratchpad: string }).scratchpad
  assert.match(pad, /seat 4 \(65%\): quiet all game/)
})

test('a missing confidence is omitted, not rendered as 0%', () => {
  // `Number(undefined) || 0` used to print "(0%)", which reads as certainty that
  // the seat is NOT whatever the read says.
  const pad = (reflect([{ seat: 5, side: 'good', read: 'no number given' }]) as { scratchpad: string }).scratchpad
  assert.match(pad, /seat 5 \(good\): no number given/)
  assert.doesNotMatch(pad, /0%/)
})

test('a garbage side is ignored rather than echoed into the notes', () => {
  const pad = (reflect([{ seat: 6, side: 'PROBABLY EVIL???', confidence: 80, read: 'x' }]) as { scratchpad: string }).scratchpad
  assert.doesNotMatch(pad, /PROBABLY/)
  assert.match(pad, /seat 6 \(80%\): x/)
})

test('out-of-range confidence is clamped', () => {
  const pad = (reflect([
    { seat: 7, side: 'evil', confidence: 140, read: 'a' },
    { seat: 8, side: 'good', confidence: -20, read: 'b' },
  ]) as { scratchpad: string }).scratchpad
  assert.match(pad, /seat 7 \(evil, settled\)/, '140 clamps to 100, which is settled')
  assert.match(pad, /seat 8 \(good 0%\)/)
})
