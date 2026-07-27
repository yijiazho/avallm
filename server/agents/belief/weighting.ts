import type { HiddenWorld, WeightedWorld } from './types.ts'

export interface CappedLogLikelihood {
  value: number
  capped: boolean
}

export function capLogLikelihood(
  value: number,
  absoluteCap: number,
): CappedLogLikelihood {
  if (!Number.isFinite(value)) {
    throw new Error(`log likelihood must be finite, got ${value}`)
  }
  if (!Number.isFinite(absoluteCap) || absoluteCap <= 0) {
    throw new Error(`log likelihood cap must be positive, got ${absoluteCap}`)
  }
  const bounded = Math.max(-absoluteCap, Math.min(absoluteCap, value))
  return { value: bounded, capped: bounded !== value }
}

/** Stable log-sum-exp normalization over feasible worlds only. */
export function normalizeLogWeights(
  worlds: readonly HiddenWorld[],
  logWeights: readonly number[],
): readonly WeightedWorld[] {
  if (!worlds.length || worlds.length !== logWeights.length) {
    throw new Error('log-weight normalization requires one weight per world')
  }
  if (logWeights.some((weight) => !Number.isFinite(weight))) {
    throw new Error('log-weight normalization requires finite weights')
  }
  const maximum = Math.max(...logWeights)
  const relative = logWeights.map((weight) => Math.exp(weight - maximum))
  const total = relative.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('log-weight normalization produced invalid total weight')
  }
  return worlds.map((world, index) => ({
    world,
    probability: relative[index] / total,
  }))
}
