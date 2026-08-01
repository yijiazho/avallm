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
import { generateAssassinCalibrationViews } from './assassin-calibration.ts'
import { buildPrivateEvilSeatMerlinPosterior } from '../../agents/analysis/assassin-merlin-posterior.ts'
import { exactBelief } from '../../agents/belief/exact.ts'

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

export function runCoverEffectDiagnostic(
  options: { seedsPer?: number } = {},
): CoverEffectResult {
  const cases = generateAssassinCalibrationViews(options.seedsPer ?? 100)
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

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const seedsPer = Number(process.argv[2] ?? 100)
  console.log(JSON.stringify(runCoverEffectDiagnostic({ seedsPer }), null, 2))
}
