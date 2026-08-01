// The Merlin-identification race, round by round: does the assassin concentrate
// on the true Merlin faster than the servants? API-free.
//
// SCOPE: this measures who READS the true Merlin faster, one input to the
// endgame. It is NOT a measure of whether servants can protect Merlin. Cover
// does not require winning this race: a servant can degrade the assassin's read
// (make Merlin one of several plausible Merlins) while trailing it on
// confidence. That confusability effect is measured separately in
// cover-effect.ts; do not read an assassin lead here as "cover fails".
//
// It separates the two components of the assassin's lead:
//   - servantBeliefConfidence   : mean P(true Merlin = Merlin) in a servant's
//                                  (quest-weighted) belief. Servants have no
//                                  Merlin detector, so this is belief alone.
//   - assassinBeliefConfidence  : the same read from the assassin's belief.
//                                  Its excess over the servant's is the
//                                  PRIVATE-INFO advantage (evil is known, so the
//                                  candidate pool is smaller from turn zero).
//   - assassinPosteriorConfidence: the assassin's actual Merlin posterior
//                                  (belief x behavioral overlay). Its excess
//                                  over assassinBeliefConfidence is the DETECTOR
//                                  advantage the servant has no analogue for.
// Sampled after each resolved quest, so both sides read the same public record.

import { pathToFileURL } from 'node:url'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../engine/game.ts'
import { viewFor } from '../../engine/view.ts'
import { createAgent } from '../../agents/registry.ts'
import { questWeightedBeliefModel } from '../../agents/belief/quest-card-factor.ts'
import { buildPrivateEvilSeatMerlinPosterior } from '../../agents/analysis/assassin-merlin-posterior.ts'
import type { AvalonAgent } from '../../agents/types.ts'
import type { PlayerView, Seat, TalkConfig } from '../../engine/types.ts'

export const MERLIN_RACE_VERSION = 'merlin-race-v1'

const SILENT_TALK: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

/** Belief probability that the true Merlin seat is Merlin. */
function beliefMerlinConfidence(view: PlayerView, merlinSeat: Seat): number {
  return questWeightedBeliefModel.infer(view).roleMarginals.find(
    (marginal) => marginal.role === 'merlin' && marginal.seat === merlinSeat,
  )?.probability ?? 0
}

/** The assassin's actual Merlin-posterior confidence in the true Merlin, or null if inapplicable. */
function assassinPosteriorConfidence(
  view: PlayerView,
  merlinSeat: Seat,
): number | null {
  try {
    const posterior = buildPrivateEvilSeatMerlinPosterior({
      view,
      belief: questWeightedBeliefModel.infer(view),
    })
    return posterior.targets.find((target) => target.seat === merlinSeat)
      ?.posteriorProbability ?? 0
  } catch {
    return null
  }
}

interface RoundSamples {
  servantBelief: number[]
  assassinBelief: number[]
  assassinPosterior: number[]
  assassinAhead: number
  total: number
}

export interface RoundRace {
  readonly round: number
  readonly samples: number
  readonly servantBeliefConfidence: number
  readonly assassinBeliefConfidence: number
  readonly assassinPosteriorConfidence: number
  /** Fraction of games at this round where the assassin's posterior beat the servants' belief. */
  readonly assassinAheadRate: number
}

export interface MerlinRaceResult {
  readonly version: typeof MERLIN_RACE_VERSION
  readonly games: number
  readonly playerCount: number
  readonly byRound: readonly RoundRace[]
  /** Over all (game, round) samples, the fraction where the assassin led. */
  readonly assassinAheadRate: number
}

export async function runMerlinRaceDiagnostic(
  options: { games?: number; playerCount?: number; seedBase?: string } = {},
): Promise<MerlinRaceResult> {
  const games = options.games ?? 40
  const playerCount = options.playerCount ?? 7
  const seedBase = options.seedBase ?? 'merlin-race'

  const rounds = new Map<number, RoundSamples>()
  const record = (round: number, servant: number, assassinBelief: number, assassinPost: number) => {
    const bucket = rounds.get(round)
      ?? { servantBelief: [], assassinBelief: [], assassinPosterior: [], assassinAhead: 0, total: 0 }
    bucket.servantBelief.push(servant)
    bucket.assassinBelief.push(assassinBelief)
    bucket.assassinPosterior.push(assassinPost)
    bucket.total += 1
    if (assassinPost > servant) bucket.assassinAhead += 1
    rounds.set(round, bucket)
  }

  for (let index = 0; index < games; index++) {
    const seed = `${seedBase}-${index}`
    const game = createGame({ seed, playerCount, talk: SILENT_TALK })
    const merlinSeat = game.players.find((p) => p.role === 'merlin')!.seat
    const assassinSeat = game.players.find((p) => p.role === 'assassin')?.seat
    const servantSeats = game.players
      .filter((p) => p.role === 'servant')
      .map((p) => p.seat)
    if (assassinSeat === undefined || !servantSeats.length) continue
    const agents = new Map<Seat, AvalonAgent>()
    for (const player of game.players) {
      agents.set(player.seat, createAgent({ type: 'composed', brain: 'full-role' }, { seed, seat: player.seat }))
    }

    let completed = 0
    let guard = 0
    while (game.phase !== 'gameOver' && guard++ < 400) {
      const reqs = expectedDecisions(game)
      if (!reqs.length) break
      for (const req of reqs) {
        const decision = (await agents.get(req.seat)!.decide(req, viewFor(game, req.seat))).decision
        applyDecision(game, req.seat, decision)
      }
      const done = viewFor(game, merlinSeat).quests
        .filter((quest) => quest.status === 'complete').length
      if (done > completed) {
        completed = done
        const assassinView = viewFor(game, assassinSeat)
        const assassinBelief = beliefMerlinConfidence(assassinView, merlinSeat)
        const assassinPost = assassinPosteriorConfidence(assassinView, merlinSeat) ?? assassinBelief
        const servant = mean(servantSeats.map(
          (seat) => beliefMerlinConfidence(viewFor(game, seat), merlinSeat),
        ))
        record(done, servant, assassinBelief, assassinPost)
      }
    }
  }

  const byRound: RoundRace[] = [...rounds.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, bucket]): RoundRace => ({
      round,
      samples: bucket.total,
      servantBeliefConfidence: mean(bucket.servantBelief),
      assassinBeliefConfidence: mean(bucket.assassinBelief),
      assassinPosteriorConfidence: mean(bucket.assassinPosterior),
      assassinAheadRate: bucket.total ? bucket.assassinAhead / bucket.total : 0,
    }))
  const totalSamples = byRound.reduce((sum, entry) => sum + entry.samples, 0)
  const totalAhead = [...rounds.values()].reduce((sum, bucket) => sum + bucket.assassinAhead, 0)

  return {
    version: MERLIN_RACE_VERSION,
    games,
    playerCount,
    byRound,
    assassinAheadRate: totalSamples ? totalAhead / totalSamples : 0,
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const games = Number(process.argv[2] ?? 60)
  const playerCount = Number(process.argv[3] ?? 7)
  runMerlinRaceDiagnostic({ games, playerCount }).then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
}
