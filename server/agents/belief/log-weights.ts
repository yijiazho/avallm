// Where the belief layer attaches log-sum-exp masses to hidden worlds.
//
// The arithmetic itself lives in canonical/probability-arithmetic.ts with the
// rest of the shared numeric helpers. What stays here is the part that knows
// about worlds, which is only the zip.

import { logWeightsToProbabilities } from '../canonical/probability-arithmetic.ts'
import type { HiddenWorld, WeightedWorld } from './types.ts'

/** Stable log-sum-exp normalization over feasible worlds only. */
export function normalizeLogWeights(
  worlds: readonly HiddenWorld[],
  logWeights: readonly number[],
): readonly WeightedWorld[] {
  if (!worlds.length || worlds.length !== logWeights.length) {
    throw new Error('log-weight normalization requires one weight per world')
  }
  const probabilities = logWeightsToProbabilities(logWeights)
  return worlds.map((world, index) => ({
    world,
    probability: probabilities[index]!,
  }))
}
