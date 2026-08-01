// Frozen, API-free good-side bank for Phase 4 policy comparisons.
//
// Ten independent deals cover Merlin, Percival, and the first Servant seat at
// every supported player count. Expected seats are pinned so an engine PRNG or
// deal change cannot silently alter the target population.

import type { Role, TalkConfig } from '../../engine/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const PHASE4_POLICY_BANK_ID = 'phase4-good-v1'

const NO_DISCUSSION: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

const CASTS: Readonly<Record<number, readonly Role[]>> = {
  5: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  6: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin'],
  7: [
    'merlin',
    'percival',
    'servant',
    'servant',
    'morgana',
    'assassin',
    'oberon',
  ],
  8: [
    'merlin',
    'percival',
    'servant',
    'servant',
    'servant',
    'morgana',
    'assassin',
    'minion',
  ],
  9: [
    'merlin',
    'percival',
    'servant',
    'servant',
    'servant',
    'servant',
    'morgana',
    'assassin',
    'mordred',
  ],
  10: [
    'merlin',
    'percival',
    'servant',
    'servant',
    'servant',
    'servant',
    'morgana',
    'assassin',
    'mordred',
    'oberon',
  ],
}

const EXPECTED_SEATS: Readonly<
  Record<number, Readonly<Record<'merlin' | 'percival' | 'servant', readonly number[]>>>
> = {
  5: {
    merlin: [0, 0, 0, 1, 1, 4, 4, 4, 4, 2],
    percival: [3, 4, 0, 3, 3, 0, 4, 4, 0, 4],
    servant: [2, 0, 3, 2, 0, 1, 4, 1, 3, 1],
  },
  6: {
    merlin: [2, 3, 5, 0, 1, 5, 5, 0, 1, 3],
    percival: [2, 0, 0, 2, 3, 3, 1, 1, 3, 5],
    servant: [1, 2, 1, 0, 2, 3, 1, 2, 3, 2],
  },
  7: {
    merlin: [5, 3, 6, 3, 6, 1, 6, 6, 0, 2],
    percival: [6, 6, 6, 0, 5, 5, 0, 5, 0, 4],
    servant: [1, 2, 1, 3, 0, 0, 3, 3, 1, 1],
  },
  8: {
    merlin: [3, 3, 4, 6, 5, 5, 2, 4, 4, 4],
    percival: [6, 5, 5, 5, 4, 1, 5, 1, 6, 0],
    servant: [4, 2, 4, 4, 1, 0, 2, 0, 3, 2],
  },
  9: {
    merlin: [4, 4, 4, 1, 4, 4, 1, 4, 2, 7],
    percival: [4, 4, 0, 7, 6, 6, 7, 8, 3, 7],
    servant: [2, 1, 5, 1, 1, 1, 4, 0, 1, 1],
  },
  10: {
    merlin: [2, 7, 8, 6, 7, 7, 9, 7, 0, 2],
    percival: [0, 1, 0, 2, 0, 7, 0, 0, 7, 8],
    servant: [3, 3, 3, 1, 2, 1, 0, 1, 3, 1],
  },
}

const TARGET_ROLES = ['merlin', 'percival', 'servant'] as const

export const PHASE4_POLICY_BANK: readonly ArchitectureBankCase[] = (
  [5, 6, 7, 8, 9, 10] as const
).flatMap((playerCount) =>
  TARGET_ROLES.flatMap((targetRole) =>
    EXPECTED_SEATS[playerCount]![targetRole]!.map(
      (expectedTargetSeat, index): ArchitectureBankCase => ({
        id: `${playerCount}p-${targetRole}-${index}`,
        seed:
          `${PHASE4_POLICY_BANK_ID}-${playerCount}-${targetRole}-${index}`,
        playerCount,
        roles: CASTS[playerCount]!,
        talk: NO_DISCUSSION,
        targetRole,
        expectedTargetSeat,
      }),
    ),
  ),
)
