// Small shared text-rendering helpers used by more than one prompt module.
// A dependency-free leaf so both prompts.ts and facts.ts (and knowledge-text.ts)
// can share one spelling of a player reference and one list joiner without
// importing each other.

import type { Seat } from '../engine/types.ts'

// The ONE canonical `name(seat N)` renderer. Both the private-knowledge lines
// (PlayerView) and the facts dossier (PublicRecord) render a seat this way, so
// the token has a single definition rather than a copy per source shape. Any
// value carrying a seat-indexed `players` array with a `name` works.
export const seatName = (
  source: { players: readonly { name: string }[] },
  s: Seat,
): string => `${source.players[s].name}(seat ${s})`

// Join items into prose with an Oxford-free "A, B and C". One item renders bare,
// none renders empty.
export const listOf = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
