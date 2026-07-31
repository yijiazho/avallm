// How legible is Merlin? The continuous form of the assassination channel.
//
// A good-side win is exactly two things: three quest successes, AND Merlin
// surviving the shot. NB-010 named the second as a real cost the composed
// policy pays, on the evidence that near-oracle votes raise assassinations from
// 16.7% to 26.7%. That measurement is a binary outcome, observed at most once
// per game and only in games that reach the shot at all, which is why NB-012's
// concealment fix has been sitting unpromoted: on 60 games of one measured cast
// the shot happened ZERO times, so the metric that gates it had no observations
// while this one had 252.
//
// Every binary outcome in this game is produced by a probability. So measure
// the probability. Exposure is the mass the assassin's own posterior puts on
// the true Merlin, sampled after each resolved quest. On the same games it
// carries roughly twenty times the resolution of the win rate, and it is
// defined on every game rather than only on the ones that reach an execution.
//
// Reported against the uninformed prior rather than raw, because the prior is
// 1/candidates and candidates differ by cast: raw exposure is not comparable
// between a five-player table and a ten-player one, and `lift` is. A lift of
// zero is a Merlin that played its whole game without telling the assassin
// anything it did not already know from the deal.
//
// That anchor is also this module's own self-check, and it earned its keep
// immediately: on an opening board, before anyone has acted, lift has to read
// exactly zero for every cast. The first draft divided by the posterior's
// target-list length and read +0.067 there, because that list carries every
// non-self seat including the partners the assassin already knows are evil. A
// suite pins the zero.
//
// WHAT THIS MEASURES, precisely: information leaked to a reference posterior,
// not punishment received from the opponent actually seated. Those come apart,
// and on purpose. Punishment confounds the good side's concealment with the
// assassin's competence, so it moves when the opponent pool changes and cannot
// be compared across banks. Leakage is a property of the good side's own play.
// A promotion decision should know which of the two it is reading.
//
// It reads artifacts a bench already wrote, replaying each to the sample point,
// so every archived run can be re-scored for it without playing a game. Offline
// evaluation only: it joins the true deal and makes no provider call.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readArtifacts } from './artifact.ts'
import { replayGame } from './replay.ts'
import { meanEstimate, rate } from './statistics.ts'
import type { MeanEstimate } from './statistics.ts'
import { viewFor } from '../engine/view.ts'
import { exactBelief } from '../agents/belief/exact.ts'
import {
  buildPrivateEvilSeatMerlinPosterior,
} from '../agents/analysis/assassin-merlin-posterior.ts'
import type { GameArtifact } from './artifact.ts'
import type { Seat } from '../engine/types.ts'

export const MERLIN_EXPOSURE_VERSION = 'merlin-exposure-v1'

/** One reading of the assassin's posterior, after `questsResolved` quests. */
export interface MerlinExposureSample {
  readonly seq: number
  /** Quests resolved before this reading; 0 is the opening board. */
  readonly questsResolved: number
  /** Posterior mass on the true Merlin seat. */
  readonly exposure: number
  /**
   * Seats still FEASIBLE as Merlin, which is not the length of the posterior's
   * target list: that list carries every non-self seat and gives the assassin's
   * known partners zero mass. Dividing by the list length would make the prior
   * a function of how many partners this cast lets the assassin see, so the
   * anchor would drift by cast instead of measuring play.
   */
  readonly candidates: number
  /** The uninformed reference, 1/candidates. */
  readonly prior: number
  /** exposure - prior: the part attributable to play rather than to the deal. */
  readonly lift: number
}

export interface MerlinExposureGame {
  readonly artifactId: string
  readonly playerCount: number
  readonly merlinSeat: Seat
  readonly assassinSeat: Seat
  readonly samples: readonly MerlinExposureSample[]
  /** Whether the game actually reached an execution, for the contrast. */
  readonly reachedShot: boolean
  readonly merlinAssassinated: boolean
}

/** Published mean-with-interval; this module adds no estimator of its own. */
export type ExposureEstimate = MeanEstimate

export interface MerlinExposureRoundSlice {
  readonly questsResolved: number
  readonly exposure: ExposureEstimate
  readonly lift: ExposureEstimate
}

export interface MerlinExposureSummary {
  readonly version: typeof MERLIN_EXPOSURE_VERSION
  readonly games: number
  readonly samples: number
  /**
   * Pooled over games, NOT over samples. Samples inside one game share a deal
   * and a Merlin, so they are not independent draws and pooling them raw would
   * overstate the precision by roughly the square root of the samples per game.
   * Each game contributes its own mean, and the interval is taken across games.
   */
  readonly clusteredLift: ExposureEstimate
  readonly clusteredExposure: ExposureEstimate
  /**
   * Per round there is exactly one sample per game, so within a slice the
   * observations ARE independent and the interval needs no clustering.
   */
  readonly byRound: readonly MerlinExposureRoundSlice[]
  /** The binary this replaces, for the contrast that motivates it. */
  readonly gamesReachingShot: number
  readonly assassinationRate: ReturnType<typeof rate>
}

/**
 * The sequence numbers to read the posterior at: the opening board, then after
 * each resolved quest. The opening reading is what makes the series anchored
 * rather than merely comparable; it should land on the prior exactly, and a
 * suite asserts that it does.
 */
function samplePoints(artifact: GameArtifact): readonly number[] {
  const points: number[] = [];
  const created = artifact.log[0]
  if (created) points.push(created.seq + 1)
  for (const event of artifact.log) {
    if (event.type === 'questResult') points.push(event.seq + 1)
  }
  return Object.freeze(points)
}

/**
 * Score one archived game. Returns undefined when the metric is undefined for
 * it: no Merlin in the cast (legal, and then there is nothing to expose) or no
 * assassin (then nobody holds the posterior this reads).
 */
export function scoreMerlinExposure(
  artifact: GameArtifact,
): MerlinExposureGame | undefined {
  const merlin = artifact.players.find((player) => player.role === 'merlin')
  const assassin = artifact.players.find((player) => player.role === 'assassin')
  if (!merlin || !assassin) return undefined

  const samples: MerlinExposureSample[] = []
  let questsResolved = 0
  for (const seq of samplePoints(artifact)) {
    const game = replayGame(artifact, seq)
    const view = viewFor(game, assassin.seat)
    let posterior
    try {
      posterior = buildPrivateEvilSeatMerlinPosterior({
        view,
        belief: exactBelief(view),
      })
    } catch {
      // The predictor declines rather than guesses (no Merlin in the cast, or a
      // belief cursor that does not match the view). Skipping the reading is
      // the truthful response; inventing one would be the alternative.
      questsResolved += 1
      continue
    }
    // Exactly zero, not a tolerance: feasibility is a hard property of the
    // world enumeration, so a seat is either a possible Merlin or it is not.
    // A seat that later loses all its mass has genuinely stopped being a
    // candidate, and the prior should rise to match.
    const candidates = posterior.targets.filter(
      (target) => target.posteriorProbability > 0,
    ).length
    if (candidates === 0) {
      questsResolved += 1
      continue
    }
    const exposure = posterior.targets.find(
      (target) => target.seat === merlin.seat,
    )?.posteriorProbability ?? 0
    const prior = 1 / candidates
    samples.push(Object.freeze({
      seq,
      questsResolved,
      exposure,
      candidates,
      prior,
      lift: exposure - prior,
    }))
    questsResolved += 1
  }
  if (!samples.length) return undefined

  const assassination = artifact.log.find(
    (event) => event.type === 'assassination',
  )
  return Object.freeze({
    artifactId: artifact.id,
    playerCount: artifact.playerCount,
    merlinSeat: merlin.seat,
    assassinSeat: assassin.seat,
    samples: Object.freeze(samples),
    reachedShot: assassination !== undefined,
    merlinAssassinated: artifact.winReason === 'merlinAssassinated',
  })
}

export function summarizeMerlinExposure(
  scored: readonly MerlinExposureGame[],
): MerlinExposureSummary {
  const rounds = new Map<number, { exposure: number[]; lift: number[] }>()
  for (const game of scored) {
    for (const sample of game.samples) {
      const slice = rounds.get(sample.questsResolved)
        ?? { exposure: [], lift: [] }
      slice.exposure.push(sample.exposure)
      slice.lift.push(sample.lift)
      rounds.set(sample.questsResolved, slice)
    }
  }
  const perGameMean = (
    pick: (sample: MerlinExposureSample) => number,
  ): number[] =>
    scored.map((game) =>
      game.samples.reduce((sum, sample) => sum + pick(sample), 0)
      / game.samples.length)
  const reaching = scored.filter((game) => game.reachedShot)
  return Object.freeze({
    version: MERLIN_EXPOSURE_VERSION,
    games: scored.length,
    samples: scored.reduce((sum, game) => sum + game.samples.length, 0),
    clusteredLift: meanEstimate(perGameMean((sample) => sample.lift)),
    clusteredExposure: meanEstimate(perGameMean((sample) => sample.exposure)),
    byRound: Object.freeze(
      [...rounds.entries()]
        .sort(([left], [right]) => left - right)
        .map(([questsResolved, slice]) => Object.freeze({
          questsResolved,
          exposure: meanEstimate(slice.exposure),
          lift: meanEstimate(slice.lift),
        })),
    ),
    gamesReachingShot: reaching.length,
    assassinationRate: rate(
      reaching.filter((game) => game.merlinAssassinated).length,
      reaching.length,
    ),
  })
}

/** Score every artifact the metric is defined for. */
export function measureMerlinExposure(
  artifacts: readonly GameArtifact[],
): {
  readonly scored: readonly MerlinExposureGame[]
  readonly summary: MerlinExposureSummary
} {
  const scored = artifacts.flatMap((artifact) => {
    const game = scoreMerlinExposure(artifact)
    return game ? [game] : []
  })
  return { scored, summary: summarizeMerlinExposure(scored) }
}

const signed = (value: number | null): string =>
  value === null ? '    n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(4)}`

const plain = (value: number | null): string =>
  value === null ? '   n/a' : value.toFixed(4)

const bounds = (
  interval: Readonly<{ low: number; high: number }> | null,
): string =>
  interval === null
    ? ''
    : ` [${signed(interval.low)}, ${signed(interval.high)}]`

export function renderMerlinExposure(
  summary: MerlinExposureSummary,
): string {
  const lines: string[] = [
    `${summary.version}: ${summary.games} games, ${summary.samples} readings`,
    '',
    '  exposure = the assassin posterior mass on the true Merlin. lift =',
    '  exposure minus the uninformed 1/candidates prior, which is what makes a',
    '  five-player table comparable with a ten-player one. Zero lift is a',
    '  Merlin that told the assassin nothing the deal had not already.',
    '',
    `  pooled over games   exposure ${plain(summary.clusteredExposure.mean)}`
    + `   lift ${signed(summary.clusteredLift.mean)}`
    + `${bounds(summary.clusteredLift.interval95)}`,
    '  (clustered by game: readings inside one game share a deal and a Merlin,',
    '   so they are not independent and the interval is taken across games)',
    '',
    '  by quests resolved. One reading per game per row, so these need no',
    '  clustering and their intervals are exact.',
    '  quests  games   exposure      lift                        prior-anchored',
  ]
  for (const slice of summary.byRound) {
    lines.push(
      `  ${String(slice.questsResolved).padStart(6)}`
      + `${String(slice.exposure.observations).padStart(7)}`
      + `   ${plain(slice.exposure.mean)}`
      + `   ${signed(slice.lift.mean)}`
      + `${bounds(slice.lift.interval95)}`,
    )
  }
  lines.push(
    '',
    '  the binary this replaces, on the same games:',
    `  games reaching a shot ${summary.gamesReachingShot} of ${summary.games}`
    + `; Merlin assassinated ${summary.assassinationRate.successes}`
    + `/${summary.assassinationRate.trials}`
    + (summary.assassinationRate.interval95
      ? ` (95% ${(100 * summary.assassinationRate.interval95.low).toFixed(1)}%`
        + ` to ${(100 * summary.assassinationRate.interval95.high).toFixed(1)}%)`
      : ' (no interval: no game reached a shot)'),
  )
  return lines.join('\n')
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false } },
  })
  if (positionals.length !== 1) {
    throw new Error(
      'usage: node server/eval/merlin-exposure.ts <artifacts.jsonl> [--json]',
    )
  }
  const { summary } = measureMerlinExposure(readArtifacts(positionals[0]))
  process.stdout.write(
    values.json
      ? `${JSON.stringify(summary, null, 2)}\n`
      : `${renderMerlinExposure(summary)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
