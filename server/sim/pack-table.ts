import type { AgentDef, TableSeat } from '../agents/defs.ts'
import type { Seat } from '../engine/types.ts'
import { snapshotSeatedAgent, type SeatedAgent } from '../seated-agent.ts'

/**
 * One batch-stable pack cast. Its array is dense and seat ordered; callers use
 * identityAt when converting a domain Seat into the identity that occupied it.
 */
export interface PackSeatTable {
  readonly identities: readonly SeatedAgent[]
  identityAt(seat: Seat): SeatedAgent
}

export function resolvePackSeatTable(
  table: readonly TableSeat[],
  library: readonly AgentDef[],
): PackSeatTable {
  if (table.length === 0) throw new Error('pack seat table cannot be empty')

  const seats: SeatedAgent[] = []
  for (let index = 0; index < table.length; index++) {
    const tableSeat = table[index]
    if (!tableSeat) throw new Error(`pack seat table is sparse at seat ${index}`)
    const def = library.find((candidate) => candidate.id === tableSeat.agent)
    if (!def) throw new Error(`pack seat ${index} names missing agent "${tableSeat.agent}"`)
    seats.push(snapshotSeatedAgent(def, tableSeat.model))
  }

  return {
    identities: seats,
    identityAt(seat) {
      const identity = Number.isInteger(seat) && seat >= 0 ? seats[seat] : undefined
      if (!identity) throw new Error(`missing pack seat ${seat}`)
      return identity
    },
  }
}
