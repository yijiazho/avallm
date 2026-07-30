import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { Role, Seat } from '../../engine/types.ts'
import {
  compareCanonicalRoles,
  type HiddenWorld,
} from './types.ts'

export interface RoleMultisetEvidence {
  playerCount: number
  rolesInPlay: readonly Role[]
}

const CACHE_LIMIT = 4
const assignmentCache = new Map<string, Map<Role, readonly (readonly Role[])[]>>()

export function canonicalRoleMultiset(roles: readonly Role[]): readonly Role[] {
  return [...roles].sort(compareCanonicalRoles)
}

export function canonicalWorldKey(roleBySeat: readonly Role[]): string {
  return roleBySeat.join('|')
}

export function compareWorldKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function cacheEntry(evidence: RoleMultisetEvidence): Map<Role, readonly (readonly Role[])[]> {
  if (evidence.rolesInPlay.length !== evidence.playerCount) {
    throw new Error(
      `cannot enumerate ${evidence.rolesInPlay.length} roles for ${evidence.playerCount} seats`,
    )
  }
  const key = canonicalRoleMultiset(evidence.rolesInPlay).join('|')
  const found = assignmentCache.get(key)
  if (found) {
    assignmentCache.delete(key)
    assignmentCache.set(key, found)
    return found
  }
  const created = new Map<Role, readonly (readonly Role[])[]>()
  assignmentCache.set(key, created)
  while (assignmentCache.size > CACHE_LIMIT) {
    const oldest = assignmentCache.keys().next().value
    if (oldest !== undefined) assignmentCache.delete(oldest)
  }
  return created
}

/**
 * Enumerate unique role assignments with `pinnedRole` at canonical seat zero.
 * Repeated Servant and Minion copies are consumed as multiset counts, never as
 * separately permuted cards.
 */
function canonicalPinnedAssignments(
  evidence: RoleMultisetEvidence,
  pinnedRole: Role,
): readonly (readonly Role[])[] {
  const entry = cacheEntry(evidence)
  const cached = entry.get(pinnedRole)
  if (cached) return cached

  const counts = new Map<Role, number>()
  for (const role of evidence.rolesInPlay) counts.set(role, (counts.get(role) ?? 0) + 1)
  const pinnedCopies = counts.get(pinnedRole) ?? 0
  if (pinnedCopies === 0) {
    entry.set(pinnedRole, [])
    return []
  }
  counts.set(pinnedRole, pinnedCopies - 1)

  const roles = [...counts.keys()].sort(compareCanonicalRoles)
  const current: Role[] = [pinnedRole]
  const assignments: Role[][] = []

  const visit = (): void => {
    if (current.length === evidence.playerCount) {
      assignments.push(current.slice())
      return
    }
    for (const role of roles) {
      const remaining = counts.get(role) ?? 0
      if (remaining === 0) continue
      counts.set(role, remaining - 1)
      current.push(role)
      visit()
      current.pop()
      counts.set(role, remaining)
    }
  }
  visit()
  entry.set(pinnedRole, assignments)
  return assignments
}

/**
 * Enumerate every unique public role world with one seat pinned. The result is
 * sorted by canonicalWorldKey and is independent of input role ordering.
 */
export function enumerateCanonicalWorlds(
  evidence: RoleMultisetEvidence,
  pinned: { seat: Seat; role: Role },
): readonly HiddenWorld[] {
  if (!Number.isInteger(pinned.seat) || pinned.seat < 0 || pinned.seat >= evidence.playerCount) {
    throw new Error(`invalid pinned seat ${pinned.seat} for ${evidence.playerCount} players`)
  }

  const actualSeats = Array.from(
    { length: evidence.playerCount },
    (_, seat) => seat,
  ).filter((seat) => seat !== pinned.seat)

  const worlds = canonicalPinnedAssignments(evidence, pinned.role).map((canonical) => {
    const roleBySeat = Array<Role>(evidence.playerCount)
    roleBySeat[pinned.seat] = pinned.role
    for (let i = 0; i < actualSeats.length; i++) {
      roleBySeat[actualSeats[i]] = canonical[i + 1]
    }
    return {
      roleBySeat,
      alignmentBySeat: roleBySeat.map((role) => ROLE_ALIGNMENT[role]),
      key: canonicalWorldKey(roleBySeat),
    }
  })
  worlds.sort((a, b) => compareWorldKeys(a.key, b.key))
  return worlds
}

/**
 * Visit every unique complete assignment of the public role multiset without
 * pinning a seat or retaining the assignments. This is the public-observer
 * counterpart to enumerateCanonicalWorlds: it preserves the same canonical
 * role and seat order while keeping the 10-player worst case bounded in
 * memory.
 */
export function visitCanonicalWorlds(
  evidence: RoleMultisetEvidence,
  visitor: (world: HiddenWorld) => void,
): number {
  if (evidence.rolesInPlay.length !== evidence.playerCount) {
    throw new Error(
      `cannot enumerate ${evidence.rolesInPlay.length} roles for ${evidence.playerCount} seats`,
    )
  }
  const counts = new Map<Role, number>()
  for (const role of evidence.rolesInPlay) {
    counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  const roles = [...counts.keys()].sort(compareCanonicalRoles)
  const roleBySeat: Role[] = []
  let visited = 0
  const visit = (): void => {
    if (roleBySeat.length === evidence.playerCount) {
      const rolesForWorld = roleBySeat.slice()
      visitor({
        roleBySeat: rolesForWorld,
        alignmentBySeat: rolesForWorld.map((role) => ROLE_ALIGNMENT[role]),
        key: canonicalWorldKey(rolesForWorld),
      })
      visited++
      return
    }
    for (const role of roles) {
      const remaining = counts.get(role) ?? 0
      if (remaining === 0) continue
      counts.set(role, remaining - 1)
      roleBySeat.push(role)
      visit()
      roleBySeat.pop()
      counts.set(role, remaining)
    }
  }
  visit()
  return visited
}
