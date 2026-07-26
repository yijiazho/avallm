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
// deal had already closed, so this computes the closure once and states it.
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
}

const isEvil = (r: Role) => ROLE_ALIGNMENT[r] === 'evil'

export function roleCertainties(view: PlayerView): RoleCertainties {
  const inPlay = new Set(view.rolesInPlay)
  const distinct = [...inPlay]
  const possible = new Map<Seat, Set<Role>>(
    view.players.map((p) => [p.seat, new Set(distinct)]),
  )
  const keep = (seat: Seat, pred: (r: Role) => boolean) => {
    const set = possible.get(seat)
    if (!set) return
    for (const r of [...set]) if (!pred(r)) set.delete(r)
  }
  const others = (exclude: Seat[]) =>
    view.players.map((p) => p.seat).filter((s) => s !== view.seat && !exclude.includes(s))

  // The viewer's own seat is the one thing every role knows for certain.
  possible.set(view.seat, new Set([view.role]))

  // Merlin's sight. Mordred is the ONLY role hidden from it, so when Mordred is
  // not dealt the list is complete and every other seat is good; when Mordred IS
  // dealt the gap is exactly one known role, which narrows rather than blurs.
  const seen = view.privateInfo.knownEvil ?? []
  if (seen.length) {
    for (const s of seen) keep(s, (r) => isEvil(r) && r !== 'mordred')
    const hidden = inPlay.has('mordred')
    for (const s of others(seen)) keep(s, (r) => !isEvil(r) || (hidden && r === 'mordred'))
  }

  // An evil seat's partner list. Same shape, with Oberon as the one omission.
  const partners = view.privateInfo.evilPartners ?? []
  if (view.alignment === 'evil' && view.role !== 'oberon') {
    for (const s of partners) keep(s, (r) => isEvil(r) && r !== 'oberon')
    const hidden = inPlay.has('oberon')
    for (const s of others(partners)) keep(s, (r) => !isEvil(r) || (hidden && r === 'oberon'))
  }

  // Percival's pair: those two seats hold Merlin and Morgana between them, which
  // also rules both roles out everywhere else.
  const pair = view.privateInfo.merlinCandidates ?? []
  if (pair.length) {
    for (const s of pair) keep(s, (r) => r === 'merlin' || r === 'morgana')
    for (const s of others(pair)) keep(s, (r) => r !== 'merlin' && r !== 'morgana')
  }

  // A role can be held by at most as many seats as the cast deals it, so once
  // that many seats are pinned to it, every other seat can drop it. Counting
  // rather than special-casing UNIQUE_ROLES matters: at 5 players the cast holds
  // exactly one Servant, so the Servant seat itself rules Servant out everywhere
  // else and learns the other four seats' roles as a set, which is how a seat
  // with no private knowledge still knows a Merlin is out there to protect.
  //
  // Run to a fixpoint, since one elimination can pin another seat. This is what
  // turns Percival's pair into "the two seats I am not looking at hold the
  // Assassin and a Servant between them".
  const dealt = new Map<Role, number>()
  for (const r of view.rolesInPlay) dealt.set(r, (dealt.get(r) ?? 0) + 1)
  for (let pass = 0; pass < view.players.length; pass++) {
    let changed = false
    for (const [role, copies] of dealt) {
      const pinned = [...possible].filter(([, set]) => set.size === 1 && set.has(role))
      if (pinned.length < copies) continue
      const holders = new Set(pinned.map(([seat]) => seat))
      for (const [seat, set] of possible) {
        if (!holders.has(seat) && set.delete(role)) changed = true
      }
    }
    if (!changed) break
  }

  const seats: SeatCertainty[] = view.players.map((p) => {
    const roles = [...(possible.get(p.seat) ?? new Set<Role>())]
    const evilCount = roles.filter(isEvil).length
    return {
      seat: p.seat,
      possibleRoles: roles,
      alignment: roles.length === 0 ? null
        : evilCount === roles.length ? 'evil'
          : evilCount === 0 ? 'good' : null,
    }
  })

  const pick = (want: Alignment | null) =>
    seats.filter((s) => s.seat !== view.seat && s.alignment === want).map((s) => s.seat)

  return {
    seats,
    knownGood: pick('good'),
    knownEvil: pick('evil'),
    unresolved: pick(null),
    merlinCandidates: seats.filter((s) => s.possibleRoles.includes('merlin')).map((s) => s.seat),
    alignmentComplete: seats.every((s) => s.alignment !== null),
  }
}
