// Percival's fail-attribution rule, and the cast where he has no decoy.
//
// The guidance used to say a quest failure names whichever candidate was aboard
// as Morgana, flatly. That is unsound: the standard cast also seats an Assassin
// OUTSIDE the pair who can play the Fail himself, so a fail on a team carrying
// one of those seats is already explained and says nothing about the pair.
//
// It cost a real game (seed web-086364ddc4). Q2 failed with the Assassin and one
// candidate aboard. The rule fired as written and named the candidate, who was
// Merlin. Percival then rode that inversion from 60% to 90% while the actual
// Morgana played Fail on the last two quests. He had the premise he needed and
// the rule told him to skip it: his own notes that round read "seat 3: Assassin
// or Servant", so he knew an Assassin sat outside his pair.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { knowledgeText, roleGuidanceFor } from '../server/agents/prompts.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import type { Game, Role } from '../server/engine/types.ts'

const percivalView = (g: Game) => {
  const p = g.players.find((x) => x.role === 'percival')
  assert.ok(p, 'no percival in this deal')
  return viewFor(g, p.seat)
}
const guidanceFor = (roles: Role[]) => {
  const g = createGame({ seed: 'perc', playerCount: roles.length, roles: [...roles] })
  return roleGuidanceFor('percival', {}, percivalView(g))
}

const WITH_DECOY = DEFAULT_ROLES[5]
// Legal, and what the picker's Advanced preset builds at 5 and 6 players: the
// two evil seats go to Assassin and Mordred, so no Morgana is dealt.
const NO_DECOY: Role[] = ['merlin', 'percival', 'servant', 'assassin', 'mordred']

test('the fail rule is conditional on nobody outside the pair being aboard', () => {
  const text = guidanceFor(WITH_DECOY)
  assert.match(text, /OUTSIDE your pair/, 'must tell him to check the seats outside his pair')
  assert.match(text, /NO outside seat/, 'must state the condition under which a Fail names a candidate')
  assert.match(text, /already explained without either candidate/,
    'must say an outside evil absorbs the Fail, leaving the pair open')
})

test('the fail rule does not reassert the unsound absolute it replaced', () => {
  const text = guidanceFor(WITH_DECOY)
  // The exact shape of the old bug: a failure naming a candidate with no
  // condition attached. If this ever matches again, the inversion is back.
  assert.doesNotMatch(text, /check which of your two candidates was ON that team[^.]*\.\s*That one is Morgana/)
})

test('a success still clears nobody, and an approve is weaker than being aboard', () => {
  const text = guidanceFor(WITH_DECOY)
  assert.match(text, /SUCCEEDS on clears nothing/)
  assert.match(text, /approve a team that later failed is weaker/)
})

test('with no Morgana dealt, Percival gets the protection baseline instead', () => {
  const text = guidanceFor(NO_DECOY)
  assert.match(text, /protection rather than identification/)
  // The tell-them-apart framing describes a player who is not at this table.
  assert.doesNotMatch(text, /\bMorgana\b/)
  // The discriminator has to be a phrase the WITH-decoy baseline actually
  // carries, or it stops testing anything the moment that wording changes.
  assert.doesNotMatch(text, /two candidates apart/)
  assert.match(guidanceFor(WITH_DECOY), /two candidates apart/, 'the discriminator must exist to discriminate')
})

test('the no-decoy knowledge line does not re-offer Merlin as unplaced', () => {
  const g = createGame({ seed: 'perc-nd', playerCount: 5, roles: [...NO_DECOY] })
  const view = percivalView(g)
  const text = knowledgeText(view)
  // He is told outright which seat holds Merlin...
  assert.match(text, /is Merlin, and you know it outright/)
  // ...so the composition of the remaining seats must not list Merlin again.
  const composition = text.slice(text.indexOf('The other'))
  assert.ok(composition.length, 'expected a composition line')
  assert.doesNotMatch(composition, /Merlin/,
    'Merlin is already located, so listing him among the unknown seats contradicts the sentence above')
})
