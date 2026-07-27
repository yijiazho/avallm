import type { Role } from '../../engine/types.ts'
import type {
  HiddenWorld,
  PlayerMarginal,
  RoleMarginal,
} from './types.ts'
import { canonicalRoleMultiset } from './worlds.ts'

export interface UniformJointProjection {
  worldCount: number
  playerMarginals: readonly PlayerMarginal[]
  roleMarginals: readonly RoleMarginal[]
  entropy: number
}

/**
 * Shared exact projection kernel for a uniform stream of complete worlds.
 * Callers may enumerate retained private worlds or stream public worlds; this
 * function never materializes or exposes the joint assignments.
 */
export function projectUniformJointWorlds(
  playerCount: number,
  rolesInPlay: readonly Role[],
  visit: (visitor: (world: HiddenWorld) => void) => void,
): UniformJointProjection {
  const roles = [...new Set(canonicalRoleMultiset(rolesInPlay))]
  const roleCounts = Array.from(
    { length: playerCount },
    () => new Map<Role, number>(),
  )
  const evilCounts = Array<number>(playerCount).fill(0)
  let worldCount = 0
  visit((world) => {
    if (
      world.roleBySeat.length !== playerCount
      || world.alignmentBySeat.length !== playerCount
    ) {
      throw new Error('uniform joint projection received malformed world')
    }
    worldCount++
    for (let seat = 0; seat < playerCount; seat++) {
      const role = world.roleBySeat[seat]
      roleCounts[seat].set(role, (roleCounts[seat].get(role) ?? 0) + 1)
      if (world.alignmentBySeat[seat] === 'evil') evilCounts[seat]++
    }
  })
  if (worldCount === 0) {
    throw new Error('uniform joint projection requires at least one world')
  }
  return {
    worldCount,
    playerMarginals: Array.from({ length: playerCount }, (_, seat) => {
      const evilProbability = evilCounts[seat] / worldCount
      return {
        seat,
        goodProbability: 1 - evilProbability,
        evilProbability,
      }
    }),
    roleMarginals: Array.from(
      { length: playerCount },
      (_, seat) => roles.map((role) => ({
        seat,
        role,
        probability: (roleCounts[seat].get(role) ?? 0) / worldCount,
      })),
    ).flat(),
    entropy: Math.log2(worldCount),
  }
}
