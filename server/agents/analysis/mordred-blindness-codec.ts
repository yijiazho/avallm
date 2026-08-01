import { isDeepStrictEqual } from 'node:util'
import { TEAM_SIZES } from '../../engine/rules.ts'
import type { Role, Seat } from '../../engine/types.ts'
import {
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
  type CanonicalJsonValue,
} from '../canonical/canonical-json.ts'
import {
  canonicalCombinations,
  canonicalRequestBlock,
  canonicalRoles,
  canonicalSeats,
  denseArray,
  exactKeys,
  plainDetachedData,
  plainRecord,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  closeProbability as close,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './observer-types.ts'
import {
  ACTOR_TARGET_TREATMENT_READ_VERSION,
} from './actor-target-treatment-types.ts'
import {
  MAX_MORDRED_BLINDNESS_ASSESSMENTS,
  MORDRED_BLINDNESS_OBJECTIVE_VERSION,
  type PrivateMordredBlindnessObjective,
} from './mordred-blindness-types.ts'
import {
  mordredOpportunityValue,
} from './mordred-blindness-calculation.ts'
import { validCountDistribution } from './count-distribution.ts'

interface SemanticContext {
  source: Record<string, unknown>
  request: Record<string, unknown>
  playerCount: number
  teamSize: number
}

/**
 * The shared canonical-roles guard plus the cast this module presumes: without
 * a mordred there is no blindness to reason about, and without a merlin there
 * is nothing to be blind to.
 */
function canonicalRolesWithMordredAndMerlin(
  value: unknown,
  playerCount: number,
): value is Role[] {
  return canonicalRoles(value, playerCount)
    && value.includes('mordred')
    && value.includes('merlin')
}

function validateEnvelope(
  value: unknown,
  detached: boolean,
): SemanticContext | undefined {
  if (
    (detached && !plainDetachedData(value))
    || !plainRecord(value)
    || !exactKeys(value, [
      'version',
      'role',
      'source',
      'request',
      'merlinHypotheses',
      'assessments',
    ])
    || value.version !== MORDRED_BLINDNESS_OBJECTIVE_VERSION
    || value.role !== 'mordred'
    || !plainRecord(value.source)
    || !plainRecord(value.request)
    || (
      detached
      && Buffer.byteLength(JSON.stringify(value), 'utf8')
        > DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES
    )
  ) return undefined
  const source = value.source
  const request = value.request
  if (
    !exactKeys(source, [
      'beliefModelVersion',
      'beliefThroughSeq',
      'beliefQuality',
      'playerCount',
      'rolesInPlay',
      'treatmentReadVersion',
      'observerModelVersion',
      'observerFeasibleWorldCount',
      'worldSemantics',
      'promotionSemantics',
    ])
    || typeof source.beliefModelVersion !== 'string'
    || !source.beliefModelVersion.length
    || source.beliefModelVersion.length > 200
    || !Number.isSafeInteger(source.beliefThroughSeq)
    || (source.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      String(source.beliefQuality),
    )
    || !tableSize(source.playerCount)
    || !canonicalRolesWithMordredAndMerlin(
      source.rolesInPlay,
      source.playerCount as number,
    )
    || source.treatmentReadVersion
      !== ACTOR_TARGET_TREATMENT_READ_VERSION
    || source.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !Number.isSafeInteger(source.observerFeasibleWorldCount)
    || (source.observerFeasibleWorldCount as number) <= 0
    || source.worldSemantics !== 'resolved-weighted-complete-worlds'
    || source.promotionSemantics
      !== 'constraints-only-exact-weighted-structural'
    || !canonicalRequestBlock(request, {
      playerCount: source.playerCount as number,
      kinds: ['propose', 'vote'],
      voteCurrentTeam: true,
    })
  ) return undefined
  const playerCount = source.playerCount as number
  const teamSize = TEAM_SIZES[playerCount]?.[(request.round as number) - 1]
  if (
    !Number.isSafeInteger(teamSize)
    || !denseArray(value.merlinHypotheses)
    || value.merlinHypotheses.length !== playerCount - 1
    || !denseArray(value.assessments)
    || value.assessments.length > MAX_MORDRED_BLINDNESS_ASSESSMENTS
  ) return undefined
  return {
    source,
    request,
    playerCount,
    teamSize: teamSize as number,
  }
}

function validateMerlinHypotheses(
  value: unknown,
  context: SemanticContext,
): boolean {
  if (!plainRecord(value) || !denseArray(value.merlinHypotheses)) {
    return false
  }
  let totalWorldMass = 0
  let previousSeat = -1
  for (const raw of value.merlinHypotheses) {
    if (
      !plainRecord(raw)
      || !exactKeys(raw, [
        'seat',
        'hypothesisSemantics',
        'worldMass',
        'observationCoverageMass',
        'anomalousTreatmentMass',
        'conditionalAnomalousTreatmentIndex',
      ])
      || !Number.isSafeInteger(raw.seat)
      || (raw.seat as number) <= previousSeat
      || (raw.seat as number) >= context.playerCount
      || raw.seat === context.request.seat
      || raw.hypothesisSemantics
        !== 'legal-world-merlin-coordinate-not-privileged-identity'
      || !probability(raw.worldMass)
      || !probability(raw.observationCoverageMass)
      || !probability(raw.anomalousTreatmentMass)
      || (raw.observationCoverageMass as number)
        > (raw.worldMass as number) + PROBABILITY_TOLERANCE
      || (raw.anomalousTreatmentMass as number)
        > (raw.observationCoverageMass as number) + PROBABILITY_TOLERANCE
      || (
        raw.observationCoverageMass === 0
          ? (
              raw.anomalousTreatmentMass !== 0
              || raw.conditionalAnomalousTreatmentIndex !== null
            )
          : (
              !probability(raw.conditionalAnomalousTreatmentIndex)
              || !close(
                raw.conditionalAnomalousTreatmentIndex as number,
                (raw.anomalousTreatmentMass as number)
                  / (raw.observationCoverageMass as number),
              )
            )
      )
    ) return false
    previousSeat = raw.seat as number
    totalWorldMass += raw.worldMass as number
  }
  return close(totalWorldMass, 1)
}

function validateAssessment(
  raw: unknown,
  context: SemanticContext,
  ids: Set<string>,
): boolean {
  if (
    !plainRecord(raw)
    || !exactKeys(raw, [
      'team',
      'probabilitySemantics',
      'jointSemantics',
      'visibleEvilCountDistribution',
      'totalEvilCountDistribution',
      'merlinBlindWindowProbability',
      'hiddenThresholdCrossingProbability',
      'treatmentObservationAvailable',
      'anomalousBlindWindowMass',
      'observationSemantics',
      'policySemantics',
      'opportunityValueSemantics',
      'opportunityValue',
    ])
    || !plainRecord(raw.team)
  ) return false
  const team = raw.team
  if (
    !exactKeys(team, [
      'teamId',
      'requestContext',
      'seats',
    ])
    || typeof team.teamId !== 'string'
    || !team.teamId.length
    || team.teamId.length > 256
    || ids.has(team.teamId)
    || team.requestContext !== context.request.kind
    || !canonicalSeats(team.seats, context.playerCount)
    || team.seats.length !== context.teamSize
  ) return false
  const seats = team.seats as Seat[]
  const expectedId = `team:${seats.join(',')}`
  if (
    team.teamId !== expectedId
    || (
      team.requestContext === 'vote'
      && !isDeepStrictEqual(team.seats, context.request.currentTeam)
    )
    || raw.probabilitySemantics
      !== 'resolved-complete-world-joint-sums'
    || raw.jointSemantics
      !== 'direct-joint-world-sums-no-marginal-products'
    || !validCountDistribution(raw.visibleEvilCountDistribution, seats.length)
    || !validCountDistribution(raw.totalEvilCountDistribution, seats.length)
    || !probability(raw.merlinBlindWindowProbability)
    || !probability(raw.hiddenThresholdCrossingProbability)
    || (raw.hiddenThresholdCrossingProbability as number)
      > (raw.merlinBlindWindowProbability as number)
        + PROBABILITY_TOLERANCE
    || typeof raw.treatmentObservationAvailable !== 'boolean'
    || !probability(raw.anomalousBlindWindowMass)
    || (raw.anomalousBlindWindowMass as number)
      > (raw.merlinBlindWindowProbability as number)
        + PROBABILITY_TOLERANCE
    || (
      !raw.treatmentObservationAvailable
      && raw.anomalousBlindWindowMass !== 0
    )
    || raw.observationSemantics
      !== 'no-public-observation-is-zero-signal-not-innocence'
    || raw.policySemantics !== 'team-opportunity-not-action-utility'
    || raw.opportunityValueSemantics
      !== 'bounded-heuristic-nonprobability-three-quarters-hidden-crossing-one-quarter-anomalous-window'
    || !probability(raw.opportunityValue)
    || !close(
      raw.opportunityValue as number,
      mordredOpportunityValue(
        raw.hiddenThresholdCrossingProbability as number,
        raw.anomalousBlindWindowMass as number,
      ),
    )
  ) return false
  ids.add(team.teamId)
  return true
}

function validateAssessmentSurface(
  value: unknown,
  context: SemanticContext,
): boolean {
  if (!plainRecord(value) || !denseArray(value.assessments)) return false
  const ids = new Set<string>()
  if (
    value.assessments.some(
      (raw) => !validateAssessment(raw, context, ids),
    )
  ) return false
  const expectedIds = context.request.kind === 'vote'
    ? [`team:${(context.request.currentTeam as Seat[]).join(',')}`]
    : canonicalCombinations(context.playerCount, context.teamSize).map(
        (team) => `team:${team.join(',')}`,
      )
  return ids.size === expectedIds.length
    && expectedIds.every((id) => ids.has(id))
}

function validatePrivateMordredBlindnessSemantics(
  value: unknown,
  detached: boolean,
): value is PrivateMordredBlindnessObjective {
  try {
    const context = validateEnvelope(value, detached)
    return context !== undefined
      && validateMerlinHypotheses(value, context)
      && validateAssessmentSurface(value, context)
  } catch {
    return false
  }
}

export function validatePrivateMordredBlindnessObjective(
  value: unknown,
): value is PrivateMordredBlindnessObjective {
  return validatePrivateMordredBlindnessSemantics(value, true)
}

/**
 * Decode a value already canonicalized and byte-bounded by the component
 * kernel. Only the component's semantic schema is checked here.
 */
export function decodeCanonicalPrivateMordredBlindnessObjective(
  value: CanonicalJsonValue,
): PrivateMordredBlindnessObjective | undefined {
  return validatePrivateMordredBlindnessSemantics(value, false)
    ? value
    : undefined
}
