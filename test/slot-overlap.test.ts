// Role guidance must not restate what the knowledge line already said.
//
// The prompt has two slots with different jobs: knowledgeText owns WHAT YOU
// KNOW, ROLE_GUIDANCE owns WHAT TO DO ABOUT IT (docs §6.2, "the widest slot
// whose scope exactly matches"). Three roles had drifted across that line and
// opened by restating their own knowledge line, near-verbatim:
//
//   percival  know: "One of these two is Merlin, the other is Morgana: P2 and P5"
//             guid: "One of the two players you see is Merlin, the other is Morgana"
//   servant   know: "Only your own loyalty is certain to you."
//             guid: "Your own loyalty is the one thing you know for certain"
//   oberon    know: "your fellow evil are unknown to you (and they do not know you)"
//             guid: "you do not know your fellow evil and they do not know you"
//
// The cost is not the ~40 tokens. It is that a fact with two homes drifts: this
// session shipped a fix to the Percival knowledge line while an out-of-date
// paraphrase of it sat four lines below, and that is exactly how the no-Morgana
// phantom survived in ROLE_GUIDANCE.percival after knowledgeText already handled
// the case correctly.
//
// Scope is ROLE guidance only. The alignment-shared text may legitimately reuse a
// fact to draw a different inference (GOOD_SHARED builds "so a team without you
// is never automatically safe" on top of knowing your own loyalty), which is
// argument, not restatement.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { knowledgeText, roleGuidanceFor } from '../server/agents/prompts.ts'
import { legalCasts } from './casts.ts'

// Function words carry no claim, so they would swamp the comparison.
const STOP = new Set(('a an the and or but if of to in on at is are was were be been you your yours i me my we us our '
  + 'it its that this these those they them their he she his her not no so as for with from by can could will would '
  + 'may might do does did have has had what which who whom when where why how all any both each more most other some '
  + 'such only own same than too very s t').split(' '))
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w))
// Split on sentence enders only, NOT on colons: "You see these players as EVIL:
// P1, P3" is one statement, and cutting it at the colon leaves a three-word stub
// whose tiny denominator scores 0.67 against any sentence mentioning evil. That
// false positive is what the fixtures below exist to keep out.
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => words(x).length >= 2)

// Containment, not Jaccard: a short knowledge sentence fully absorbed by a long
// guidance sentence is exactly the restatement being hunted, and Jaccard would
// score that low purely because the lengths differ.
function overlap(a: string, b: string): number {
  const A = new Set(words(a)), B = new Set(words(b))
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size)
}

// Tuned on the three known duplicates (1.00, 1.00, 0.75) against the three clean
// roles (0.33, 0.33, 0.11). After the fix the worst legitimate pair sits at 0.50
// ("your sight" shared between Merlin's knowledge and guidance, which is a
// thematic link rather than a restated fact), so 0.6 has headroom on both sides.
const THRESHOLD = 0.6

// The detector is tuned, so it needs its own test. These are the REAL pairs from
// before the fix (positives) and the roles that were always clean (negatives). If
// a later tweak stops separating them, the audit below is worthless and this says
// so rather than passing quietly.
test('the restatement detector separates the historical duplicates from the clean pairs', () => {
  const dupes: [string, string][] = [
    ['One of these two is Merlin, the other is Morgana.',
     'One of the two players you see is Merlin, the other is Morgana (evil), and your job is to tell them apart.'],
    ['Only your own loyalty is certain to you.',
     'Your own loyalty is the one thing you know for certain, and everything else you must deduce from the public record.'],
    ['You are evil, but your fellow evil are unknown to you (and they do not know you).',
     'You are evil but alone: you do not know your fellow evil and they do not know you, so you cannot coordinate a quest with anyone.'],
  ]
  for (const [k, g] of dupes) {
    assert.ok(overlap(k, g) >= THRESHOLD, `should flag: ${overlap(k, g).toFixed(2)} for ${JSON.stringify(k)}`)
  }
  const clean: [string, string][] = [
    // Morgana: her guidance tells her something her partner list never did.
    ['Your fellow EVIL players: P3(seat 3).',
     'Percival sees you and Merlin without knowing which is which. Act like Merlin: confident reads, decisive votes.'],
    // Assassin: knowledge is the partner list, guidance is the endgame shot.
    ['Your fellow EVIL players: P2(seat 2).',
     'If good reaches three successful quests you still get one shot: name Merlin.'],
    // The colon-stub false positive that this splitter fix removed.
    ['You see these players as EVIL: P1(seat 1), P3(seat 3).',
     'Mordred is dealt, and he is invisible to you, so exactly one evil is missing from the list you see.'],
  ]
  for (const [k, g] of clean) {
    assert.ok(overlap(k, g) < THRESHOLD, `false positive: ${overlap(k, g).toFixed(2)} for ${JSON.stringify(g.slice(0, 50))}`)
  }
})

test('role guidance does not restate the knowledge line, in any legal cast', () => {
  const hits: string[] = []
  let checked = 0
  for (const cast of legalCasts()) {
    const g = createGame({ seed: `slot-${cast.label}`, playerCount: cast.playerCount, roles: [...cast.roles] })
    for (const p of g.players) {
      checked++
      const view = viewFor(g, p.seat)
      const know = knowledgeText(view)
      // Drop the first line: that is the alignment-shared layer, excluded above.
      const guidance = roleGuidanceFor(p.role, {}, view).split('\n').slice(1).join('\n')
      for (const k of sentences(know)) {
        for (const gd of sentences(guidance)) {
          const o = overlap(k, gd)
          if (o >= THRESHOLD) {
            hits.push(`${cast.label} ${p.role} (${o.toFixed(2)})\n      know: ${k.trim().slice(0, 88)}\n      guid: ${gd.trim().slice(0, 88)}`)
          }
        }
      }
    }
  }
  assert.ok(checked > 400, `expected the whole space, only checked ${checked} seats`)
  assert.deepEqual(hits.slice(0, 8), [],
    `role guidance restates the knowledge line:\n    ${hits.slice(0, 8).join('\n    ')}\n  (${hits.length} total)`)
})
