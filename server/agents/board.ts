// Board reads that decide forced plays (docs/design-bot-guidance.md §7.2).
//
// This compatibility facade exposes exact belief and situation projections to
// legacy prompt renderers. New executable policy consumes SituationAnalysis
// directly; the artifact evaluator independently derives its own quantities so
// the measurement can detect rather than inherit policy defects.
//
// Consume ONLY PlayerView, like the prompt builders: no raw Game, no omniscience.

import type { PlayerView, Seat } from '../engine/types.ts'
import { exactBelief } from './belief/exact.ts'
import type { BeliefSnapshot } from './belief/types.ts'
import {
  analyzeSituation,
  boardSituation,
  knownFailsAboard,
} from './analysis/situation.ts'
import {
  compatibilityCertainties,
  type RoleCertainties,
} from './communication/compat-certainties.ts'
export type {
  RoleCertainties,
  SeatCertainty,
} from './communication/compat-certainties.ts'

// Evil on a team that THIS SEAT can see: itself plus known partners, never more.
// Oberon is invisible to the rest of evil (and they to it), so a count that
// walked the whole team would hand an evil bot knowledge the deal denies it, and
// a note built on it would assert a team is evil-free when Oberon is riding
// along. The narrowness is the point: "known Fails aboard" is what a seat can
// actually commit to playing.
export function knownEvilAboard(view: PlayerView, team: readonly Seat[] | undefined): Seat[] {
  return [...knownFailsAboard(view, team)]
}

// Whose match point it is: one more quest of that result ends the quest phase.
// The board-stakes rows in the facts dossier (facts.ts) state this to every seat
// as neutral data; these flags are how the decisions that can still act on it —
// who goes on the team, whether the team runs, and which card it carries — get
// keyed to it.
export function matchPoint(view: PlayerView): { good: boolean; evil: boolean } {
  return boardSituation(view).matchPoint
}

// ---- what a seat can PROVE, before any read of anyone's behaviour ----
//
// The role multiset is public (view.rolesInPlay) and a seat's private knowledge
// is exact, so most of "who is what" is settled at the deal and the rest is a
// small elimination. Bots do not do this on their own: in a game with no Oberon
// a Morgana twice wrote off a seat as "likely evil or Oberon" at 75% and 80%,
// which its own partner list refutes; a Merlin with no Mordred dealt carried two
// provably-good seats at 65-70%. Both were reasoning about possibilities the
// deal had already closed, so this projects the exact feasible worlds and
// states the result.
//
// Deliberately NOT in facts.ts: that layer's contract is facts any player at the
// table could derive, and every one of these is private to the viewing seat.

// A belief/certainty projection, kept here as part of the compatibility facade
// rather than moved to a belief module: its importers read it alongside the
// board reads above, and relocating it would only churn their import paths.
export function roleCertainties(
  view: PlayerView,
  suppliedBelief?: BeliefSnapshot,
): RoleCertainties {
  const belief = suppliedBelief ?? exactBelief(view)
  const analysis = analyzeSituation(view, { belief })
  return compatibilityCertainties(view, belief, analysis)
}
