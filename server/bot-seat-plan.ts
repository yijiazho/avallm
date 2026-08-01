import { agentDescriptor, publicInfo } from './agents/defs.ts'
import type { AgentDef, AgentPublicInfo, TableSeat } from './agents/defs.ts'
import type { Seat } from './engine/types.ts'

/**
 * Game-lifetime snapshot of the implementation occupying one bot seat.
 * Session storage supplies the seat key; the game owns the public player name.
 */
export interface SeatedAgent {
  readonly def: AgentDef
  readonly model?: string
  readonly info: AgentPublicInfo
  readonly descriptor: string
}

/**
 * Startup-only placement record. Seat and alias are consumed while creating the
 * game; only the seated identity is retained by the running session.
 */
export interface BotSeatPlan {
  readonly seat: Seat
  readonly alias: string
  readonly identity: SeatedAgent
}

interface BotSeatPlanInputs {
  readonly playerCount: number
  readonly seats: readonly Seat[]
  readonly table: readonly TableSeat[]
  readonly aliases: readonly string[]
  readonly resolveDef: (tableSeat: TableSeat) => AgentDef
}

/**
 * Join the parallel setup inputs at one checked boundary. Downstream startup
 * code consumes complete seat records and no longer has to coordinate indexes.
 */
export function buildBotSeatPlans({
  playerCount,
  seats,
  table,
  aliases,
  resolveDef,
}: BotSeatPlanInputs): readonly BotSeatPlan[] {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error(`invalid player count ${playerCount}`)
  }
  if (seats.length !== table.length || seats.length !== aliases.length) {
    throw new Error(
      `bot seat plan inputs disagree: seats=${seats.length}, table=${table.length}, aliases=${aliases.length}`,
    )
  }

  const plannedSeats = new Set<Seat>()
  const rows: { seat: Seat; tableSeat: TableSeat; alias: string }[] = []
  seats.forEach((seat, index) => {
    if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
      throw new Error(`invalid bot seat ${seat} at index ${index}`)
    }
    if (plannedSeats.has(seat)) throw new Error(`duplicate bot seat ${seat}`)
    plannedSeats.add(seat)

    // Length equality above proves both indexed values exist. Keep the runtime
    // check here as a fail-closed guard if this ever receives a sparse array.
    const tableSeat = table[index]
    const alias = aliases[index]
    if (!tableSeat || alias === undefined) {
      throw new Error(`incomplete bot seat plan at index ${index}`)
    }
    rows.push({ seat, tableSeat, alias })
  })

  return rows.map(({ seat, tableSeat, alias }) => {
    // Snapshot the definition once. Library edits after game start must affect
    // future games only, while every consumer of this plan sees one identity.
    const def = structuredClone(resolveDef(tableSeat))
    const model = tableSeat.model
    return {
      seat,
      alias,
      identity: {
        def,
        ...(model === undefined ? {} : { model }),
        info: publicInfo(def, model),
        descriptor: agentDescriptor(def, model),
      },
    }
  })
}
