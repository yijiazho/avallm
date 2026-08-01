import {
  denseArray,
  probability,
} from '../canonical/canonical-shape.ts'
import { closeProbability } from '../canonical/probability-arithmetic.ts'

/** A dense normalized probability distribution over counts 0..maximumCount. */
export function validCountDistribution(
  value: unknown,
  maximumCount: number,
): value is number[] {
  return denseArray(value)
    && value.length === maximumCount + 1
    && value.every(probability)
    && closeProbability(
      value.reduce((sum, mass) => sum + (mass as number), 0),
      1,
    )
}
