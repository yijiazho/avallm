// The cover effect: does the assassin miss the true Merlin more often when the
// top of its read is CROWDED (several seats look about equally Merlin-like)
// than when the true Merlin stands alone? This is the mechanical foundation of
// servant cover: servants don't need to out-identify the assassin, only to make
// Merlin one of several plausible Merlins so the shot is a guess. Cover here is
// behavioral (looking Merlin-like in play), never a role claim.
//
// Observational over the assassin's read at the assassination point: we do not
// inject a decoy policy, we bucket the natural variation in how crowded the
// assassin's top candidates are and read off its accuracy. It reuses the
// assassin-calibration views (heuristic self-play to assassination). API-free.

import { pathToFileURL } from 'node:url'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../engine/game.ts'
import { viewFor } from '../../engine/view.ts'
import { createAgent } from '../../agents/registry.ts'
import { generateAssassinCalibrationViews } from './assassin-calibration.ts'
import { buildPrivateEvilSeatMerlinPosterior } from '../../agents/analysis/assassin-merlin-posterior.ts'
import { exactBelief } from '../../agents/belief/exact.ts'
import type { AvalonAgent } from '../../agents/types.ts'
import type { PlayerView, Seat, TalkConfig } from '../../engine/types.ts'

const SILENT_TALK: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

interface AssassinationView {
  readonly view: PlayerView
  readonly merlinSeat: Seat
}

export const COVER_EFFECT_VERSION = 'cover-effect-v1'

/** A candidate counts as crowding the top if within this fraction of the max. */
const CROWD_FRACTION = 0.8

export interface DensitySlice {
  /** How many Merlin-candidates sit within CROWD_FRACTION of the top probability. */
  readonly decoyDensity: string
  readonly shots: number
  /** Fraction of these shots that would hit the true Merlin (argmax == Merlin). */
  readonly assassinHitRate: number
  /** Mean assassin-posterior probability on the true Merlin in these shots. */
  readonly meanTrueMerlinConfidence: number
}

export interface CoverEffectResult {
  readonly version: typeof COVER_EFFECT_VERSION
  readonly shots: number
  readonly meanDecoyDensity: number
  /** Hit-rate and confidence sliced by how crowded the assassin's top read is. */
  readonly byDecoyDensity: readonly DensitySlice[]
}

/** Score the crowdedness-vs-accuracy relationship over assassin shot views. */
function scoreCover(cases: readonly AssassinationView[]): CoverEffectResult {
  const buckets = new Map<string, { shots: number; hits: number; confidence: number }>()
  let densitySum = 0
  let shots = 0

  for (const { view, merlinSeat } of cases) {
    // Only the seat that actually takes the shot.
    if (view.role !== 'assassin') continue
    let targets
    try {
      targets = buildPrivateEvilSeatMerlinPosterior({
        view,
        belief: exactBelief(view),
      }).targets
    } catch {
      continue
    }
    if (!targets.length) continue

    const maxProbability = Math.max(
      ...targets.map((target) => target.posteriorProbability),
    )
    const decoyDensity = targets.filter(
      (target) => target.posteriorProbability >= CROWD_FRACTION * maxProbability,
    ).length
    let best = { seat: -1, probability: -1 }
    for (const target of targets) {
      if (
        target.posteriorProbability > best.probability
        || (target.posteriorProbability === best.probability && target.seat < best.seat)
      ) {
        best = { seat: target.seat, probability: target.posteriorProbability }
      }
    }
    const trueMerlinConfidence = targets.find(
      (target) => target.seat === merlinSeat,
    )?.posteriorProbability ?? 0

    const key = decoyDensity >= 3 ? '3+' : String(decoyDensity)
    const bucket = buckets.get(key) ?? { shots: 0, hits: 0, confidence: 0 }
    bucket.shots += 1
    if (best.seat === merlinSeat) bucket.hits += 1
    bucket.confidence += trueMerlinConfidence
    buckets.set(key, bucket)
    densitySum += decoyDensity
    shots += 1
  }

  const order = ['1', '2', '3+']
  const byDecoyDensity: DensitySlice[] = [...buckets.entries()]
    .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    .map(([decoyDensity, bucket]): DensitySlice => ({
      decoyDensity,
      shots: bucket.shots,
      assassinHitRate: bucket.hits / bucket.shots,
      meanTrueMerlinConfidence: bucket.confidence / bucket.shots,
    }))

  return {
    version: COVER_EFFECT_VERSION,
    shots,
    meanDecoyDensity: shots ? densitySum / shots : 0,
    byDecoyDensity,
  }
}

/** Heuristic self-play (forced-success to reach assassination), the noisy regime. */
export function runCoverEffectDiagnostic(
  options: { seedsPer?: number } = {},
): CoverEffectResult {
  return scoreCover(generateAssassinCalibrationViews(options.seedsPer ?? 100))
}

/**
 * Composed self-play to the assassination point: every seat the full-role
 * mechanical stack, quests played out naturally, the assassin's view captured
 * the moment before it shoots. Only good-winning games reach assassination, and
 * those are exactly the games where a shot is taken.
 */
async function generateComposedAssassinationViews(
  games: number,
  playerCount: number,
  seedBase: string,
): Promise<AssassinationView[]> {
  const out: AssassinationView[] = []
  for (let index = 0; index < games; index++) {
    const seed = `${seedBase}-${index}`
    const game = createGame({ seed, playerCount, talk: SILENT_TALK })
    const merlinSeat = game.players.find((p) => p.role === 'merlin')!.seat
    const assassinSeat = game.players.find((p) => p.role === 'assassin')?.seat
    if (assassinSeat === undefined) continue
    const agents = new Map<Seat, AvalonAgent>()
    for (const player of game.players) {
      agents.set(player.seat, createAgent({ type: 'composed', brain: 'full-role' }, { seed, seat: player.seat }))
    }
    let guard = 0
    while (
      game.phase !== 'assassination'
      && game.phase !== 'gameOver'
      && guard++ < 400
    ) {
      const reqs = expectedDecisions(game)
      if (!reqs.length) break
      for (const req of reqs) {
        const decision = (await agents.get(req.seat)!.decide(req, viewFor(game, req.seat))).decision
        applyDecision(game, req.seat, decision)
      }
    }
    if (game.phase === 'assassination') {
      out.push({ view: viewFor(game, assassinSeat), merlinSeat })
    }
  }
  return out
}

// Composed self-play, the clean regime. It does NOT collapse the top to a
// single candidate: measured mean density stays ~3.3 (vs ~3.9 heuristic), still
// mostly crowded. What composed play changes is the assassin's read SHARPNESS -
// it hits harder at every density (see role-scorecard memory) - not Merlin
// standing alone. The density->accuracy gradient itself holds in both regimes.
export async function runComposedCoverEffectDiagnostic(
  options: { games?: number; playerCount?: number; seedBase?: string } = {},
): Promise<CoverEffectResult> {
  return scoreCover(await generateComposedAssassinationViews(
    options.games ?? 60,
    options.playerCount ?? 7,
    options.seedBase ?? 'cover-effect-composed',
  ))
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const seedsPer = Number(process.argv[2] ?? 100)
  // Composed games are real agent playthroughs (slow); keep the default modest
  // and take its own arg rather than reusing the heuristic per-cast seed count.
  const composedGames = Number(process.argv[3] ?? 40)
  const heuristic = runCoverEffectDiagnostic({ seedsPer })
  runComposedCoverEffectDiagnostic({ games: composedGames }).then((composed) => {
    console.log(JSON.stringify({ heuristic, composed }, null, 2))
  })
}
