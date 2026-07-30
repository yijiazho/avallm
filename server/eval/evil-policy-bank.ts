// Frozen, API-free evil-side bank for Phase 7 policy comparisons.
//
// It mirrors `good-policy-bank.ts`: same six casts, same no-discussion profile,
// same pinned expected seats so an engine PRNG or deal change cannot silently
// alter the target population. Only the target seat differs, which keeps the
// good and evil numbers comparable because both are drawn from the standard
// cast table rather than from casts invented for one side.
//
// Two scope choices are deliberate and are the reason the deal counts are
// uneven.
//
// The casts are `DEFAULT_ROLES`, so a target role appears only at the player
// counts where the standard table deals it: Morgana and Assassin at all six,
// Mordred at 9 and 10, and the generic Minion at 8. Widening a cast to force
// Minion onto a 5-player table would be legal under `validateRoles` but would
// measure a setup the lobby never offers.
//
// Each target role still gets 60 deals, matching the per-role sample the good
// bank gives Merlin, Percival, and Servant, so a thin table-size coverage does
// not also become a thin sample. Roles present at fewer counts take more deals
// per count.
//
// Oberon is out of scope for this bank. NB-011 covers generic evil (D2),
// Morgana, Mordred, and Assassin authority; an Oberon seat has no specialized
// policy layer of its own to make causal.

import type { Role, TalkConfig } from '../engine/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const PHASE7_EVIL_POLICY_BANK_ID = 'phase7-evil-v1'

/** Deals per target role, matching the good bank's per-role sample. */
export const PHASE7_EVIL_DEALS_PER_TARGET_ROLE = 60

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

type EvilTargetRole = 'morgana' | 'assassin' | 'mordred' | 'minion'

/** Declaration order is bank order, so it is also report-group order. */
export const PHASE7_EVIL_TARGET_ROLES: readonly EvilTargetRole[] = [
  'morgana',
  'assassin',
  'mordred',
  'minion',
]

const EXPECTED_SEATS: Readonly<
  Record<number, Readonly<Partial<Record<EvilTargetRole, readonly number[]>>>>
> = {
  5: {
    morgana: [2, 4, 1, 3, 1, 3, 4, 2, 1, 3],
    assassin: [1, 0, 3, 2, 1, 4, 1, 1, 0, 2],
  },
  6: {
    morgana: [2, 3, 5, 1, 1, 0, 2, 5, 1, 5],
    assassin: [0, 2, 2, 2, 0, 4, 3, 4, 5, 2],
  },
  7: {
    morgana: [1, 6, 2, 6, 0, 4, 5, 1, 1, 5],
    assassin: [2, 4, 6, 1, 3, 4, 3, 6, 1, 2],
  },
  8: {
    morgana: [2, 5, 0, 7, 0, 1, 1, 3, 5, 4],
    assassin: [5, 5, 6, 2, 0, 5, 7, 1, 3, 4],
    minion: [
      2, 7, 7, 1, 2, 4, 0, 7, 5, 1, 4, 2, 2, 2, 7, 4, 2, 7, 0, 6,
      2, 0, 0, 0, 7, 5, 6, 4, 4, 0, 3, 5, 3, 7, 4, 1, 4, 5, 5, 0,
      5, 4, 2, 6, 6, 7, 7, 4, 1, 4, 4, 6, 1, 3, 0, 6, 3, 5, 6, 2,
    ],
  },
  9: {
    morgana: [4, 4, 3, 8, 3, 3, 5, 7, 6, 5],
    assassin: [7, 3, 2, 6, 3, 7, 5, 6, 0, 2],
    mordred: [
      0, 4, 0, 2, 2, 2, 0, 3, 1, 7, 3, 0, 3, 8, 4, 5, 0, 4, 6, 6,
      7, 8, 1, 1, 5, 3, 5, 3, 8, 3,
    ],
  },
  10: {
    morgana: [7, 1, 6, 0, 8, 6, 5, 4, 6, 7],
    assassin: [0, 9, 8, 9, 6, 9, 7, 0, 2, 3],
    mordred: [
      0, 4, 1, 9, 5, 2, 0, 7, 6, 5, 7, 0, 9, 7, 1, 4, 5, 7, 1, 8,
      9, 9, 8, 6, 6, 0, 7, 8, 9, 6,
    ],
  },
}

/**
 * Target-role major, unlike the player-count-major good bank. The full-role
 * bench groups by target role, and a role here spans an uneven set of table
 * sizes, so grouping first keeps a `--cases` prefix a whole-role slice instead
 * of an arbitrary fragment of three roles.
 */
export const PHASE7_EVIL_POLICY_BANK: readonly ArchitectureBankCase[] =
  PHASE7_EVIL_TARGET_ROLES.flatMap((targetRole) =>
    ([5, 6, 7, 8, 9, 10] as const).flatMap((playerCount) =>
      (EXPECTED_SEATS[playerCount][targetRole] ?? []).map(
        (expectedTargetSeat, index): ArchitectureBankCase => ({
          id: `${playerCount}p-${targetRole}-${index}`,
          seed:
            `${PHASE7_EVIL_POLICY_BANK_ID}-${playerCount}-${targetRole}-${index}`,
          playerCount,
          roles: CASTS[playerCount],
          talk: NO_DISCUSSION,
          targetRole,
          expectedTargetSeat,
        }),
      ),
    ),
  )
