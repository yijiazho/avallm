import { agentDescriptor, publicInfo } from './agents/defs.ts'
import type { AgentDef, AgentPublicInfo } from './agents/defs.ts'

/**
 * Game-lifetime snapshot of the implementation occupying one bot seat.
 * Session or table storage supplies the seat key; the game owns the public name.
 */
export interface SeatedAgent {
  readonly def: AgentDef
  readonly model?: string
  readonly info: AgentPublicInfo
  readonly descriptor: string
}

/** Detach one playable identity from mutable library configuration. */
export function snapshotSeatedAgent(source: AgentDef, model?: string): SeatedAgent {
  const def = structuredClone(source)
  return {
    def,
    ...(model === undefined ? {} : { model }),
    info: publicInfo(def, model),
    descriptor: agentDescriptor(def, model),
  }
}
