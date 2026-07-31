// test-lane: exhaustive
// No prompt may name a role that is not at the table.
//
// Why this is its own test: the prompt layer splits cleanly into text COMPUTED
// from a PlayerView (which is role-set aware) and text hoisted into module
// constants for prompt-cache friendliness (which cannot see rolesInPlay, and so
// describes a default deal that may not be the one being played). A constant
// cannot consult the view by construction, which is exactly why the bug lives
// there and only there.
//
// It is not cosmetic. In a game with no Oberon, a Morgana twice wrote off a seat
// as "likely evil or Oberon" at 75% and 80% confidence, a proposition it could
// prove false from its own partner list; and a Merlin held two provably-good
// seats at 65-70% because guidance told it never to claim total confidence on
// account of a Mordred that was not dealt. Phantom roles cost real play strength.
//
// Asserted over RENDERED prompts rather than the exported constants, so the
// knowledge lines, role guidance, ASKs and view renderers are all covered
// (same approach as talk-norms.test.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, applyDecision, expectedDecisions } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { buildMessages } from '../../../server/agents/prompts.ts'
import { DEFAULT_ROLES, ROLE_ALIGNMENT } from '../../../server/engine/rules.ts'
import { legalCasts } from '../../support/casts.ts'
import type { Role } from '../../../server/engine/types.ts'
import type { LlmCallKind } from '../../../server/llm/call-params.ts'

const ALL_ROLES = Object.keys(ROLE_ALIGNMENT) as Role[]

// Casts come from test/casts.ts, which enumerates everything validateRoles
// accepts (71 across 5 to 10 players). This audit used to carry a hand-written
// list of six, and that is exactly how a live phantom survived it:
// ROLE_GUIDANCE.percival opened with "the other is Morgana" and no hand-picked
// cast paired a Percival with no Morgana, though the picker's Advanced preset
// builds one at 5 and 6 players.

// Two resolved quests, so the branches that only render once a quest has
// resolved (the Merlin streak line, the Percival paired-record line, the derived
// facts dossier) are covered rather than skipped as early-game empties.
function midGame(playerCount: number, roles: Role[], seed: string) {
  const g = createGame({
    seed, playerCount, roles: [...roles],
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
  })
  for (let round = 0; round < 2; round++) {
    const size = g.quests[g.round - 1].teamSize
    const team = Array.from({ length: size }, (_, i) => (g.leaderSeat + i) % playerCount)
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

// Whole word, optional plural, case-insensitive: "Mordred", "Minions", "oberon".
const mentions = (text: string, role: Role) =>
  new RegExp(`\\b${role}s?\\b`, 'i').test(text)

test('the enumeration actually covers the legal space', () => {
  // Without this, a generator bug that yields nothing makes the audit below pass
  // vacuously, which is the most dangerous way for a test like this to fail.
  const casts = legalCasts()
  assert.ok(casts.length >= 60, `expected the full legal space, got ${casts.length} casts`)
  const counts = new Map<number, number>()
  for (const c of casts) counts.set(c.playerCount, (counts.get(c.playerCount) ?? 0) + 1)
  for (const [n, seen] of counts) assert.ok(seen > 1, `only ${seen} cast(s) enumerated at ${n} players`)
  // The deals the app ships must be in there, or the generator is missing a shape.
  for (const n of Object.keys(DEFAULT_ROLES).map(Number)) {
    const want = [...DEFAULT_ROLES[n]].sort().join(',')
    assert.ok(
      casts.some((c) => c.playerCount === n && [...c.roles].sort().join(',') === want),
      `default ${n}p deal missing from the enumeration`,
    )
  }
})

for (const cast of legalCasts()) {
  test(`no prompt names an absent role: ${cast.label}`, () => {
    const g = midGame(cast.playerCount, cast.roles, `phantom-${cast.label}`)
    const present = new Set(cast.roles)
    const absent = ALL_ROLES.filter((r) => !present.has(r))

    const kinds: LlmCallKind[] = [
      'discuss', 'propose', 'pitch', 'finalize', 'vote', 'quest', 'reflect',
      // assassinate only exists as a call when there is an Assassin to make it.
      ...(present.has('assassin') ? ['assassinate' as LlmCallKind] : []),
    ]

    // Collected rather than asserted per-site: one run should print the whole
    // inventory of offending (role, seat-role, call) combinations, since these
    // get fixed as a batch and a fail-fast assertion hides all but the first.
    const hits = new Set<string>()
    for (const p of g.players) {
      const view = viewFor(g, p.seat)
      for (const kind of kinds) {
        const [sys, user] = buildMessages(kind, view, '', {}, { chosenTeam: [...(view.currentTeam ?? [0, 1])] })
        const rendered = `${sys.content}\n${user.content}`
        for (const role of absent) {
          if (mentions(rendered, role)) hits.add(`"${role}" in the ${kind} prompt for a ${p.role} seat`)
        }
      }
    }
    assert.deepEqual(
      [...hits].sort(), [],
      `${cast.label} (${cast.roles.join(', ')}) names roles nobody is holding:\n  ${[...hits].sort().join('\n  ')}\n`,
    )
  })
}
