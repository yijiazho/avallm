// A prompt must not contradict itself inside one sentence.
//
// Why this is its own audit: the phantom-role and talk-norm audits both check
// rendered prompts against a rule the text either follows or breaks, word by
// word. This checks a different failure, one that no single word is wrong in.
// Text assembled by joining a variable-length list can be perfectly true for one
// item and self-refuting for two, and both the diff and a single-item test read
// clean.
//
// The miss that motivated it: `recordLine` captioned each record-derived
// deduction with "of the players on it he is the only one left you cannot
// already account for". A quest that takes more Fails than the rest of its team
// can account for closes several seats at once, so that singular claim was
// printed about each of two players in the same sentence. Measured after the
// fact: 929 of 2713 renders. Reading the diff did not surface it, and the test
// written alongside it passed, because it only built the single-seat case.
//
// Both detectors below are deliberately shallow. They cannot judge whether a
// claim is TRUE, only whether the sentence contradicts itself on its face, which
// is the part that survives without a model in the loop.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { buildMessages } from '../server/agents/prompts.ts'
import { legalCasts } from './casts.ts'
import type { Game, Role } from '../server/engine/types.ts'
import type { LlmCallKind } from '../server/llm/call-params.ts'

// Claims that can only be true of ONE thing. Two in a sentence is either two
// different subjects (rare in this corpus, and the exemption list carries them)
// or the list-rendering bug.
const UNIQUENESS = [
  /\bthe only (?:one|seat|player|person|thing)\b/gi,
  /\bis the one (?:who|left|player|seat)\b/gi,
  /\bnobody else\b/gi,
  /\bno other (?:seat|player)\b/gi,
]

// Sentences whose repeated uniqueness claim is about genuinely different things.
// Kept as whole sentences rather than as loosened patterns: an exemption that is
// a regex tends to grow until it exempts the bug too.
const ALLOWED: string[] = []

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

// The dossier and the vote record are DATA renderers with their own format
// conventions (facts.ts header: one row per entity, `key: value` cells) and
// their own tests. Repetition there is the format working: every row carries the
// same column labels by design, so the run detector has nothing to say about
// them. It still has plenty to say about the prose around them.
//
// Uniqueness claims are different and are checked everywhere, because a data row
// never says "the only one" and a prose sentence that does is making a claim
// whether it sits next to a table or not.
const TABULAR = /[|]|->|→|^Q\d/

// Prompts are prose with parenthetical asides and quoted fragments, so this is a
// coarse split. Coarse in the STRICT direction (a missed boundary joins two
// sentences and gives the detectors more to complain about), which is the safe
// way for it to be wrong.
const sentences = (text: string) =>
  text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => words(s).length > 3)

function repeatedUniqueness(sentence: string): string | null {
  for (const re of UNIQUENESS) {
    const hits = sentence.match(re)
    if (hits && hits.length > 1) return `"${hits[0]}" claimed ${hits.length} times`
  }
  return null
}

// The same run of words twice in one sentence. This is what a list rendered with
// a per-item caption produces verbatim, and legitimate prose in this corpus does
// not repeat eight words in a row.
const RUN = 8
function repeatedRun(sentence: string): string | null {
  const w = words(sentence).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''))
  if (w.length < RUN * 2) return null
  const seen = new Set<string>()
  for (let i = 0; i + RUN <= w.length; i++) {
    const run = w.slice(i, i + RUN).join(' ')
    if (seen.has(run)) return `"${run}" appears twice`
    seen.add(run)
  }
  return null
}

// A board with a FAILED quest on it. The phantom audit drives successes only, so
// every branch gated on a failure (the quest-evidence rows, the record
// deductions, the Percival paired record) renders as empty there and the audit
// silently covers less than it looks like it does.
function boardWithFailure(playerCount: number, roles: Role[], seed: string): Game {
  const g = createGame({
    seed, playerCount, roles: [...roles],
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
  })
  for (let round = 0; round < 2 && g.phase !== 'gameOver'; round++) {
    const size = g.quests[g.round - 1].teamSize
    // Seat the evil players first, so the team carries as many as it can hold
    // and a 2-Fail quest is reachable at the player counts that have one.
    const evil = g.players.filter((p) => p.alignment === 'evil').map((p) => p.seat)
    const rest = g.players.map((p) => p.seat).filter((s) => !evil.includes(s))
    const team = [...evil, ...rest].slice(0, size)
    applyDecision(g, g.leaderSeat, { kind: 'propose', team, pitch: 'the fastest way to a result' })
    while (g.phase === 'discussion') {
      const [d] = expectedDecisions(g)
      applyDecision(g, d.seat, { kind: 'discuss', say: '' })
    }
    if (g.phase === 'finalize') applyDecision(g, g.leaderSeat, { kind: 'finalize', stick: true })
    for (const p of g.players) applyDecision(g, p.seat, { kind: 'vote', vote: 'approve' })
    for (const r of expectedDecisions(g)) {
      if (r.kind !== 'quest') continue
      applyDecision(g, r.seat, { kind: 'quest', card: g.players[r.seat].alignment === 'evil' ? 'fail' : 'success' })
    }
  }
  return g
}

const KINDS: LlmCallKind[] = ['discuss', 'propose', 'pitch', 'finalize', 'vote', 'quest', 'reflect']

function renderAll(g: Game, hasAssassin: boolean): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = []
  const kinds = hasAssassin ? [...KINDS, 'assassinate' as LlmCallKind] : KINDS
  for (const p of g.players) {
    const view = viewFor(g, p.seat)
    for (const kind of kinds) {
      const [sys, user] = buildMessages(kind, view, '', {}, { chosenTeam: view.currentTeam ?? [0, 1] })
      out.push({ where: `${kind} prompt for a ${p.role} seat`, text: `${sys.content}\n${user.content}` })
    }
  }
  return out
}

test('the detectors have teeth, and do not bite prose that is fine', () => {
  // A guard that never fires is indistinguishable from one that cannot. Pinned
  // against the ACTUAL sentence it was built for, verbatim from the render that
  // shipped, so a later loosening of the patterns has to break this first.
  const shipped = 'The quest record has since settled 2 more seats that the deal alone left open:'
    + ' P1(seat 1) is EVIL (Quest 1 failed, and of the players on it he is the only one left you cannot already account for)'
    + ' and P3(seat 3) is EVIL (Quest 1 failed, and of the players on it he is the only one left you cannot already account for).'
  assert.ok(repeatedUniqueness(shipped), 'the repeated singular claim must be caught')
  assert.ok(repeatedRun(shipped), 'the verbatim repeated clause must be caught')

  // Real sentences from the corpus that use the same phrases ONCE. If a pattern
  // is ever widened until one of these trips, the guard has started costing more
  // than it catches.
  for (const fine of [
    'The one thing you know for certain is your own loyalty, so a team without you is never automatically safe.',
    'Mordred is dealt, and he is the one evil hidden from you, so exactly one more evil sits among the others.',
    'A quest that failed while every other player on it is one you can already place names the player you cannot: Quest 1 names P4(seat 4) as EVIL.',
  ]) {
    assert.equal(repeatedUniqueness(fine), null, `false positive on: ${fine}`)
    assert.equal(repeatedRun(fine), null, `false positive on: ${fine}`)
  }
})

test('the audit reaches the text it is meant to audit', () => {
  // Without this the sweep passes trivially on boards where no quest ever failed
  // and the list-rendered sections are all empty, which is the exact shape of
  // coverage the phantom audit was missing.
  //
  // Counted at the point the detectors see it, NOT at "the prompt contains the
  // string". Those differ: a sentence is skipped by the run detector if it looks
  // tabular, so adding a `|` to the record line (say, to match the dossier's
  // cell conventions) would silently drop it out of the audit while a
  // string-presence check stayed green. The guard would then cover nothing and
  // look fine, which is the failure mode this whole test exists to prevent.
  let withFailure = 0, audited = 0, checked = 0
  for (const cast of legalCasts()) {
    const g = boardWithFailure(cast.playerCount, cast.roles, `coh-${cast.label}`)
    if (!g.quests.some((q) => q.result === 'fail')) continue
    withFailure++
    for (const { text } of renderAll(g, cast.roles.includes('assassin'))) {
      checked++
      for (const s of sentences(text)) {
        if (!s.includes('quest record has since settled')) continue
        if (ALLOWED.includes(s) || TABULAR.test(s)) continue
        audited++
      }
    }
  }
  assert.ok(withFailure > 50, `only ${withFailure} casts reached a failed quest`)
  assert.ok(checked > 2000, `only ${checked} prompts rendered`)
  assert.ok(audited > 20,
    `the record line reached both detectors only ${audited} times; the audit would not have caught its own bug`)
})

for (const cast of legalCasts()) {
  test(`no prompt contradicts itself in one sentence: ${cast.label}`, () => {
    const g = boardWithFailure(cast.playerCount, cast.roles, `coh-${cast.label}`)
    // Collected, not fail-fast: these get fixed as a batch, and the first hit
    // hides the rest of the inventory.
    const hits = new Set<string>()
    for (const { where, text } of renderAll(g, cast.roles.includes('assassin'))) {
      for (const s of sentences(text)) {
        if (ALLOWED.includes(s)) continue
        const why = repeatedUniqueness(s) ?? (TABULAR.test(s) ? null : repeatedRun(s))
        if (why) hits.add(`${where}: ${why}\n    in: ${s.slice(0, 240)}`)
      }
    }
    assert.deepEqual(
      [...hits].sort(), [],
      `${cast.label} (${cast.roles.join(', ')}) renders a self-contradicting sentence:\n  ${[...hits].sort().join('\n  ')}\n`,
    )
  })
}
