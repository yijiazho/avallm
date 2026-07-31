// A good-side bank wide enough to gate on.
//
// `phase4-good-v1` carries ten deals per player count, sixty per target role.
// Every recorded measurement is against it and it stays frozen for exactly that
// reason, but sixty games cannot decide the questions now queued against it.
// A net four-game paired win-rate shift at n = 60 cannot reach `p < 0.05` under
// ANY split of its discordant pairs: four discordant all one way is an exact
// sign-test `p = 0.125`, and realistic splits land between `0.29` and `0.50`.
//
// That is not a hypothetical bound. NB-016 was withheld for moving heuristic
// wins `7/60` to `11/60` against a two-game move the other way; NB-013's vote
// objective moved `7/60` to `10/60`. Three finished fixes are queued behind
// differences this bank cannot resolve, while the per-decision metrics that CAN
// resolve them (dirty-team approval, proposal cleanliness, Merlin exposure) all
// point the same way.
//
// So this is the same construction with six times the deals: identical casts,
// identical disabled-discussion profile, identical target roles, distinct seeds.
// Nothing about it is a better experiment, and that is the point. It is the
// same experiment with enough of it to see.
//
// Sizing. At the roughly one-third divergence rate measured on the servant
// propose channel, detecting a five-point paired shift at a 60/40 discordant
// split needs on the order of a hundred discordant pairs, so a few hundred
// games per cell. Three hundred and sixty per target role is that, with room
// for the cells that diverge less.

import { createGame } from '../../engine/game.ts'
import type { Role, TalkConfig } from '../../engine/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const WIDE_GOOD_BANK_ID = 'phase4-good-wide-v1'

/** Deals per player count per target role. Sixty is the sizing above. */
export const WIDE_GOOD_DEALS_PER_CELL = 60

const NO_DISCUSSION: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

/**
 * The `phase4-good-v1` casts verbatim. Copied rather than imported so the frozen
 * bank stays a frozen artifact: a shared constant would mean a change made for
 * this bank's sake could silently move the one every recorded number is against.
 */
const CASTS: Readonly<Record<number, readonly Role[]>> = Object.freeze({
  5: Object.freeze<Role[]>(
    ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  ),
  6: Object.freeze<Role[]>(
    ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin'],
  ),
  7: Object.freeze<Role[]>([
    'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon',
  ]),
  8: Object.freeze<Role[]>([
    'merlin', 'percival', 'servant', 'servant', 'servant', 'morgana',
    'assassin', 'minion',
  ]),
  9: Object.freeze<Role[]>([
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'morgana', 'assassin', 'mordred',
  ]),
  10: Object.freeze<Role[]>([
    'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
    'morgana', 'assassin', 'mordred', 'oberon',
  ]),
})

export const WIDE_GOOD_PLAYER_COUNTS: readonly number[] =
  Object.freeze([5, 6, 7, 8, 9, 10])

export const WIDE_GOOD_TARGET_ROLES: readonly Role[] =
  Object.freeze<Role[]>(['merlin', 'percival', 'servant'])

/**
 * The target seat is DERIVED by dealing the seed, not hand-listed.
 *
 * `phase4-good-v1` pins its seats as literals so an engine PRNG or deal change
 * cannot silently move the target population. That guard has to survive here,
 * but at 1,080 cases the literal form is 1,080 numbers that no reader can
 * check and that drift silently the first time someone regenerates half of
 * them. Deriving and then pinning ONE digest of the whole mapping is the same
 * guard: any change to the deal moves the digest, and the digest is a single
 * value a reviewer can actually compare. `wide-good-bank.test.ts` owns it.
 *
 * The seat is the first the role occupies, matching how the bench resolves its
 * target (`players.find`). With four servants in a ten-player cast that is a
 * real choice, and it is the same one the frozen bank made.
 */
function dealtTargetSeat(
  seed: string,
  playerCount: number,
  targetRole: Role,
): number {
  const game = createGame({
    seed,
    playerCount,
    roles: [...CASTS[playerCount]],
    talk: NO_DISCUSSION,
  })
  const target = game.players.find((player) => player.role === targetRole)
  if (!target) {
    throw new Error(
      `${WIDE_GOOD_BANK_ID}: ${targetRole} absent from the ${playerCount}p cast`,
    )
  }
  return target.seat
}

export const WIDE_GOOD_BANK: readonly ArchitectureBankCase[] = Object.freeze(
  WIDE_GOOD_PLAYER_COUNTS.flatMap((playerCount) =>
    WIDE_GOOD_TARGET_ROLES.flatMap((targetRole) =>
      Array.from({ length: WIDE_GOOD_DEALS_PER_CELL }, (_unused, index) => {
        // Distinct from the frozen bank's seeds on purpose: two banks sharing a
        // seed would produce two artifacts describing the same deal under
        // different bank ids, and a join on the deal could not tell them apart.
        const seed =
          `${WIDE_GOOD_BANK_ID}-${playerCount}-${targetRole}-${index}`
        return Object.freeze({
          id: `${playerCount}p-${targetRole}-${index}`,
          seed,
          playerCount,
          roles: CASTS[playerCount],
          talk: NO_DISCUSSION,
          targetRole,
          expectedTargetSeat: dealtTargetSeat(seed, playerCount, targetRole),
        })
      }),
    ),
  ),
)

/** The bank's cases for one target role, which is how a gate reads it. */
export function wideGoodBankFor(
  targetRole: Role,
): readonly ArchitectureBankCase[] {
  return WIDE_GOOD_BANK.filter((entry) => entry.targetRole === targetRole)
}

/**
 * A stable digest of the whole seed-to-seat mapping, which is what stands in
 * for the frozen bank's literal seat table. Deliberately not a cryptographic
 * hash import: this is a drift tripwire over a few thousand small integers, and
 * the engine's own string hash is the shape the repo already uses for that.
 */
export function wideGoodBankDigest(): string {
  let hash = 0x811c9dc5
  for (const entry of WIDE_GOOD_BANK) {
    for (const code of `${entry.seed}:${entry.expectedTargetSeat};`) {
      hash ^= code.charCodeAt(0)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
