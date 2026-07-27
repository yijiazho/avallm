import type { PlayerView, Role, Seat } from '../../engine/types.ts'
import {
  worldSatisfiesQuestRecord,
  worldSatisfiesView,
  type ConstraintOptions,
} from './constraints.ts'
import {
  DEFAULT_TOP_WORLD_LIMIT,
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
  type HiddenWorld,
  type PlayerMarginal,
  type RoleMarginal,
  type TeamAssessment,
  type WeightedWorld,
} from './types.ts'
import {
  canonicalRoleMultiset,
  compareWorldKeys,
  enumerateCanonicalWorlds,
} from './worlds.ts'

const DEAL_CACHE_LIMIT = 32
const dealWorldCache = new Map<string, readonly HiddenWorld[]>()

export function visibleEventCursor(view: PlayerView): number {
  return view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1)
}

function dealCacheKey(view: PlayerView): string {
  const privateInfo = [
    ...(view.privateInfo.knownEvil ?? []).map((seat) => `m${seat}`),
    ...(view.privateInfo.evilPartners ?? []).map((seat) => `e${seat}`),
    ...(view.privateInfo.merlinCandidates ?? []).map((seat) => `p${seat}`),
  ].join(',')
  return [
    canonicalRoleMultiset(view.rolesInPlay).join('|'),
    view.playerCount,
    view.seat,
    view.role,
    view.alignment,
    privateInfo,
  ].join(';')
}

function dealWorlds(view: PlayerView): readonly HiddenWorld[] {
  const key = dealCacheKey(view)
  const found = dealWorldCache.get(key)
  if (found) {
    dealWorldCache.delete(key)
    dealWorldCache.set(key, found)
    return found
  }
  const candidates = enumerateCanonicalWorlds(
    { playerCount: view.playerCount, rolesInPlay: view.rolesInPlay },
    { seat: view.seat, role: view.role },
  )
  const worlds = candidates.filter((world) =>
    worldSatisfiesView(view, world, { questRecord: 'none' }))
  if (worlds.length === 0) failNoWorlds(view, 'none')
  dealWorldCache.set(key, worlds)
  while (dealWorldCache.size > DEAL_CACHE_LIMIT) {
    const oldest = dealWorldCache.keys().next().value
    if (oldest !== undefined) dealWorldCache.delete(oldest)
  }
  return worlds
}

function failNoWorlds(view: PlayerView, record: ConstraintOptions['questRecord']): never {
  throw new Error(
    `exact belief ${EXACT_BELIEF_MODEL_VERSION} found no feasible worlds `
    + `for seat ${view.seat} (${view.role}), questRecord=${record ?? 'all'}`,
  )
}

export function feasibleWorlds(
  view: PlayerView,
  options: ConstraintOptions = {},
): readonly HiddenWorld[] {
  const candidates = dealWorlds(view)
  if (options.questRecord === 'none') return candidates
  const worlds = candidates.filter((world) => worldSatisfiesQuestRecord(view, world, options))
  if (worlds.length === 0) failNoWorlds(view, options.questRecord)
  return worlds
}

function weighted(worlds: readonly HiddenWorld[]): readonly WeightedWorld[] {
  const probability = 1 / worlds.length
  return worlds.map((world) => ({ world, probability }))
}

function playerMarginals(
  worlds: readonly WeightedWorld[],
  playerCount: number,
): readonly PlayerMarginal[] {
  return Array.from({ length: playerCount }, (_, seat) => {
    let evilWorlds = 0
    for (const weightedWorld of worlds) {
      if (weightedWorld.world.alignmentBySeat[seat] === 'evil') {
        evilWorlds++
      }
    }
    const evilProbability = evilWorlds / worlds.length
    return {
      seat,
      goodProbability: 1 - evilProbability,
      evilProbability,
    }
  })
}

function roleMarginals(
  worlds: readonly WeightedWorld[],
  rolesInPlay: readonly Role[],
  playerCount: number,
): readonly RoleMarginal[] {
  const roles = [...new Set(canonicalRoleMultiset(rolesInPlay))]
  const out: RoleMarginal[] = []
  for (let seat = 0; seat < playerCount; seat++) {
    for (const role of roles) {
      let matchingWorlds = 0
      for (const weightedWorld of worlds) {
        if (weightedWorld.world.roleBySeat[seat] === role) {
          matchingWorlds++
        }
      }
      out.push({ seat, role, probability: matchingWorlds / worlds.length })
    }
  }
  return out
}

export function topWorlds(
  worlds: readonly WeightedWorld[],
  limit = DEFAULT_TOP_WORLD_LIMIT,
): readonly WeightedWorld[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`invalid top-world limit ${limit}`)
  return [...worlds]
    .sort((a, b) =>
      b.probability - a.probability || compareWorldKeys(a.world.key, b.world.key))
    .slice(0, limit)
}

export function exactBelief(view: PlayerView): BeliefSnapshot {
  const worlds = weighted(feasibleWorlds(view))
  return {
    throughSeq: visibleEventCursor(view),
    modelVersion: EXACT_BELIEF_MODEL_VERSION,
    quality: 'constraints-only',
    worlds,
    playerMarginals: playerMarginals(worlds, view.playerCount),
    roleMarginals: roleMarginals(worlds, view.rolesInPlay, view.playerCount),
    entropy: Math.log2(worlds.length),
    topWorlds: topWorlds(worlds),
  }
}

function validateTeam(snapshot: BeliefSnapshot, team: readonly Seat[]): readonly Seat[] {
  const unique = new Set(team)
  if (unique.size !== team.length) throw new Error('team assessment requires distinct seats')
  const playerCount = snapshot.playerMarginals.length
  for (const seat of team) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
      throw new Error(`invalid team seat ${seat} for ${playerCount} players`)
    }
  }
  return [...team].sort((a, b) => a - b)
}

export function assessTeam(
  snapshot: BeliefSnapshot,
  proposedTeam: readonly Seat[],
): TeamAssessment {
  return assessTeams(snapshot, [proposedTeam])[0]
}

const countBits = (value: number): number => {
  let remaining = value
  let count = 0
  while (remaining) {
    remaining &= remaining - 1
    count++
  }
  return count
}

/**
 * Batch the joint team projection so exhaustive 10-player proposal surfaces
 * scan each world's compact alignment mask rather than allocating a filtered
 * team for every world/candidate pair. The returned order matches the input;
 * decision-facing callers attach and validate stable candidate IDs.
 */
export function assessTeams(
  snapshot: BeliefSnapshot,
  proposedTeams: readonly (readonly Seat[])[],
): readonly TeamAssessment[] {
  if (!proposedTeams.length) return []
  const teams = proposedTeams.map((team) => validateTeam(snapshot, team))
  const firstProbability = snapshot.worlds[0]?.probability
  const uniform = snapshot.worlds.every(
    (weightedWorld) => weightedWorld.probability === firstProbability,
  )
  const maskWeights = new Map<number, number>()
  for (const weightedWorld of snapshot.worlds) {
    let evilMask = 0
    for (
      let seat = 0;
      seat < weightedWorld.world.alignmentBySeat.length;
      seat++
    ) {
      if (weightedWorld.world.alignmentBySeat[seat] === 'evil') {
        evilMask |= 1 << seat
      }
    }
    maskWeights.set(
      evilMask,
      (maskWeights.get(evilMask) ?? 0)
        + (uniform ? 1 : weightedWorld.probability),
    )
  }
  return teams.map((team): TeamAssessment => {
    let teamMask = 0
    for (const seat of team) teamMask |= 1 << seat
    const evilWorldCounts = Array<number>(team.length + 1).fill(0)
    for (const [evilMask, weight] of maskWeights) {
      evilWorldCounts[countBits(teamMask & evilMask)] += weight
    }
    const evilCountDistribution = uniform
      ? evilWorldCounts.map((count) => count / snapshot.worlds.length)
      : evilWorldCounts
    return {
      team,
      cleanProbability: evilCountDistribution[0],
      evilCountDistribution,
    }
  })
}

export function rolePossibilities(
  worlds: readonly HiddenWorld[],
  seat: Seat,
): readonly Role[] {
  const roles = new Set(worlds.map((world) => world.roleBySeat[seat]))
  return canonicalRoleMultiset([...roles])
}
