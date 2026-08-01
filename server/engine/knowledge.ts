// The night-phase knowledge matrix and the accessors that read a seat's
// PrivateInfo without narrowing the union at every call site. This is the ONLY
// producer of deal-time knowledge — createGame, viewFor, and tests all share it.
// Pure: this module imports only types.

import type { Player, PrivateInfo, Seat } from './types.ts'

// The knowledge matrix (research doc §3.3). The ONLY producer of night-phase
// knowledge — deal, viewFor, and tests all share it.
export function computeKnowledge(players: Player[], seat: Seat): PrivateInfo {
  const me = players[seat]
  if (!me) throw new RangeError(`no player at seat ${seat}`)
  const seatsOf = (pred: (p: Player) => boolean) =>
    players.filter(pred).map((p) => p.seat).sort((a, b) => a - b)

  if (me.role === 'merlin') {
    return { kind: 'merlin', knownEvil: seatsOf((p) => p.alignment === 'evil' && p.role !== 'mordred') }
  }
  if (me.role === 'percival') {
    return { kind: 'percival', merlinCandidates: seatsOf((p) => p.role === 'merlin' || p.role === 'morgana') }
  }
  if (me.alignment === 'evil' && me.role !== 'oberon') {
    return {
      kind: 'evil',
      evilPartners: seatsOf((p) => p.alignment === 'evil' && p.role !== 'oberon' && p.seat !== seat),
    }
  }
  // Oberon and Servants learn nothing.
  return { kind: 'none' }
}

// Accessors for the one array a seat's PrivateInfo carries, or [] when its kind
// carries none. These are how consumers read knowledge without narrowing the
// union at every site: the old `view.privateInfo.evilPartners ?? []` reads
// become `evilPartnersOf(view.privateInfo)`, and the discriminant makes the
// "wrong role's field" state unrepresentable rather than merely absent.
export const knownEvilOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'merlin' ? info.knownEvil : []
export const evilPartnersOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'evil' ? info.evilPartners : []
export const merlinCandidatesOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'percival' ? info.merlinCandidates : []

// A deep copy decoupled from the source arrays, for callers that store the
// knowledge past the life of the view it came from (e.g. cognition evidence).
export function clonePrivateInfo(info: PrivateInfo): PrivateInfo {
  switch (info.kind) {
    case 'merlin': return { kind: 'merlin', knownEvil: info.knownEvil.slice() }
    case 'percival': return { kind: 'percival', merlinCandidates: info.merlinCandidates.slice() }
    case 'evil': return { kind: 'evil', evilPartners: info.evilPartners.slice() }
    case 'none': return { kind: 'none' }
  }
}
