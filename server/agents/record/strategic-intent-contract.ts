import { hasDistinctSeats } from '../../engine/seatset.ts'
import type { Seat } from '../../engine/types.ts'
import {
  denseArray,
  onlyAllowedKeys,
  plainDataRecord,
} from '../canonical/canonical-shape.ts'
import {
  STRATEGIC_INTENT_HORIZONS,
  STRATEGIC_INTENT_VERSION,
  STRATEGIC_OBJECTIVE_CODES,
  type PublicEvidenceReference,
  type StrategicIntent,
  type StrategicIntentHorizon,
  type StrategicObjectiveCode,
} from './intent.ts'
import { validPublicEvidenceReferences } from './evidence-reference.ts'

export interface StrategicIntentContext {
  readonly seatExists?: (seat: Seat) => boolean
  readonly evidenceExists?: (reference: PublicEvidenceReference) => boolean
}

/** One shared admission contract for planner replies, live plans, and memory. */
export function validStrategicIntent(
  value: unknown,
  context: StrategicIntentContext = {},
): value is StrategicIntent {
  if (!plainDataRecord(value)) return false
  if (!onlyAllowedKeys(value, [
    'version', 'objective', 'targetSeats', 'horizon', 'evidenceRefs',
  ])) return false
  if (value.version !== STRATEGIC_INTENT_VERSION) return false
  if (!STRATEGIC_OBJECTIVE_CODES.includes(
    value.objective as StrategicObjectiveCode,
  )) return false
  if (
    !denseArray(value.targetSeats)
    || value.targetSeats.length > 10
    || !value.targetSeats.every((seat) =>
      Number.isSafeInteger(seat) && Number(seat) >= 0)
    || !hasDistinctSeats(value.targetSeats as readonly Seat[])
  ) return false
  if (
    context.seatExists
    && !(value.targetSeats as readonly Seat[]).every(context.seatExists)
  ) return false
  if (!STRATEGIC_INTENT_HORIZONS.includes(
    value.horizon as StrategicIntentHorizon,
  )) return false
  return validPublicEvidenceReferences(value.evidenceRefs, context)
}
