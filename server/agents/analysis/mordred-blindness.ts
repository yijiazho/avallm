import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../../engine/types.ts'
import { ROLE_ALIGNMENT, TEAM_SIZES } from '../../engine/rules.ts'
import { canonicalTeam, hasDistinctSeats } from '../../engine/seatset.ts'
import { worldSatisfiesView } from '../belief/constraints.ts'
import { visibleEventCursor } from '../belief/exact.ts'
import type {
  BeliefSnapshot,
  WeightedWorld,
} from '../belief/types.ts'
import {
  canonicalRoleMultiset,
  canonicalWorldKey,
} from '../belief/worlds.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from './observer-types.ts'
import type {
  ActorTargetTreatmentFraction,
  ActorTargetTreatmentRow,
  PrivateActorTargetTreatmentRead,
} from './actor-target-treatment-types.ts'
import {
  ACTOR_TARGET_TREATMENT_READ_VERSION,
} from './actor-target-treatment-types.ts'
import {
  MAX_MORDRED_BLINDNESS_ASSESSMENTS,
  MORDRED_BLINDNESS_OBJECTIVE_VERSION,
  type MordredBlindnessAssessment,
  type MordredMerlinHypothesis,
  type MordredBlindnessTeam,
  type PrivateMordredBlindnessObjective,
} from './mordred-blindness-types.ts'
import {
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
  type CanonicalJsonValue,
} from '../components/canonical-json.ts'
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
} from '../components/canonical-shape.ts'
import {
  clampProbability,
  closeProbability as close,
  PROBABILITY_TOLERANCE,
  stableProbabilitySum,
} from '../components/probability-arithmetic.ts'
import {
  accumulateSubjectMass,
  conditionalOverlayIndex,
  EMPTY_SUBJECT_MASS,
} from './perception-asymmetry.ts'

function matrixIndex(
  playerCount: number,
  actor: Seat,
  target: Seat,
): number {
  return actor * playerCount + target
}

function channelAnomaly(
  self: ActorTargetTreatmentFraction,
  visible: readonly ActorTargetTreatmentFraction[],
): { delta: number; weight: number } {
  const numerator = visible.reduce(
    (sum, entry) => sum + entry.numerator,
    0,
  )
  const denominator = visible.reduce(
    (sum, entry) => sum + entry.denominator,
    0,
  )
  if (self.denominator === 0 || denominator === 0) {
    return { delta: 0, weight: 0 }
  }
  return {
    delta: Math.max(
      0,
      self.numerator / self.denominator - numerator / denominator,
    ),
    weight: Math.min(self.denominator, denominator),
  }
}

function worldAnomaly(
  read: PrivateActorTargetTreatmentRead,
  merlin: Seat,
  mordred: Seat,
  visibleEvil: readonly Seat[],
): { available: boolean; index: number } {
  const row = (target: Seat): ActorTargetTreatmentRow =>
    read.rows[matrixIndex(read.playerCount, merlin, target)]
  const proposal = channelAnomaly(
    row(mordred).proposalSelection,
    visibleEvil.map((seat) => row(seat).proposalSelection),
  )
  const vote = channelAnomaly(
    row(mordred).voteApproval,
    visibleEvil.map((seat) => row(seat).voteApproval),
  )
  const weight = proposal.weight + vote.weight
  return {
    available: weight > 0,
    index: weight === 0
      ? 0
      : (
          proposal.delta * proposal.weight
          + vote.delta * vote.weight
        ) / weight,
  }
}

function validateBeliefForMordred(
  belief: BeliefSnapshot,
  view: PlayerView,
): readonly WeightedWorld[] {
  const cast = canonicalRoleMultiset(view.rolesInPlay)
  const keys = new Set<string>()
  if (
    !belief
    || typeof belief.modelVersion !== 'string'
    || !belief.modelVersion.length
    || belief.throughSeq !== visibleEventCursor(view)
    || !['constraints-only', 'weighted', 'degraded'].includes(belief.quality)
    || !belief.worlds.length
    || belief.worlds.some((weighted) => {
      const roles = weighted.world.roleBySeat
      const alignments = weighted.world.alignmentBySeat
      const duplicate = keys.has(weighted.world.key)
      keys.add(weighted.world.key)
      return (
        roles.length !== view.playerCount
        || alignments.length !== view.playerCount
        || roles[view.seat] !== 'mordred'
        || !isDeepStrictEqual(canonicalRoleMultiset(roles), cast)
        || weighted.world.key !== canonicalWorldKey(roles)
        || duplicate
        || roles.some(
          (role, seat) => ROLE_ALIGNMENT[role] !== alignments[seat],
        )
        || !probability(weighted.probability)
        || weighted.probability === 0
        || !worldSatisfiesView(view, weighted.world, {
          questRecord: 'all',
        })
      )
    })
    // Compensated, like every other world total this tree compares at the
    // strict tolerance. A Mordred view leaves at most 420 feasible worlds, so
    // `reduce` also passed here, but that bound is a fact about what one seat's
    // partner knowledge rules out, not about this line. The same expression
    // over a servant's 60,480 worlds lands 1.6e-12 from 1 and rejects a correct
    // belief.
    || !close(
      stableProbabilitySum(belief.worlds, (weighted) => weighted.probability),
      1,
    )
    || (
      belief.quality === 'constraints-only'
      && belief.worlds.some(
        (weighted) =>
          !close(
            weighted.probability,
            belief.worlds[0].probability,
          ),
      )
    )
  ) {
    throw new Error('Mordred objective requires legal Mordred-bound worlds')
  }
  return [...belief.worlds].sort(
    (left, right) => left.world.key.localeCompare(
      right.world.key,
      'en',
    ),
  )
}

function candidateTeam(
  candidate: PolicyCandidate,
  view: PlayerView,
): MordredBlindnessTeam | undefined {
  if (candidate.decision.kind === 'propose') {
    const seats = canonicalTeam(candidate.decision.team)
    return {
      teamId: `team:${seats.join(',')}`,
      requestContext: 'propose',
      seats,
    }
  }
  if (candidate.decision.kind === 'vote' && view.currentTeam) {
    const seats = canonicalTeam(view.currentTeam)
    return {
      teamId: `team:${seats.join(',')}`,
      requestContext: 'vote',
      seats,
    }
  }
  return undefined
}

export function buildPrivateMordredBlindnessObjective(input: {
  req: DecisionRequest
  view: PlayerView
  belief: BeliefSnapshot
  treatment: PrivateActorTargetTreatmentRead
  candidates: readonly PolicyCandidate[]
}): PrivateMordredBlindnessObjective {
  const {
    req,
    view,
    belief,
    treatment,
    candidates,
  } = input
  if (req.kind !== 'propose' && req.kind !== 'vote') {
    throw new Error('Mordred objective is inapplicable')
  }
  if (
    view.role !== 'mordred'
    || req.seat !== view.seat
    || req.round !== view.round
    || req.proposalNum !== view.proposalNum
    || view.phase !== (req.kind === 'propose' ? 'proposal' : 'vote')
    || candidates.length > MAX_MORDRED_BLINDNESS_ASSESSMENTS
  ) {
    throw new Error('Mordred objective is inapplicable')
  }
  const requestKind: 'propose' | 'vote' = req.kind
  const worlds = validateBeliefForMordred(belief, view)
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  const teamSize = TEAM_SIZES[view.playerCount]?.[view.round - 1]
  const currentTeam = req.kind === 'vote'
    ? view.currentTeam && canonicalTeam(view.currentTeam)
    : undefined
  if (
    ![1, 2].includes(failsRequired)
    || !Number.isSafeInteger(teamSize)
    || (
      req.kind === 'vote'
      && (
        !currentTeam
        || currentTeam.length !== teamSize
        || !hasDistinctSeats(currentTeam)
      )
    )
  ) {
    throw new Error('Mordred objective requires legal team threshold')
  }
  const candidateTeams = candidates
    .map((candidate) => candidateTeam(candidate, view))
    .filter(
      (candidate): candidate is MordredBlindnessTeam =>
        candidate !== undefined,
    )
  const commitments = [
    ...new Map(
      candidateTeams.map((candidate) => [candidate.teamId, candidate]),
    ).values(),
  ]
  if (
    candidateTeams.length !== candidates.length
    || commitments.length !== (
      req.kind === 'vote' ? 1 : candidates.length
    )
  ) {
    throw new Error('Mordred objective requires canonical candidates')
  }

  const worldRows = worlds.map((weighted) => {
    const merlin = weighted.world.roleBySeat.indexOf('merlin')
    if (merlin < 0) {
      throw new Error('Mordred objective requires Merlin in every world')
    }
    const visibleEvil = weighted.world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(
        ({ role }) =>
          ROLE_ALIGNMENT[role] === 'evil' && role !== 'mordred',
      )
      .map(({ seat }) => seat)
    const totalEvil = weighted.world.alignmentBySeat
      .map((alignment, seat) => ({ alignment, seat }))
      .filter(({ alignment }) => alignment === 'evil')
      .map(({ seat }) => seat)
    return {
      probability: weighted.probability,
      merlin,
      visibleEvil,
      totalEvil,
      anomaly: worldAnomaly(
        treatment,
        merlin,
        view.seat,
        visibleEvil,
      ),
    }
  })

  // The private complete-world mass per Merlin-hypothesis seat, split by the
  // treatment overlay, is the shared perception-asymmetry accumulation: the
  // subject is the Merlin coordinate, the overlay is this world's anomaly
  // sample. worldMass/observationCoverageMass/anomalousTreatmentMass are the
  // primitive's mass/overlayAvailableMass/overlayWeightedMass, and the
  // conditional index is its guarded ratio; clamping stays here with the
  // payload. The reducer folds worldRows in order, so the sums are identical to
  // the loop this replaces.
  const hypothesisTotals = accumulateSubjectMass(
    worldRows,
    (world) => world.merlin,
    (world) => world.probability,
    (world) => world.anomaly,
  )
  const merlinHypotheses: MordredMerlinHypothesis[] =
    Array.from({ length: view.playerCount }, (_, seat) => seat)
      .filter((seat) => seat !== view.seat)
      .map((seat) => {
        const aggregate = hypothesisTotals.get(seat) ?? EMPTY_SUBJECT_MASS
        const conditional = conditionalOverlayIndex(aggregate)
        return {
          seat,
          hypothesisSemantics:
            'legal-world-merlin-coordinate-not-privileged-identity',
          worldMass: clampProbability(aggregate.mass),
          observationCoverageMass: clampProbability(
            aggregate.overlayAvailableMass,
          ),
          anomalousTreatmentMass: clampProbability(
            aggregate.overlayWeightedMass,
          ),
          conditionalAnomalousTreatmentIndex:
            conditional === null ? null : clampProbability(conditional),
        }
      })

  const assessments = commitments.map(
    (candidate): MordredBlindnessAssessment => {
      const visibleEvilCountDistribution =
        Array<number>(candidate.seats.length + 1).fill(0)
      const totalEvilCountDistribution =
        Array<number>(candidate.seats.length + 1).fill(0)
      let merlinBlindWindowProbability = 0
      let hiddenThresholdCrossingProbability = 0
      let anomalousBlindWindowMass = 0
      let treatmentObservationAvailable = false
      for (const world of worldRows) {
        const visibleCount = candidate.seats.filter(
          (seat) => world.visibleEvil.includes(seat),
        ).length
        const totalCount = candidate.seats.filter(
          (seat) => world.totalEvil.includes(seat),
        ).length
        visibleEvilCountDistribution[visibleCount] += world.probability
        totalEvilCountDistribution[totalCount] += world.probability
        const blindWindow =
          candidate.seats.includes(view.seat)
          && visibleCount < failsRequired!
        if (!blindWindow) continue
        merlinBlindWindowProbability += world.probability
        if (totalCount >= failsRequired!) {
          hiddenThresholdCrossingProbability += world.probability
        }
        if (world.anomaly.available) {
          treatmentObservationAvailable = true
          anomalousBlindWindowMass +=
            world.probability * world.anomaly.index
        }
      }
      const normalizedBlindWindow = clampProbability(
        merlinBlindWindowProbability,
      )
      const normalizedHiddenCrossing = clampProbability(
        hiddenThresholdCrossingProbability,
      )
      const normalizedAnomalousMass = clampProbability(
        anomalousBlindWindowMass,
      )
      const opportunityValue = clampProbability(
        0.75 * normalizedHiddenCrossing
        + 0.25 * normalizedAnomalousMass,
      )
      return {
        team: candidate,
        probabilitySemantics: 'resolved-complete-world-joint-sums',
        jointSemantics: 'direct-joint-world-sums-no-marginal-products',
        visibleEvilCountDistribution:
          visibleEvilCountDistribution.map(clampProbability),
        totalEvilCountDistribution:
          totalEvilCountDistribution.map(clampProbability),
        merlinBlindWindowProbability: normalizedBlindWindow,
        hiddenThresholdCrossingProbability: normalizedHiddenCrossing,
        treatmentObservationAvailable,
        anomalousBlindWindowMass: normalizedAnomalousMass,
        observationSemantics:
          'no-public-observation-is-zero-signal-not-innocence',
        policySemantics: 'team-opportunity-not-action-utility',
        opportunityValueSemantics:
          'bounded-heuristic-nonprobability-three-quarters-hidden-crossing-one-quarter-anomalous-window',
        opportunityValue,
      }
    },
  )
  const result: PrivateMordredBlindnessObjective = {
    version: MORDRED_BLINDNESS_OBJECTIVE_VERSION,
    role: 'mordred',
    source: {
      beliefModelVersion: belief.modelVersion,
      beliefThroughSeq: belief.throughSeq,
      beliefQuality: belief.quality,
      playerCount: view.playerCount,
      rolesInPlay: canonicalRoleMultiset(view.rolesInPlay),
      treatmentReadVersion: ACTOR_TARGET_TREATMENT_READ_VERSION,
      observerModelVersion: treatment.observerModelVersion,
      observerFeasibleWorldCount: treatment.observerFeasibleWorldCount,
      worldSemantics: 'resolved-weighted-complete-worlds',
      promotionSemantics:
        'constraints-only-exact-weighted-structural',
    },
    request: {
      seat: req.seat,
      kind: requestKind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired: failsRequired!,
      ...(currentTeam ? { currentTeam } : {}),
    },
    merlinHypotheses,
    assessments,
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8')
      > DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES
  ) {
    throw new Error('Mordred objective exceeds payload bound')
  }
  return result
}

/**
 * The shared canonical-roles guard plus the cast this module presumes: without
 * a mordred there is no blindness to reason about, and without a merlin there
 * is nothing to be blind to.
 *
 * Deliberately not named canonicalRoles. This is the shared predicate with a
 * role-specific postcondition welded on, and a call site cannot tell which of
 * the two contracts it is getting if both answer to the same name. That is the
 * confusion exactKeys/onlyAllowedKeys already cost us once.
 */
function canonicalRolesWithMordredAndMerlin(
  value: unknown,
  playerCount: number,
): value is Role[] {
  return canonicalRoles(value, playerCount)
    && value.includes('mordred')
    && value.includes('merlin')
}

function validDistribution(
  value: unknown,
  size: number,
): value is number[] {
  return denseArray(value)
    && value.length === size + 1
    && value.every(probability)
    && close(
      value.reduce((sum, entry) => sum + (entry as number), 0),
      1,
    )
}

function validatePrivateMordredBlindnessObjectiveShape(
  value: unknown,
  detached: boolean,
): value is PrivateMordredBlindnessObjective {
  try {
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
    ) return false
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
    ) return false
    const playerCount = source.playerCount as number
    // The request's own team is checked by the shared block guard; the team
    // size is still needed below, where every assessed team is measured.
    const teamSize = TEAM_SIZES[playerCount]?.[(request.round as number) - 1]
    if (
      !Number.isSafeInteger(teamSize)
      || !denseArray(value.merlinHypotheses)
      || value.merlinHypotheses.length !== playerCount - 1
      || !denseArray(value.assessments)
      || value.assessments.length > MAX_MORDRED_BLINDNESS_ASSESSMENTS
    ) return false
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
        || (raw.seat as number) >= playerCount
        || raw.seat === request.seat
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
    if (!close(totalWorldMass, 1)) return false

    const ids = new Set<string>()
    for (const raw of value.assessments) {
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
        || team.requestContext !== request.kind
        || !canonicalSeats(team.seats, playerCount)
        || team.seats.length !== teamSize
      ) return false
      const seats = team.seats as Seat[]
      const expectedId = `team:${seats.join(',')}`
      if (
        team.teamId !== expectedId
        || (
          team.requestContext === 'vote'
          && !isDeepStrictEqual(team.seats, request.currentTeam)
        )
        || raw.probabilitySemantics
          !== 'resolved-complete-world-joint-sums'
        || raw.jointSemantics
          !== 'direct-joint-world-sums-no-marginal-products'
        || !validDistribution(raw.visibleEvilCountDistribution, seats.length)
        || !validDistribution(raw.totalEvilCountDistribution, seats.length)
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
          0.75 * (raw.hiddenThresholdCrossingProbability as number)
            + 0.25 * (raw.anomalousBlindWindowMass as number),
        )
      ) return false
      ids.add(team.teamId as string)
    }
    const expectedIds = request.kind === 'vote'
      ? [`team:${(request.currentTeam as Seat[]).join(',')}`]
      : canonicalCombinations(playerCount, teamSize as number).map(
          (team) => `team:${team.join(',')}`,
        )
    return ids.size === expectedIds.length
      && expectedIds.every((id) => ids.has(id))
  } catch {
    return false
  }
}

export function validatePrivateMordredBlindnessObjective(
  value: unknown,
): value is PrivateMordredBlindnessObjective {
  return validatePrivateMordredBlindnessObjectiveShape(value, true)
}

/**
 * Decode a value already canonicalized and byte-bounded by the component
 * kernel. Only the component's semantic schema is checked here.
 */
export function decodeCanonicalPrivateMordredBlindnessObjective(
  value: CanonicalJsonValue,
): PrivateMordredBlindnessObjective | undefined {
  return validatePrivateMordredBlindnessObjectiveShape(value, false)
    ? value
    : undefined
}

export function validatePrivateMordredBlindnessHostJoin(
  value: unknown,
  input: {
    req: DecisionRequest
    view: PlayerView
    belief: BeliefSnapshot
    treatment: PrivateActorTargetTreatmentRead
    candidates: readonly PolicyCandidate[]
  },
): value is PrivateMordredBlindnessObjective {
  return validatePrivateMordredBlindnessObjective(value)
    && isDeepStrictEqual(
      value,
      buildPrivateMordredBlindnessObjective(input),
    )
}

export function validateAdmittedPrivateMordredBlindnessHostJoin(
  value: PrivateMordredBlindnessObjective,
  input: {
    req: DecisionRequest
    view: PlayerView
    belief: BeliefSnapshot
    treatment: PrivateActorTargetTreatmentRead
    candidates: readonly PolicyCandidate[]
  },
): boolean {
  return isDeepStrictEqual(
    value,
    buildPrivateMordredBlindnessObjective(input),
  )
}
