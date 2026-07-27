// The anti-house-style talk norms (2026-07-24 playtests): with one shared
// voice spec and no persona, every bot converged on the same debate-club
// register — essay grammar, the same accusation re-argued a dozen times,
// constant maximum intensity, "that's not X, it's Y" reframes, and spoken
// lean announcements duplicating the structured lean signal. These norms are
// the shared floor that personality work layers on top of, so pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import {
  buildMessages, PLAYER_REFERENCE_NORMS, TABLE_TALK_NORMS,
} from '../server/agents/prompts.ts'
import { SPEECH_NORMS } from '../server/eval/norms.ts'
import type { LlmCallKind } from '../server/llm/call-params.ts'

test('TABLE_TALK_NORMS carries the anti-house-style rules', () => {
  assert.match(TABLE_TALK_NORMS, /Write the way people SPEAK/)
  assert.match(TABLE_TALK_NORMS, /Make a point ONCE/)
  assert.match(TABLE_TALK_NORMS, /Vary your temperature/)
  assert.match(TABLE_TALK_NORMS, /Don't announce your lean in words/)
})

test('every LLM call gets a neutral player-reference rule', () => {
  assert.match(PLAYER_REFERENCE_NORMS, /always use singular they, them, and their/)
  assert.match(PLAYER_REFERENCE_NORMS, /Never infer a player's gender/)

  const g = createGame({ seed: 'neutral-pronouns', playerCount: 5 })
  const view = viewFor(g, 0)
  const kinds: LlmCallKind[] = [
    'discuss', 'propose', 'pitch', 'finalize', 'vote', 'quest', 'assassinate', 'reflect',
  ]
  for (const kind of kinds) {
    const [system] = buildMessages(kind, view, '')
    assert.ok(system.content.includes(PLAYER_REFERENCE_NORMS), `${kind} prompt carries the rule`)
  }

  const [custom] = buildMessages('discuss', view, '', {
    personality: 'Use a custom voice that may describe another player differently.',
  })
  assert.ok(
    custom.content.indexOf(PLAYER_REFERENCE_NORMS) > custom.content.indexOf('Your table persona'),
    'the engine-owned rule takes precedence over custom prompt layers',
  )
})

// Dropped on evidence, not taste: a matched A/B (same seeds, same roster)
// showed the name-opener ban changing nothing (control 56%/59% of turns
// opening with a name, treatment 50%/68%), while the lean-announcement ban
// next to it drove spoken leans to zero and regressed when weakened. It also
// fought the adjacent "refer to players by NAME" rule. Instruction budget is
// finite and the weakest model already drops rules, so a bullet that does not
// earn its place is a cost. Re-add only with evidence.
test('the norms do not carry the unearned name-opener ban', () => {
  assert.doesNotMatch(TABLE_TALK_NORMS, /open every line with someone's name/)
  assert.match(TABLE_TALK_NORMS, /Refer to players by NAME/)
})

// THE MIMICRY GUARD. Prompt style bleeds into the speech the prompt asks for:
// bots echo back the punctuation and rhetorical shapes they are shown. Measured
// (matched A/B, same seeds and roster, 4 games): stripping dashes from the
// prompt dropped dashes in bot speech from 0.46-0.53 to 0.27-0.35 per utterance.
// The bullet banning dashes had itself contained two of them.
//
// This asserts over RENDERED prompts, not over the exported constants, because
// that is the only place the whole surface is visible at once. An earlier
// version checked the constants alone and missed ASKS (which is not even
// exported, and held ~20 of the ~42 dashes), publicStateText, knowledgeText,
// and the facts dossier — so a dash added to any of those would have regressed
// the measured fix with the suite still green.
//
// If you are adding prompt text and this test fails: rewrite the sentence, do
// not weaken the test. End the sentence and start another one; a colon, comma,
// or parentheses covers nearly every case a dash was doing.
// Imported rather than declared here, so this guard and the runtime counter over
// bot SPEECH (eval/norms.ts, reported by `npm run sim`) test the same rule. They
// are two halves of one loop: this side proves we never show the model the
// construction, that side measures how often it produces it anyway. Two copies
// of the regex would let the halves drift and quietly stop being comparable.
//
// The slogan pattern matches only the copula ANTITHESIS reframe ("that's not
// trust, that's hush money"), which is the actual tell. NOT plain contrast ("my
// issue is with you, not Flash"), which is ordinary English and would flag half
// of normal speech.
const BANNED_DASH = SPEECH_NORMS['em-or-en-dash'].pattern
const BANNED_SLOGAN = SPEECH_NORMS['not-x-that-y'].pattern
const BANNED_GENDERED_PRONOUN = /\b(?:he|him|his|himself|she|her|hers|herself)\b/i
// The norms name the anti-pattern on purpose, and quoting an ANTI-example is
// safe (bots parrot quoted positive examples, not negative ones — measured).
const ANTI_EXAMPLE = `"that's not X, that's Y"`

// A live mid-game fixture: two resolved quests so the derived-facts dossier,
// the Merlin spotless-streak line, and the Percival paired-record line all
// render rather than being skipped as early-game empties.
function midGame() {
  const g = createGame({ seed: 'mimicry', playerCount: 7, talk: { maxRounds: 1, maxRoundsAfterChange: 0 } })
  for (let round = 0; round < 2; round++) {
    const size = g.quests[g.round - 1].teamSize
    const team = Array.from({ length: size }, (_, i) => (g.leaderSeat + i) % 7)
    applyDecision(g, g.leaderSeat, { kind: 'propose', team, pitch: 'a clean pair to open with' })
    while (g.phase === 'discussion') {
      const [d] = expectedDecisions(g)
      applyDecision(g, d.seat, { kind: 'discuss', say: '' })
    }
    if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
    for (const r of expectedDecisions(g)) applyDecision(g, r.seat, { kind: 'quest', card: 'success' })
  }
  return g
}

test('no rendered prompt shows the model a construction the norms ban', () => {
  const g = midGame()
  const kinds: LlmCallKind[] = [
    'discuss', 'propose', 'pitch', 'finalize', 'vote', 'quest', 'assassinate', 'reflect',
  ]
  // Every seat, so role-specific guidance and every knowledge-line branch
  // (merlin / percival / evil partners / no knowledge) is covered.
  for (const p of g.players) {
    const view = viewFor(g, p.seat)
    for (const kind of kinds) {
      const [sys, user] = buildMessages(kind, view, '', {}, { chosenTeam: view.currentTeam ?? [0, 1] })
      const rendered = `${sys.content}\n${user.content}`
      const where = `${kind} prompt for seat ${p.seat} (${p.role})`
      assert.doesNotMatch(rendered, BANNED_DASH, `${where} contains an em or en dash`)
      assert.doesNotMatch(
        rendered.split(ANTI_EXAMPLE).join(''),
        BANNED_SLOGAN,
        `${where} contains a "that's not X, that's Y" reframe`,
      )
      assert.doesNotMatch(
        rendered,
        BANNED_GENDERED_PRONOUN,
        `${where} assumes a player's gender instead of using singular they`,
      )
    }
  }
})

// CURATED agents ship WITH the repo (read-only, baked into the deploy image),
// so their personality/strategy text is ours and gets the same speech-style
// rules as the engine prompts. It matters MORE here than anywhere else:
// persona text is the layer closest to "how to talk", and its quoted example
// lines are the text bots copy hardest. All six curated agents violated this
// when written (12 dashes, all in persona slots).
//
// Do not apply the gendered-pronoun scan to these fields. A persona based on a
// known character may intentionally describe its OWN identity with explicit
// pronouns. References to OTHER players stay neutral through the engine-owned
// PLAYER_REFERENCE_NORMS, which is appended after every persona layer.
//
// USER agents (data/agents/*.json, authored at runtime through the API) are
// deliberately NOT checked, and must never be. That text belongs to the user:
// rejecting their punctuation would break the custom-agent feature for no good
// reason, and mimicry there is a FEATURE, since someone who writes a persona in
// a distinctive voice should get that voice back. The line is authorship, not
// file format: we hold OUR text to the style, never theirs.
test('curated agent prompt text follows the same house style', () => {
  const dir = new URL('../agents/', import.meta.url)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.ok(files.length > 0, 'expected curated agents to exist')
  for (const file of files) {
    const def = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'))
    const e = def.engine ?? {}
    if (e.type !== 'llm') continue
    const fields: [string, unknown][] = [
      ['personality', e.personality],
      ['strategy', e.strategy],
      ...Object.entries(e.roleGuidance ?? {}).map(([k, v]) => [`roleGuidance.${k}`, v] as [string, unknown]),
      ...Object.entries(e.kindGuidance ?? {}).map(([k, v]) => [`kindGuidance.${k}`, v] as [string, unknown]),
    ]
    for (const [name, text] of fields) {
      if (typeof text !== 'string') continue
      const where = `${file} ${name}`
      assert.doesNotMatch(text, BANNED_DASH, `${where} contains an em or en dash`)
      assert.doesNotMatch(text, BANNED_SLOGAN, `${where} contains a "that's not X, that's Y" reframe`)
    }
  }
})

// The render test above proves the invariant end to end, but it can only see
// the branches its fixture reaches. That is a real hole, not a theoretical one:
// the board row for "quest phase over" renders only after a side has already
// won, so a dash sitting there passes the render test completely. Exactly that
// dash arrived with a rebase and was caught by hand, which is the kind of luck
// a guard exists to replace.
//
// So also scan the SOURCE of every module that builds prompt text. This is
// branch-independent by construction: it cannot care which arm of a ternary a
// given board state selects. Comment stripping is heuristic rather than a real
// parse, which can only ever make this check see LESS than the whole file, so
// the render test stays as the complement that reads composed output.
const PROMPT_SOURCES = ['prompts.ts', 'facts.ts']

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlocks
    .split('\n')
    // Cut at the first "//" not preceded by ":", so "https://" survives.
    .map((line) => {
      const m = line.match(/(^|[^:])\/\//)
      return m ? line.slice(0, m.index! + (m[1] ? 1 : 0)) : line
    })
    .join('\n')
}

test('prompt-building source carries no banned construction in any branch', () => {
  for (const name of PROMPT_SOURCES) {
    const src = fs.readFileSync(new URL(`../server/agents/${name}`, import.meta.url), 'utf8')
    const code = stripComments(src)
    code.split('\n').forEach((line, i) => {
      assert.doesNotMatch(
        line, BANNED_DASH,
        `server/agents/${name}:${i + 1} has an em or en dash in prompt text (comments are exempt, so this is a string the model sees)`,
      )
      assert.doesNotMatch(
        line, BANNED_GENDERED_PRONOUN,
        `server/agents/${name}:${i + 1} has a gendered third-person pronoun in prompt text`,
      )
    })
  }
})
