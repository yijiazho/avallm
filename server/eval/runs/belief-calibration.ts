// Calibration metrics shared by uniform and weighted belief ablations.

import { meanOf, rate } from '../core/statistics.ts'
import type { RateEstimate } from '../core/statistics.ts'
import type { DatasetSplit } from '../core/mechanical-data.ts'

// Schema 2 carries each reliability bin's observed frequency as a RateEstimate
// rather than a bare number, so the interval travels with the point. The metric
// definitions did not change, which is why the version string stays at v1: brier,
// log loss, and every bin's frequency compute exactly as they did.
export const BELIEF_CALIBRATION_SCHEMA = 2
export const BELIEF_CALIBRATION_VERSION = 'belief-calibration-v1'

export interface BeliefPredictionRow {
  id: string
  gameId: string
  populationId: string
  split: Extract<DatasetSplit, 'validation' | 'test'>
  target: 'player-evil' | 'team-clean'
  probability: number
  observed: boolean
}

export interface CalibrationBin {
  lower: number
  upper: number
  meanProbability: number
  /**
   * Observed frequency in this bin, with its Wilson interval. A reliability
   * curve bins by construction, so bins are small and a bare frequency oversells
   * its precision exactly where the curve is read most closely. `observed.trials`
   * is the bin size.
   */
  observed: RateEstimate
}

export interface CalibrationScore {
  rows: number
  brier: number | null
  logLoss: number | null
  curve: readonly CalibrationBin[]
}

export interface BeliefCalibrationReport {
  schema: typeof BELIEF_CALIBRATION_SCHEMA
  version: typeof BELIEF_CALIBRATION_VERSION
  overall: CalibrationScore
  byTarget: Readonly<Record<BeliefPredictionRow['target'], CalibrationScore>>
  byPopulation: Readonly<Record<string, CalibrationScore>>
}

function validateRows(rows: readonly BeliefPredictionRow[]): void {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) {
      throw new Error(`duplicate or empty calibration row id ${row.id}`)
    }
    ids.add(row.id)
    if (
      !Number.isFinite(row.probability)
      || row.probability < 0
      || row.probability > 1
    ) {
      throw new Error(`invalid calibration probability ${row.probability}`)
    }
  }
}

export function scoreCalibration(
  rows: readonly BeliefPredictionRow[],
  binCount = 10,
): CalibrationScore {
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new Error(`invalid calibration bin count ${binCount}`)
  }
  if (!rows.length) {
    return { rows: 0, brier: null, logLoss: null, curve: [] }
  }
  validateRows(rows)
  const epsilon = 1e-15
  // Both scores are means of a per-row term, so they say so. meanOf folds in
  // place rather than materializing the projection, and rows is non-empty by the
  // guard above. Negating the mean is the same value as negating the sum before
  // dividing: negation only flips the sign bit.
  const brier = meanOf(rows, (row) =>
    (row.probability - Number(row.observed)) ** 2)!
  const logLoss = -meanOf(rows, (row) => {
    const probability = Math.min(
      1 - epsilon,
      Math.max(epsilon, row.probability),
    )
    return row.observed
      ? Math.log(probability)
      : Math.log(1 - probability)
  })!
  const curve: CalibrationBin[] = []
  for (let index = 0; index < binCount; index++) {
    const selected = rows.filter((row) => {
      const bucket = Math.min(
        binCount - 1,
        Math.floor(row.probability * binCount),
      )
      return bucket === index
    })
    if (!selected.length) continue
    curve.push({
      lower: index / binCount,
      upper: (index + 1) / binCount,
      // Non-empty by the guard above, so the mean is never null here.
      meanProbability: meanOf(selected, (row) => row.probability)!,
      observed: rate(
        selected.filter((row) => row.observed).length,
        selected.length,
      ),
    })
  }
  return { rows: rows.length, brier, logLoss, curve }
}

export function beliefCalibrationReport(
  rows: readonly BeliefPredictionRow[],
): BeliefCalibrationReport {
  validateRows(rows)
  const populations = [...new Set(
    rows.map((row) => row.populationId),
  )].sort()
  return {
    schema: BELIEF_CALIBRATION_SCHEMA,
    version: BELIEF_CALIBRATION_VERSION,
    overall: scoreCalibration(rows),
    byTarget: {
      'player-evil': scoreCalibration(
        rows.filter((row) => row.target === 'player-evil'),
      ),
      'team-clean': scoreCalibration(
        rows.filter((row) => row.target === 'team-clean'),
      ),
    },
    byPopulation: Object.fromEntries(
      populations.map((population) => [
        population,
        scoreCalibration(
          rows.filter((row) => row.populationId === population),
        ),
      ]),
    ),
  }
}

export interface PairedCalibrationDelta {
  rows: number
  brier: number
  logLoss: number
}

export function pairedCalibrationDelta(
  baseline: readonly BeliefPredictionRow[],
  candidate: readonly BeliefPredictionRow[],
): PairedCalibrationDelta {
  validateRows(baseline)
  validateRows(candidate)
  const baselineIds = baseline.map((row) => row.id).sort()
  const candidateIds = candidate.map((row) => row.id).sort()
  if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) {
    throw new Error('calibration comparison requires identical held-out rows')
  }
  if (!baseline.length) {
    throw new Error('calibration comparison requires at least one held-out row')
  }
  const baselineScore = scoreCalibration(baseline)
  const candidateScore = scoreCalibration(candidate)
  return {
    rows: baseline.length,
    brier: candidateScore.brier! - baselineScore.brier!,
    logLoss: candidateScore.logLoss! - baselineScore.logLoss!,
  }
}
