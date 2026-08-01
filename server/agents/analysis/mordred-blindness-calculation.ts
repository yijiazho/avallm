import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
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
import type { PolicyCandidate } from '../candidate/types.ts'
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
} from '../canonical/canonical-json.ts'
import {
  probability,
} from '../canonical/canonical-shape.ts'
import {
  clampProbability,
  closeProbability as close,
  stableProbabilitySum,
} from '../canonical/probability-arithmetic.ts'
import {
  accumulateSubjectMass,
  conditionalOverlayIndex,
  EMPTY_SUBJECT_MASS,
} from './perception-asymmetry.ts'
import { actorTargetMatrixIndex } from './actor-target-matrix.ts'

interface TreatmentAnomaly {
  available: boolean
  index: number
}

interface MordredWorldRow {
  probability: number
  merlin: Seat
  visibleEvil: readonly Seat[]
  totalEvil: readonly Seat[]
  anomaly: TreatmentAnomaly
}

interface MordredBuildContext {
  requestKind: 'propose' | 'vote'
  worlds: readonly WeightedWorld[]
  failsRequired: 1 | 2
  teamSize: number
  currentTeam?: readonly Seat[]
  commitments: readonly MordredBlindnessTeam[]
}

export interface MordredBlindnessObjectiveInput {
  req: DecisionRequest
  view: PlayerView
  belief: BeliefSnapshot
  treatment: PrivateActorTargetTreatmentRead
  candidates: readonly PolicyCandidate[]
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
): TreatmentAnomaly {
  const row = (target: Seat): ActorTargetTreatmentRow =>
    read.rows[actorTargetMatrixIndex(read.playerCount, merlin, target)]!
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
            belief.worlds[0]!.probability,
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

function canonicalCommitments(
  input: MordredBlindnessObjectiveInput,
): readonly MordredBlindnessTeam[] {
  const candidateTeams = input.candidates
    .map((candidate) => candidateTeam(candidate, input.view))
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
    candidateTeams.length !== input.candidates.length
    || commitments.length !== (
      input.req.kind === 'vote' ? 1 : input.candidates.length
    )
  ) {
    throw new Error('Mordred objective requires canonical candidates')
  }
  return commitments
}

function prepareBuildContext(
  input: MordredBlindnessObjectiveInput,
): MordredBuildContext {
  const { req, view, candidates } = input
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
  const worlds = validateBeliefForMordred(input.belief, view)
  const failsRequired = view.quests[view.round - 1]?.failsRequired
  const teamSize = TEAM_SIZES[view.playerCount]?.[view.round - 1]
  const currentTeam = req.kind === 'vote'
    ? view.currentTeam && canonicalTeam(view.currentTeam)
    : undefined
  if (
    (failsRequired !== 1 && failsRequired !== 2)
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
  return {
    requestKind: req.kind,
    worlds,
    failsRequired,
    teamSize: teamSize as number,
    ...(currentTeam ? { currentTeam } : {}),
    commitments: canonicalCommitments(input),
  }
}

function buildWorldRows(
  worlds: readonly WeightedWorld[],
  view: PlayerView,
  treatment: PrivateActorTargetTreatmentRead,
): readonly MordredWorldRow[] {
  return worlds.map((weighted) => {
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
}

function buildMerlinHypotheses(
  worldRows: readonly MordredWorldRow[],
  view: PlayerView,
): readonly MordredMerlinHypothesis[] {
  // The private complete-world mass per Merlin-hypothesis seat, split by the
  // treatment overlay, is the shared perception-asymmetry accumulation.
  const hypothesisTotals = accumulateSubjectMass(
    worldRows,
    (world) => world.merlin,
    (world) => world.probability,
    (world) => world.anomaly,
  )
  return Array.from({ length: view.playerCount }, (_, seat) => seat)
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
}

/** The policy heuristic used by construction and semantic admission. */
export function mordredOpportunityValue(
  hiddenThresholdCrossingProbability: number,
  anomalousBlindWindowMass: number,
): number {
  return clampProbability(
    0.75 * hiddenThresholdCrossingProbability
    + 0.25 * anomalousBlindWindowMass,
  )
}

function assessTeam(
  candidate: MordredBlindnessTeam,
  worldRows: readonly MordredWorldRow[],
  view: PlayerView,
  failsRequired: number,
): MordredBlindnessAssessment {
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
    visibleEvilCountDistribution[visibleCount]! += world.probability
    totalEvilCountDistribution[totalCount]! += world.probability
    const blindWindow =
      candidate.seats.includes(view.seat)
      && visibleCount < failsRequired
    if (!blindWindow) continue
    merlinBlindWindowProbability += world.probability
    if (totalCount >= failsRequired) {
      hiddenThresholdCrossingProbability += world.probability
    }
    if (world.anomaly.available) {
      treatmentObservationAvailable = true
      anomalousBlindWindowMass += world.probability * world.anomaly.index
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
    opportunityValue: mordredOpportunityValue(
      normalizedHiddenCrossing,
      normalizedAnomalousMass,
    ),
  }
}

export function buildPrivateMordredBlindnessObjective(
  input: MordredBlindnessObjectiveInput,
): PrivateMordredBlindnessObjective {
  const { req, view, belief, treatment } = input
  const context = prepareBuildContext(input)
  const worldRows = buildWorldRows(context.worlds, view, treatment)
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
      kind: context.requestKind,
      round: req.round,
      proposalNum: req.proposalNum,
      failsRequired: context.failsRequired,
      ...(context.currentTeam ? { currentTeam: context.currentTeam } : {}),
    },
    merlinHypotheses: buildMerlinHypotheses(worldRows, view),
    assessments: context.commitments.map(
      (candidate) => assessTeam(
        candidate,
        worldRows,
        view,
        context.failsRequired,
      ),
    ),
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8')
      > DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES
  ) {
    throw new Error('Mordred objective exceeds payload bound')
  }
  return result
}
