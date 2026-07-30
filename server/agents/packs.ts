// Agent packs — curated *sets* of library agents you can seat in one click
// ("all the detectives", "all the philosophers"). A pack is pure metadata over
// defs that already exist: no engine surface, no new prompt layer. Packs are
// curation, so they live in code next to DEFAULT_TABLE (roster.ts) rather than
// in a JSON manifest; the member ids reference agents/*.json files, and
// resolvePacks surfaces any that don't resolve instead of silently shrinking
// the pack.
//
// Packs are deliberately VARIABLE-SIZED, and drawn at RANDOM rather than in
// list order. A table shorter than the pack seats a random subset, so a
// 5-player game rotates through the whole cast over a few plays instead of
// always fielding the same faces; a table longer than the pack fills its
// leftover seats from the default agent library (deepseek, kimi, ...) so a
// four-member pack at a 9-player table never has to seat "Sherlock 2".

import { ROSTER } from '../llm/roster.ts'
import type { Rng } from '../engine/prng.ts'
import type { AgentDef, LibraryProblem, TableSeat } from './def-types.ts'

export interface AgentPack {
  id: string
  name: string
  blurb: string
  agents: string[] // library ids; a table smaller than the pack draws a RANDOM subset
}

export const PACKS: AgentPack[] = [
  {
    id: 'detectives',
    name: 'The Detectives',
    blurb: 'Fiction\'s great investigators. They read the vote record like a crime scene, and each other like suspects.',
    // Six members fills a 7-player table exactly; a 5-player table draws four of
    // the six at random, so consecutive plays rotate through the whole cast.
    // Each reads the same evidence a different way: deduction, psychology,
    // absence, precedent, probability, pressure.
    agents: ['sherlock', 'poirot', 'benoit-blanc', 'miss-marple', 'ryuzaki', 'batman'],
  },
  {
    id: 'middle-earth',
    name: 'Middle-earth',
    blurb: 'Wizards, hobbits, a dwarf, a king, and two things that should not be trusted with a ring.',
    // Eight members fills a 9-player table exactly. Alignment is dealt at random,
    // so no member's persona may assume its own side: Sauron and Smaug are
    // written as manner and method, not as evil.
    agents: ['gandalf', 'aragorn', 'samwise', 'gollum', 'bilbo', 'gimli', 'smaug', 'sauron'],
  },
]

export type ResolvedPack = AgentPack

// Drop members whose def is missing or unseatable, and report why. Called at
// library load: a curated agent renamed or deleted without updating its pack
// would otherwise vanish from the table with no trace.
export function resolvePacks(agents: AgentDef[]): { packs: ResolvedPack[]; problems: LibraryProblem[] } {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const packs: ResolvedPack[] = []
  const problems: LibraryProblem[] = []
  for (const pack of PACKS) {
    const members: string[] = []
    for (const id of pack.agents) {
      const def = byId.get(id)
      const reason = !def ? `no such agent "${id}"`
        : def.unavailable ? `agent "${id}" is unavailable: ${def.unavailable}`
        : null
      if (reason) problems.push({ file: `pack/${pack.id}`, reason })
      else members.push(id)
    }
    if (members.length) packs.push({ ...pack, agents: members })
    else problems.push({ file: `pack/${pack.id}`, reason: `pack "${pack.name}" has no seatable members` })
  }
  return { packs, problems }
}

// Roster ids for the seats that need one, dealt without repeats until the
// pool runs out. Personality-only agents (no model suggestion in the def)
// would otherwise all land on DEFAULT_MODEL, making a themed table sound like
// one model wearing six hats.
//
// `pool` narrows the draw to a subset of roster ids (the sim's --tier passes one
// cost tier). Dealing by repeated shuffle rather than independent picks is the
// point of sharing this: over 7 seats from a 4-model tier it guarantees every
// model appears before any appears a third time, where independent picks can
// hand four seats to one model and never seat another.
export function randomModels(count: number, rng: Rng, pool?: readonly string[]): string[] {
  const ids = pool ? [...pool] : ROSTER.map((r) => r.id)
  // Models get benched by commenting them out of the roster; an empty roster
  // must fail downstream (resolveModel's DEFAULT_MODEL lookup) rather than
  // spin here forever.
  if (!ids.length) return []
  const out: string[] = []
  while (out.length < count) out.push(...rng.shuffle(ids))
  return out.slice(0, count)
}

// The models a leftover seat can draw: built-in agents only, so "the rest of
// the table is LLMs" never quietly seats another pack's character. Shuffled so
// seat order varies between plays, and the pack's own members are excluded so
// an oversized table can't seat "Sherlock 2" next to Sherlock.
//
// A FLAT draw over the whole roster, deliberately: this used to prefer the
// default table and queue newer models behind it, which meant a model could be
// on the roster for months and still never take a seat. Drawing flat costs the
// one-family-per-seat property (a table can now show two Geminis) and can seat
// a model that is only provisionally vetted — both accepted, because a model
// unfit to be drawn should be benched in roster.ts rather than quietly ranked
// last here.
function leftoverPool(pack: ResolvedPack, agents: AgentDef[], rng: Rng): string[] {
  const models = agents
    .filter((a) => a.tier === 'builtin' && a.engine.type === 'llm' && !pack.agents.includes(a.id))
    .map((a) => a.id)
  return rng.shuffle(models)
}

// Fill `botCount` seats from a pack: a RANDOM subset of its members, then the
// default agent library for whatever is left over. Random, not first-N, so a
// table smaller than the pack rotates through the whole cast across plays
// instead of always seating the same faces. Members that don't prescribe a
// model get a random one. The client's setup screen mirrors this (App.tsx
// fillFromPack) so the host can see and edit the table before starting; keep
// the two in step.
export function seatPack(pack: ResolvedPack, botCount: number, agents: AgentDef[], rng: Rng): TableSeat[] {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const members = rng.shuffle(pack.agents)
  const take = Math.min(botCount, members.length)
  const leftovers = leftoverPool(pack, agents, rng)
  const ids = Array.from({ length: botCount }, (_, i) => (
    i < take ? members[i] : leftovers[(i - take) % leftovers.length] ?? 'autopilot'
  ))
  // Deal the random models in one batch so they're distinct across seats.
  const needsModel = ids.filter((id) => {
    const e = byId.get(id)?.engine
    return e?.type === 'llm' && e.model === undefined
  })
  const dealt = randomModels(needsModel.length, rng)
  let next = 0
  return ids.map((id) => {
    const e = byId.get(id)?.engine
    return e?.type === 'llm' && e.model === undefined ? { agent: id, model: dealt[next++] } : { agent: id }
  })
}
