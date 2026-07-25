// Board reads that decide forced plays (docs/design-bot-guidance.md §7.2).
//
// Every T1 trigger in the catalogue is phrased in terms of these two questions —
// how many Fails this seat can account for on a team, and whose match point the
// board is on — so they get one definition each, shared by every consumer:
// prompts.ts writes them into ASK branches for LLM seats, heuristic.ts branches
// on them directly, and forced.ts re-derives the same quantities from the
// artifact to grade the result. A rule and its detector drifting apart would
// make the metric measure the wrong thing silently.
//
// Consume ONLY PlayerView, like the prompt builders: no raw Game, no omniscience.

import { QUESTS_TO_WIN } from '../engine/rules.ts'
import type { PlayerView, Seat } from '../engine/types.ts'

// Evil on a team that THIS SEAT can see: itself plus known partners, never more.
// Oberon is invisible to the rest of evil (and they to it), so a count that
// walked the whole team would hand an evil bot knowledge the deal denies it, and
// a note built on it would assert a team is evil-free when Oberon is riding
// along. The narrowness is the point: "known Fails aboard" is what a seat can
// actually commit to playing.
export function knownEvilAboard(view: PlayerView, team: readonly Seat[] | undefined): Seat[] {
  if (view.alignment !== 'evil' || !team) return []
  const partners = view.privateInfo.evilPartners ?? []
  return team.filter((s) => s === view.seat || partners.includes(s))
}

// Whose match point it is: one more quest of that result ends the quest phase.
// The board-stakes rows in the facts dossier (facts.ts) state this to every seat
// as neutral data; these flags are how the decisions that can still act on it —
// who goes on the team, whether the team runs, and which card it carries — get
// keyed to it.
export function matchPoint(view: PlayerView): { good: boolean; evil: boolean } {
  const successes = view.quests.filter((q) => q.result === 'success').length
  const fails = view.quests.filter((q) => q.result === 'fail').length
  return { good: successes === QUESTS_TO_WIN - 1, evil: fails === QUESTS_TO_WIN - 1 }
}
