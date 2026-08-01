/**
 * A counted public observation and its derived ratio.
 *
 * Evil standing, counterfeit truth tracking, and actor-target treatment all
 * expose the same semantic value: integer hits over integer observations, with
 * `null` meaning that no observation exists. This module owns that shape and
 * its arithmetic so the three projections cannot disagree about the zero-data
 * case or about ratio validation. Contextual bounds remain with the caller and
 * enter through `maxDenominator`.
 */

import {
  exactKeys,
  plainDataRecord,
  probability,
} from '../canonical/canonical-shape.ts'
import { closeProbability } from '../canonical/probability-arithmetic.ts'

export interface ObservationFraction {
  numerator: number
  denominator: number
  /** Missing means no public observations, never an innocent default. */
  index: number | null
}

export function observationFraction(
  numerator: number,
  denominator: number,
): ObservationFraction {
  return {
    numerator,
    denominator,
    index: denominator === 0 ? null : numerator / denominator,
  }
}

export function validObservationFraction(
  value: unknown,
  options: { maxDenominator?: number } = {},
): value is ObservationFraction {
  if (
    !plainDataRecord(value)
    || !exactKeys(value, ['numerator', 'denominator', 'index'])
    || !Number.isSafeInteger(value.numerator)
    || !Number.isSafeInteger(value.denominator)
    || (value.numerator as number) < 0
    || (value.denominator as number) < (value.numerator as number)
    || (
      options.maxDenominator !== undefined
      && (value.denominator as number) > options.maxDenominator
    )
  ) return false
  return value.denominator === 0
    ? value.numerator === 0 && value.index === null
    : probability(value.index)
      && closeProbability(
        value.index,
        (value.numerator as number) / (value.denominator as number),
      )
}
