// Large deterministic held-out calibration of the assassin Merlin posterior.
//
// This complements the curated virtual-assassin fixture. That fixture pins a
// few named scenarios as a byte-exact regression; this generates a broad,
// higher-powered held-out set to MEASURE calibration (hit-rate / Brier /
// log-loss) and to gate behavioral-overlay changes on evidence rather than
// anecdote. It is the harness behind the step-3 decision in
// docs/design-perception-primitive.md: the bespoke overlay lifts hit-rate ~14
// points over the raw prior, and a matrix-sourced steelman regressed, so the
// bespoke overlay was kept. Re-run scoreAssassinCalibration with an alternative
// builder to reopen that question.
//
// Determinism: games are played to the pre-assassination point with
// heuristic-driven proposals (so leadership and team choices carry real
// Merlin-informed signal) and forced approve/success, mirroring the
// virtual-assassin replay. Everything is seeded; there is no clock or ambient
// randomness, so the metrics are reproducible.

import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../engine/game.ts'
import { viewFor } from '../../engine/view.ts'
import { heuristicDecide } from '../../agents/heuristic.ts'
import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import { buildPrivateEvilSeatMerlinPosterior } from '../../agents/analysis/assassin-merlin-posterior.ts'
import { exactBelief } from '../../agents/belief/exact.ts'
import type { PlayerView, Role, Seat } from '../../engine/types.ts'

export interface AssassinCalibrationCast {
  readonly playerCount: number
  readonly roles: readonly Role[]
}

/** Canonical casts, one legal role set per player count, each with Merlin. */
export const ASSASSIN_CALIBRATION_CASTS: readonly AssassinCalibrationCast[] =
  Object.freeze([
    { playerCount: 5, roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'] },
    { playerCount: 7, roles: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'oberon', 'assassin'] },
    { playerCount: 9, roles: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'mordred', 'morgana', 'assassin'] },
    { playerCount: 10, roles: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'mordred', 'morgana', 'oberon', 'assassin'] },
  ].map((cast) => Object.freeze({
    playerCount: cast.playerCount,
    roles: Object.freeze([...cast.roles] as Role[]),
  })))

export const ASSASSIN_CALIBRATION_SEEDS_PER = 100

export interface AssassinCalibrationView {
  readonly view: PlayerView
  readonly merlinSeat: Seat
}

/** One Merlin-candidate probability from a posterior under test. */
export interface MerlinTargetProbability {
  readonly seat: Seat
  readonly probability: number
}

/**
 * Produce a Merlin posterior over candidate seats from an evil-seat view. The
 * production builder and the prior-only baseline both fit this shape, and so
 * would any overlay variant under evaluation.
 */
export type MerlinPosteriorBuilder =
  (view: PlayerView) => readonly MerlinTargetProbability[]

export interface AssassinCalibrationMetrics {
  readonly predictions: number
  readonly hitRate: number
  readonly meanBrier: number
  readonly meanLogLoss: number
}

function playToAssassination(
  seed: string,
  cast: AssassinCalibrationCast,
) {
  const game = createGame({
    seed,
    playerCount: cast.playerCount,
    roles: [...cast.roles],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  let guard = 0
  while (game.phase !== 'assassination' && guard++ < 40) {
    const reqs = expectedDecisions(game)
    if (!reqs.length) return undefined
    const req = reqs[0]
    if (req.kind === 'vote') {
      for (const vote of reqs) {
        applyDecision(game, vote.seat, { kind: 'vote', vote: 'approve' })
      }
    } else if (req.kind === 'quest') {
      applyDecision(game, req.seat, { kind: 'quest', card: 'success' })
    } else if (req.kind === 'finalize') {
      applyDecision(game, req.seat, { kind: 'finalize', stick: true })
    } else {
      applyDecision(game, req.seat, heuristicDecide(req, viewFor(game, req.seat), seed))
    }
  }
  return game.phase === 'assassination' ? game : undefined
}

/**
 * The held-out evaluation views: every evil seat's pre-assassination view across
 * the casts and seeds, paired with that game's true Merlin seat. Deterministic.
 */
export function generateAssassinCalibrationViews(
  seedsPer: number = ASSASSIN_CALIBRATION_SEEDS_PER,
): readonly AssassinCalibrationView[] {
  const out: AssassinCalibrationView[] = []
  for (const cast of ASSASSIN_CALIBRATION_CASTS) {
    for (let seed = 0; seed < seedsPer; seed++) {
      const game = playToAssassination(`assassin-cal-${cast.playerCount}-${seed}`, cast)
      if (!game) continue
      const merlinSeat = game.players.find((player) => player.role === 'merlin')!.seat
      for (const player of game.players) {
        if (ROLE_ALIGNMENT[player.role] !== 'evil') continue
        out.push({ view: viewFor(game, player.seat), merlinSeat })
      }
    }
  }
  return out
}

const LOG_LOSS_EPSILON = 1e-12

/**
 * Score a posterior builder over an already-generated held-out set. hit-rate is
 * argmax accuracy (ties broken to the lower seat, matching the shot's
 * tie-break); Brier is the multiclass sum over targets; log-loss is on the true
 * Merlin seat's mass.
 *
 * Generation is separate from scoring so a caller comparing several builders
 * generates the set once and scores each on the SAME cases: replaying the games
 * is the cost, and shared cases make the metrics comparable denominator-for-
 * denominator rather than each builder scoring whatever it happened not to skip.
 */
export function scoreMerlinPosterior(
  cases: readonly AssassinCalibrationView[],
  builder: MerlinPosteriorBuilder,
): AssassinCalibrationMetrics {
  let hits = 0
  let brierSum = 0
  let logLossSum = 0
  let predictions = 0
  for (const { view, merlinSeat } of cases) {
    const targets = builder(view)
    if (!targets.length) continue
    predictions += 1
    let brier = 0
    let merlinProbability = 0
    let best = { seat: -1, probability: -1 }
    for (const target of targets) {
      const truth = target.seat === merlinSeat ? 1 : 0
      brier += (target.probability - truth) ** 2
      if (target.seat === merlinSeat) merlinProbability = target.probability
      if (
        target.probability > best.probability
        || (target.probability === best.probability && target.seat < best.seat)
      ) {
        best = { seat: target.seat, probability: target.probability }
      }
    }
    if (best.seat === merlinSeat) hits += 1
    brierSum += brier
    logLossSum += -Math.log(Math.max(merlinProbability, LOG_LOSS_EPSILON))
  }
  if (predictions === 0) {
    throw new Error('assassin calibration scored no predictions')
  }
  return {
    predictions,
    hitRate: hits / predictions,
    meanBrier: brierSum / predictions,
    meanLogLoss: logLossSum / predictions,
  }
}

/** Generate the held-out set once, then score one builder on it. */
export function scoreAssassinCalibration(
  builder: MerlinPosteriorBuilder,
  seedsPer: number = ASSASSIN_CALIBRATION_SEEDS_PER,
): AssassinCalibrationMetrics {
  return scoreMerlinPosterior(generateAssassinCalibrationViews(seedsPer), builder)
}

/** The production posterior: full prior x behavioral overlay. */
export const productionMerlinPosterior: MerlinPosteriorBuilder = (view) =>
  buildPrivateEvilSeatMerlinPosterior({ view, belief: exactBelief(view) }).targets
    .map((target) => ({ seat: target.seat, probability: target.posteriorProbability }))

/** Convenience: the production posterior's calibration on the full held-out set. */
export function runAssassinCalibration(): AssassinCalibrationMetrics {
  return scoreAssassinCalibration(productionMerlinPosterior)
}
