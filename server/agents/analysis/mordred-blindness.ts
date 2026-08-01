/**
 * Stable public surface for the private Mordred-blindness component.
 *
 * Trusted calculation lives in mordred-blindness-calculation.ts. Hostile and
 * canonical decoding live in mordred-blindness-codec.ts. Exact host admission
 * joins those responsibilities here, which keeps both companions acyclic and
 * avoids coupling callers to the internal split.
 */
import {
  buildPrivateMordredBlindnessObjective,
  type MordredBlindnessObjectiveInput,
} from './mordred-blindness-calculation.ts'
import type {
  PrivateMordredBlindnessObjective,
} from './mordred-blindness-types.ts'
import {
  validatePrivateMordredBlindnessObjective,
} from './mordred-blindness-codec.ts'
import { exactHostJoin } from './projection-codec.ts'

export {
  buildPrivateMordredBlindnessObjective,
  type MordredBlindnessObjectiveInput,
}
export {
  decodeCanonicalPrivateMordredBlindnessObjective,
  validatePrivateMordredBlindnessObjective,
} from './mordred-blindness-codec.ts'

export const validateAdmittedPrivateMordredBlindnessHostJoin =
  exactHostJoin(buildPrivateMordredBlindnessObjective)

export function validatePrivateMordredBlindnessHostJoin(
  value: unknown,
  input: MordredBlindnessObjectiveInput,
): value is PrivateMordredBlindnessObjective {
  return validatePrivateMordredBlindnessObjective(value)
    && validateAdmittedPrivateMordredBlindnessHostJoin(value, input)
}
