import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { Role, Seat } from '../../engine/types.ts'
import { compareCanonicalRoles } from '../canonical/canonical-shape.ts'
import type { HiddenWorld } from './types.ts'
import { LruMap } from '../../shared/lru.ts'

export interface RoleMultisetEvidence {
  playerCount: number
  rolesInPlay: readonly Role[]
}

// Only a handful of distinct casts are ever in play in one process, so a small
// bound retains every live enumeration while capping a pathological churn.
// (exact.ts keeps a larger DEAL_CACHE_LIMIT because it keys on the far wider
// space of per-seat private views, not just the public cast.)
const CACHE_LIMIT = 4
const assignmentCache =
  new LruMap<string, Map<Role, readonly (readonly Role[])[]>>(CACHE_LIMIT)

/**
 * The multiset-backtracking core both enumerators share. It walks the sorted
 * distinct roles, consuming each role's remaining count, and calls onComplete
 * once `current` names a full assignment. The caller owns `current` (its seed
 * and its materialization) and `counts` (its starting multiset); this only
 * mutates them in the recurse-and-restore pattern and leaves them as it found
 * them. Iteration order is fixed by `roles`, so both callers enumerate worlds
 * in the identical canonical order.
 */
function backtrackMultisetAssignments(
  counts: Map<Role, number>,
  roles: readonly Role[],
  playerCount: number,
  current: Role[],
  onComplete: () => void,
): void {
  if (current.length === playerCount) {
    onComplete()
    return
  }
  for (const role of roles) {
    const remaining = counts.get(role) ?? 0
    if (remaining === 0) continue
    counts.set(role, remaining - 1)
    current.push(role)
    backtrackMultisetAssignments(counts, roles, playerCount, current, onComplete)
    current.pop()
    counts.set(role, remaining)
  }
}

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
  if (found) return found
  const created = new Map<Role, readonly (readonly Role[])[]>()
  assignmentCache.set(key, created)
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
  backtrackMultisetAssignments(
    counts,
    roles,
    evidence.playerCount,
    current,
    () => assignments.push(current.slice()),
  )
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
  backtrackMultisetAssignments(
    counts,
    roles,
    evidence.playerCount,
    roleBySeat,
    () => {
      const rolesForWorld = roleBySeat.slice()
      visitor({
        roleBySeat: rolesForWorld,
        alignmentBySeat: rolesForWorld.map((role) => ROLE_ALIGNMENT[role]),
        key: canonicalWorldKey(rolesForWorld),
      })
      visited++
    },
  )
  return visited
}

/**
 * The canonical set of roles a seat holds across a raw world list. Operates on
 * HiddenWorld[] directly (the enumeration currency), not on a projected
 * snapshot, so it lives beside the enumerator rather than in the snapshot
 * layer.
 */
export function rolePossibilities(
  worlds: readonly HiddenWorld[],
  seat: Seat,
): readonly Role[] {
  const roles = new Set(worlds.map((world) => world.roleBySeat[seat]))
  return canonicalRoleMultiset([...roles])
}
