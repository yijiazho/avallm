// SeatSet algebra: the canonical form of a team and set-equality over seats.
// A SeatSet is an unordered set of seats carried on the wire as an array (see
// types.ts). These are the one canonical home for operations agent code used to
// re-implement inconsistently. Pure: this module imports only types.

import type { Seat, SeatSet } from './types.ts'

// A SeatSet in ascending order — the canonical form of a team, which is one
// such set. The one place that sort lives; agent code used to re-implement this
// six ways. Contract: this SORTS but does NOT dedupe — a repeated seat stays,
// so pass a set (or a validated team) if uniqueness matters.
export function canonicalTeam(team: SeatSet): SeatSet {
  return [...team].sort((m, n) => m - n)
}

// Order-insensitive equality over a SeatSet: "same members" is the only thing
// that matters. Named for its most common argument (a proposed/quest team), but
// the contract is set-equality, so it also compares the non-team seat sets in
// PrivateInfo (knownEvil, evilPartners, merlinCandidates). Teams are canonically
// stored sorted, but callers compare against LLM/human-supplied teams that may
// not be — sort both defensively. Absent sets (no proposal on the table yet) are
// tolerated and compare reflexively: two absent sets are equal, and an absent set
// never equals a present one. This is the one canonical answer — agent code used
// to re-implement this five ways with inconsistent absent/absent handling.
export function teamsEqual(
  a: SeatSet | undefined,
  b: SeatSet | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  const x = canonicalTeam(a)
  const y = canonicalTeam(b)
  return x.every((s, i) => s === y[i])
}

// A team is a set of seats, so no seat may appear twice. The Set idiom
// new Set(team).size === team.length was open-coded across the agent admission,
// analysis, policy, cognition, and simulation layers; this is the one place it
// lives. Named for seats because that is what it guards — a proposal team, a
// communication target list, any seat list that must be a set.
export function hasDistinctSeats(team: readonly Seat[]): boolean {
  return new Set(team).size === team.length
}

// A team in canonical form: seats strictly ascending. Strictly ascending
// already forbids a repeat, so this implies hasDistinctSeats — the open-coded
// distinct-then-ascending pair that used to sit side by side over the same
// array collapses to this single call.
export function isCanonicalTeam(team: readonly Seat[]): boolean {
  return team.every((seat, index) => index === 0 || team[index - 1] < seat)
}
