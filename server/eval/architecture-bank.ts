// Fixed, no-cost seed bank for the probabilistic-agent migration.
//
// Each case names one role under test. Architecture benchmarks seat the
// compared agent at the seat that the unchanged engine deal assigns that role;
// no role is forced into the engine. The exact roles, talk configuration, and
// expected target seat are stored here so a future default-config or PRNG
// change fails loudly instead of silently changing the comparison population.

import { MAX_PLAYERS, MIN_PLAYERS, validateRoles } from '../engine/rules.ts'
import type { Role, TalkConfig } from '../engine/types.ts'
import { ROLES } from '../engine/types.ts'

export const ARCHITECTURE_BANK_ID = 'standard-v1'
export const STANDARD_ARCHITECTURE_BANK_PROFILE =
  'phase0-no-discussion-v1'
export const ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID =
  'public-dialogue-language-v1'
export const ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE =
  'public-dialogue-one-round-v1'

export type ArchitectureBankProfile =
  | typeof STANDARD_ARCHITECTURE_BANK_PROFILE
  | typeof ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE

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

/**
 * Small API-free bank for exercising the complete bounded-language pipeline.
 * It is deliberately separate from the frozen Phase 0 bank and pins a public
 * discussion configuration rather than relaxing that bank's validator.
 */
export const ACTIVE_LANGUAGE_ARCHITECTURE_BANK:
  readonly ArchitectureBankCase[] = [{
  id: '5p-servant-public-dialogue',
  seed: 'architecture-v1-5-servant',
  playerCount: 5,
  roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  talk: {
    maxRounds: 1,
    maxRoundsAfterChange: 0,
    leaderInDiscussion: 'last',
  },
  targetRole: 'servant',
  expectedTargetSeat: 2,
}]

export const STANDARD_ROLES: readonly Role[] = ROLES

export interface ArchitectureBankCaseGroup {
  readonly targetRole: Role
  readonly cases: readonly ArchitectureBankCase[]
}

/**
 * Target-role groups in bank order, for benches that report per target role.
 * Insertion order rather than alphabetical, so a group's position matches where
 * its cases first appear in the bank and two benches over the same bank cannot
 * disagree about which report is which.
 */
export function groupBankCasesByTargetRole(
  cases: readonly ArchitectureBankCase[],
): readonly ArchitectureBankCaseGroup[] {
  const order: Role[] = []
  const grouped = new Map<Role, ArchitectureBankCase[]>()
  for (const bankCase of cases) {
    const existing = grouped.get(bankCase.targetRole)
    if (existing) {
      existing.push(bankCase)
      continue
    }
    order.push(bankCase.targetRole)
    grouped.set(bankCase.targetRole, [bankCase])
  }
  return order.map((targetRole) => Object.freeze({
    targetRole,
    cases: Object.freeze(grouped.get(targetRole)!),
  }))
}

export function validateArchitectureBank(
  cases: readonly ArchitectureBankCase[] = ARCHITECTURE_BANK,
  opts: {
    requireCoverage?: boolean
    profile?: ArchitectureBankProfile
  } = {},
): void {
  const profile = opts.profile ?? STANDARD_ARCHITECTURE_BANK_PROFILE
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
    if (profile === STANDARD_ARCHITECTURE_BANK_PROFILE) {
      if (
        c.talk.maxRounds !== 0
        || c.talk.maxRoundsAfterChange !== 0
        || c.talk.leaderInDiscussion !== 'none'
      ) {
        throw new Error(`${c.id}: Phase 0 bank must keep discussion disabled`)
      }
    } else if (
      c.talk.maxRounds !== 1
      || c.talk.maxRoundsAfterChange !== 0
      || c.talk.leaderInDiscussion !== 'last'
    ) {
      throw new Error(
        `${c.id}: active-language bank must use its versioned public-dialogue profile`,
      )
    }
  }

  if (opts.requireCoverage ?? true) {
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
}
