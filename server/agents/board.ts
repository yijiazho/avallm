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

import { QUESTS_TO_WIN, ROLE_ALIGNMENT } from '../engine/rules.ts'
import type { Alignment, PlayerView, Role, Seat } from '../engine/types.ts'
import { feasibleWorlds, rolePossibilities } from './belief/exact.ts'
import { questFailEvidence } from './belief/constraints.ts'

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

export interface SeatCertainty {
  seat: Seat
  possibleRoles: Role[]
  // Non-null when every remaining possibility falls on the same side, i.e. the
  // viewer can PROVE this seat's alignment rather than estimate it.
  alignment: Alignment | null
}

export interface RoleCertainties {
  seats: SeatCertainty[]           // one per seat, indexed by seat number
  knownGood: Seat[]                // provably good, excluding the viewer
  knownEvil: Seat[]                // provably evil, excluding the viewer
  unresolved: Seat[]               // side still genuinely open
  merlinCandidates: Seat[]         // seats that could still hold Merlin (empty if no Merlin dealt)
  alignmentComplete: boolean       // true when no seat's side is open
  // Seats the DEAL alone leaves open and the resolved quests close. Separated so
  // a caller can state the new deduction and the evidence for it, instead of
  // folding it into the deal lines where it would read as private sight.
  fromRecord: Array<{ seat: Seat; alignment: Alignment; questNum?: number }>
}

const isEvil = (r: Role) => ROLE_ALIGNMENT[r] === 'evil'

const sideOf = (roles: Set<Role>): Alignment | null => {
  if (roles.size === 0) return null
  let evil = 0
  for (const r of roles) if (isEvil(r)) evil++
  return evil === roles.size ? 'evil' : evil === 0 ? 'good' : null
}

export function roleCertainties(view: PlayerView): RoleCertainties {
  const worlds = feasibleWorlds(view)
  const dealWorlds = feasibleWorlds(view, { questRecord: 'none' })
  const possible = new Map<Seat, Set<Role>>(
    view.players.map((player) => [
      player.seat,
      new Set(rolePossibilities(worlds, player.seat)),
    ]),
  )
  const dealOnly = new Map<Seat, Set<Role>>(
    view.players.map((player) => [
      player.seat,
      new Set(rolePossibilities(dealWorlds, player.seat)),
    ]),
  )

  const seats: SeatCertainty[] = view.players.map((p) => {
    const set = possible.get(p.seat) ?? new Set<Role>()
    return { seat: p.seat, possibleRoles: [...set], alignment: sideOf(set) }
  })

  const pick = (want: Alignment | null) =>
    seats.filter((s) => s.seat !== view.seat && s.alignment === want).map((s) => s.seat)

  const recordEvidence = questFailEvidence(view)
  const forcedBy = new Map<Seat, number>()
  let beforeQuest = dealWorlds
  for (const evidence of recordEvidence) {
    const couldBeEvil = evidence.team.filter((seat) =>
      beforeQuest.some((world) => world.alignmentBySeat[seat] === 'evil'))
    const afterQuest = feasibleWorlds(view, { questRecord: evidence.questNum })
    if (couldBeEvil.length === evidence.minimumEvil) {
      for (const seat of couldBeEvil) {
        const wasProvenEvil = beforeQuest.every(
          (world) => world.alignmentBySeat[seat] === 'evil',
        )
        const isProvenEvil = afterQuest.every(
          (world) => world.alignmentBySeat[seat] === 'evil',
        )
        if (!wasProvenEvil && isProvenEvil && !forcedBy.has(seat)) {
          forcedBy.set(seat, evidence.questNum)
        }
      }
    }
    beforeQuest = afterQuest
  }

  const fromRecord = seats
    .filter((s) => s.seat !== view.seat && s.alignment !== null
      && sideOf(dealOnly.get(s.seat) ?? new Set<Role>()) === null)
    .map((s) => {
      const questNum = forcedBy.get(s.seat)
      return {
        seat: s.seat,
        alignment: s.alignment as Alignment,
        ...(questNum !== undefined ? { questNum } : {}),
      }
    })

  return {
    seats,
    knownGood: pick('good'),
    knownEvil: pick('evil'),
    unresolved: pick(null),
    merlinCandidates: seats.filter((s) => s.possibleRoles.includes('merlin')).map((s) => s.seat),
    alignmentComplete: seats.every((s) => s.alignment !== null),
    fromRecord,
  }
}
