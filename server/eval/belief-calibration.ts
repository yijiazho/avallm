// Calibration metrics shared by uniform and weighted belief ablations.

import type { DatasetSplit } from './mechanical-data.ts'

export const BELIEF_CALIBRATION_SCHEMA = 1
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
  count: number
  meanProbability: number
  observedRate: number
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
  const brier = rows.reduce((sum, row) => {
    const observed = Number(row.observed)
    return sum + (row.probability - observed) ** 2
  }, 0) / rows.length
  const logLoss = -rows.reduce((sum, row) => {
    const probability = Math.min(
      1 - epsilon,
      Math.max(epsilon, row.probability),
    )
    return sum + (
      row.observed
        ? Math.log(probability)
        : Math.log(1 - probability)
    )
  }, 0) / rows.length
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
      count: selected.length,
      meanProbability:
        selected.reduce((sum, row) => sum + row.probability, 0)
        / selected.length,
      observedRate:
        selected.filter((row) => row.observed).length / selected.length,
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
