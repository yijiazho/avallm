// Per-role play-quality leading indicators over composed self-play. API-free,
// and deliberately decoupled from win rate (downstream and opponent-dependent):
// these are process signals for "is each role playing its role well".
//
// It assembles existing metric functions rather than inventing new ones. This
// first cut covers: per-role truth-aligned vote accuracy and forced-play
// violations (core/metrics.ts), Merlin conspicuousness and assassination rate
// (core/metrics.ts), and the assassin's Merlin-identification calibration
// (./assassin-calibration.ts). The signals still to fold in, each with a source
// that already exists, are belief calibration, Merlin exposure, servant
// clean-team quality, and an evil-cover axis (the one genuinely missing driver).

import { pathToFileURL } from 'node:url'
import { createGame } from '../../engine/game.ts'
import { createAgent } from '../../agents/registry.ts'
import { runGame } from '../../sim/runner.ts'
import { toArtifact } from '../core/artifact.ts'
import type { GameArtifact } from '../core/artifact.ts'
import { computeMetrics } from '../core/metrics.ts'
import {
  productionMerlinPosterior,
  scoreMerlinPosterior,
  generateAssassinCalibrationViews,
} from './assassin-calibration.ts'
import type { AvalonAgent } from '../../agents/types.ts'
import type { Role, Seat, TalkConfig } from '../../engine/types.ts'

export const ROLE_SCORECARD_VERSION = 'role-scorecard-v1'

const SILENT_TALK: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

/** One composed-self-play game (every seat the full-role mechanical stack). */
async function playComposedGame(
  seed: string,
  playerCount: number,
): Promise<GameArtifact> {
  const game = createGame({ seed, playerCount, talk: SILENT_TALK })
  const agents = new Map<Seat, AvalonAgent>()
  const descriptors: string[] = []
  for (const player of game.players) {
    agents.set(
      player.seat,
      createAgent(
        { type: 'composed', brain: 'full-role' },
        { seed, seat: player.seat },
      ),
    )
    descriptors.push('composed:full-role')
  }
  const result = await runGame({ game, agents })
  return toArtifact(game, {
    agents: descriptors,
    degraded: result.degraded,
    steps: result.steps,
  })
}

export interface RoleIndicators {
  readonly role: Role
  /** Seat-instances of this role across the sampled games. */
  readonly instances: number
  /** Mean truth-aligned vote score (reject iff the team seats evil); null if no revealed votes. */
  readonly voteAccuracy: number | null
  /** Provably-wrong moves declined, summed over instances (a floor: want 0). */
  readonly forcedPlayViolations: number
}

export interface RoleScorecard {
  readonly version: typeof ROLE_SCORECARD_VERSION
  readonly games: number
  readonly playerCount: number
  readonly perRole: readonly RoleIndicators[]
  readonly merlin: {
    /** Midrank of Merlin's vote-truth among good players; 1 = most conspicuous. Merlin should NOT be the most truth-aligned. */
    readonly meanConspicuousnessRank: number | null
    readonly goodPlayers: number | null
    /** Fraction of games reaching assassination in which Merlin was shot. */
    readonly assassinatedRate: number
  }
  /** The assassin's Merlin-identification calibration (its own held-out self-play). */
  readonly assassin: {
    readonly predictions: number
    readonly hitRate: number
    readonly meanBrier: number
    readonly meanLogLoss: number
  }
}

export interface RoleScorecardOptions {
  readonly games?: number
  readonly playerCount?: number
  readonly seedBase?: string
  /** Seeds per cast for the assassin calibration arm. */
  readonly assassinSeedsPer?: number
}

export async function runRoleScorecard(
  options: RoleScorecardOptions = {},
): Promise<RoleScorecard> {
  const games = options.games ?? 40
  const playerCount = options.playerCount ?? 7
  const seedBase = options.seedBase ?? 'role-scorecard'

  const artifacts: GameArtifact[] = []
  for (let index = 0; index < games; index++) {
    artifacts.push(await playComposedGame(`${seedBase}-${index}`, playerCount))
  }
  const metrics = artifacts.map(computeMetrics)

  const byRole = new Map<
    Role,
    { voteSum: number; voteCount: number; forced: number; instances: number }
  >()
  for (const gameMetrics of metrics) {
    for (const seat of gameMetrics.seats) {
      const accumulator = byRole.get(seat.role)
        ?? { voteSum: 0, voteCount: 0, forced: 0, instances: 0 }
      if (seat.voteScore !== null) {
        accumulator.voteSum += seat.voteScore
        accumulator.voteCount += 1
      }
      accumulator.forced += seat.forcedPlayViolations
      accumulator.instances += 1
      byRole.set(seat.role, accumulator)
    }
  }
  const perRole = [...byRole.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([role, accumulator]): RoleIndicators => ({
      role,
      instances: accumulator.instances,
      voteAccuracy: accumulator.voteCount
        ? accumulator.voteSum / accumulator.voteCount
        : null,
      forcedPlayViolations: accumulator.forced,
    }))

  const merlinMetrics = metrics
    .map((gameMetrics) => gameMetrics.merlin)
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
  const ranks = merlinMetrics
    .map((entry) => entry.conspicuousnessRank)
    .filter((rank): rank is number => rank !== null)
  const reached = merlinMetrics.filter((entry) => entry.assassinated !== null)
  const shot = reached.filter((entry) => entry.assassinated === true).length

  const calibration = scoreMerlinPosterior(
    generateAssassinCalibrationViews(options.assassinSeedsPer ?? 100),
    productionMerlinPosterior,
  )

  return {
    version: ROLE_SCORECARD_VERSION,
    games,
    playerCount,
    perRole,
    merlin: {
      meanConspicuousnessRank: ranks.length ? mean(ranks) : null,
      goodPlayers: merlinMetrics[0]?.goodPlayers ?? null,
      assassinatedRate: reached.length ? shot / reached.length : 0,
    },
    assassin: {
      predictions: calibration.predictions,
      hitRate: calibration.hitRate,
      meanBrier: calibration.meanBrier,
      meanLogLoss: calibration.meanLogLoss,
    },
  }
}

export function formatRoleScorecard(scorecard: RoleScorecard): string {
  const lines: string[] = []
  lines.push(
    `role scorecard  (${scorecard.games} composed self-play games, `
      + `${scorecard.playerCount} players)`,
  )
  lines.push('per role:')
  for (const role of scorecard.perRole) {
    const vote = role.voteAccuracy === null
      ? '   n/a'
      : role.voteAccuracy.toFixed(3)
    lines.push(
      `  ${role.role.padEnd(9)} vote-accuracy=${vote}  `
        + `forced-violations=${role.forcedPlayViolations}  `
        + `(n=${role.instances})`,
    )
  }
  const merlinRank = scorecard.merlin.meanConspicuousnessRank
  lines.push(
    `merlin: conspicuousness-rank=`
      + `${merlinRank === null ? 'n/a' : merlinRank.toFixed(2)}`
      + `/${scorecard.merlin.goodPlayers ?? '?'} good  `
      + `assassinated=${(scorecard.merlin.assassinatedRate * 100).toFixed(0)}%`,
  )
  lines.push(
    `assassin: merlin-id hit-rate=${scorecard.assassin.hitRate.toFixed(3)}  `
      + `brier=${scorecard.assassin.meanBrier.toFixed(3)}  `
      + `log-loss=${scorecard.assassin.meanLogLoss.toFixed(3)}  `
      + `(n=${scorecard.assassin.predictions})`,
  )
  return lines.join('\n')
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const games = Number(process.argv[2] ?? 40)
  const playerCount = Number(process.argv[3] ?? 7)
  runRoleScorecard({ games, playerCount }).then((scorecard) => {
    console.log(formatRoleScorecard(scorecard))
  })
}
