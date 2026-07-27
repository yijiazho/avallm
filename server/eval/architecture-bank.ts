// Fixed, no-cost seed bank for the probabilistic-agent migration.
//
// Each case names one role under test. Architecture benchmarks seat the
// compared agent at the seat that the unchanged engine deal assigns that role;
// no role is forced into the engine. The exact roles, talk configuration, and
// expected target seat are stored here so a future default-config or PRNG
// change fails loudly instead of silently changing the comparison population.

import { MAX_PLAYERS, MIN_PLAYERS, validateRoles } from '../engine/rules.ts'
import type { Role, TalkConfig } from '../engine/types.ts'

export const ARCHITECTURE_BANK_ID = 'standard-v1'

export interface ArchitectureBankCase {
  id: string
  seed: string
  playerCount: number
  roles: readonly Role[]
  talk: TalkConfig
  targetRole: Role
  expectedTargetSeat: number
}

const NO_DISCUSSION: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

const bankCase = (
  playerCount: number,
  targetRole: Role,
  expectedTargetSeat: number,
  roles: readonly Role[],
): ArchitectureBankCase => ({
  id: `${playerCount}p-${targetRole}`,
  seed: `architecture-v1-${playerCount}-${targetRole}`,
  playerCount,
  roles,
  talk: NO_DISCUSSION,
  targetRole,
  expectedTargetSeat,
})

export const ARCHITECTURE_BANK: readonly ArchitectureBankCase[] = [
  bankCase(5, 'merlin', 4, ['merlin', 'percival', 'servant', 'morgana', 'assassin']),
  bankCase(5, 'percival', 2, ['merlin', 'percival', 'servant', 'morgana', 'assassin']),
  bankCase(5, 'servant', 2, ['merlin', 'percival', 'servant', 'morgana', 'assassin']),
  bankCase(5, 'morgana', 4, ['merlin', 'percival', 'servant', 'morgana', 'assassin']),
  bankCase(5, 'assassin', 3, ['merlin', 'percival', 'servant', 'morgana', 'assassin']),
  bankCase(6, 'servant', 1, ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin']),
  bankCase(7, 'oberon', 6, ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon']),
  bankCase(8, 'minion', 0, ['merlin', 'percival', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'minion']),
  bankCase(9, 'mordred', 3, ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred']),
  bankCase(10, 'oberon', 0, ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred', 'oberon']),
]

export const STANDARD_ROLES: readonly Role[] = [
  'merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion',
]

export function validateArchitectureBank(
  cases: readonly ArchitectureBankCase[] = ARCHITECTURE_BANK,
): void {
  const ids = new Set<string>()
  const seeds = new Set<string>()
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate architecture bank case id: ${c.id}`)
    if (seeds.has(c.seed)) throw new Error(`duplicate architecture bank seed: ${c.seed}`)
    ids.add(c.id)
    seeds.add(c.seed)
    if (c.playerCount < MIN_PLAYERS || c.playerCount > MAX_PLAYERS) {
      throw new Error(`${c.id}: player count ${c.playerCount} is outside ${MIN_PLAYERS}-${MAX_PLAYERS}`)
    }
    validateRoles(c.playerCount, [...c.roles])
    if (!c.roles.includes(c.targetRole)) {
      throw new Error(`${c.id}: target role ${c.targetRole} is not in the cast`)
    }
    if (
      c.talk.maxRounds !== 0
      || c.talk.maxRoundsAfterChange !== 0
      || c.talk.leaderInDiscussion !== 'none'
    ) {
      throw new Error(`${c.id}: Phase 0 bank must keep discussion disabled`)
    }
  }

  for (let playerCount = MIN_PLAYERS; playerCount <= MAX_PLAYERS; playerCount++) {
    if (!cases.some((c) => c.playerCount === playerCount)) {
      throw new Error(`architecture bank does not cover ${playerCount} players`)
    }
  }
  for (const role of STANDARD_ROLES) {
    if (!cases.some((c) => c.targetRole === role)) {
      throw new Error(`architecture bank does not target standard role ${role}`)
    }
  }
}
