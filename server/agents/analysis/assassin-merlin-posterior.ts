import { isDeepStrictEqual } from 'node:util'
import type {
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { ROLE_ALIGNMENT, proposalResolved, proposalVotes } from '../../engine/rules.ts'
import { evilPartnersOf } from '../../engine/knowledge.ts'
import { visibleEventCursor } from '../belief/exact.ts'
import { assertDistribution } from '../belief/invariants.ts'
import type {
  BeliefSnapshot,
  WeightedWorld,
} from '../belief/types.ts'
import {
  denseOwnDataArrayValues,
  exactOwnDataRecord,
  type CanonicalJsonValue,
} from '../components/canonical-json.ts'
import {
  ASSASSIN_BEHAVIOR_COEFFICIENTS,
  ASSASSIN_BEHAVIOR_COEFFICIENT_VERSION,
  ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP,
  ASSASSIN_MERLIN_POSTERIOR_VERSION,
  type AssassinMerlinTargetPosterior,
  type PrivateAssassinMerlinPosterior,
} from './assassin-merlin-posterior-types.ts'
import { probability } from '../components/canonical-shape.ts'
import {
  closeProbability as close,
  stableProbabilitySum,
} from '../components/probability-arithmetic.ts'

function resolvedActions(view: PlayerView) {
  return [...view.proposals]
    .filter(proposalResolved)
    .sort(
      (a, b) =>
        a.round - b.round
        || a.proposalNum - b.proposalNum
        || a.leader - b.leader,
    )
    .map((proposal) => ({
      leader: proposal.leader,
      team: proposal.team,
      votes: [...proposalVotes(proposal)].sort((a, b) => a.seat - b.seat),
    }))
}

function correctCounts(
  weighted: WeightedWorld,
  merlin: Seat,
  actions: ReturnType<typeof resolvedActions>,
): { cleanProposals: number; voteAgreements: number } {
  const visibleEvil = new Set(
    weighted.world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role }) =>
        ROLE_ALIGNMENT[role] === 'evil' && role !== 'mordred')
      .map(({ seat }) => seat),
  )
  let cleanProposals = 0
  let voteAgreements = 0
  for (const action of actions) {
    const appearsClean = action.team.every((seat) => !visibleEvil.has(seat))
    if (action.leader === merlin && appearsClean) cleanProposals += 1
    const vote = action.votes.find((entry) => entry.seat === merlin)
    if (
      vote
      && (
        (vote.vote === 'approve' && appearsClean)
        || (vote.vote === 'reject' && !appearsClean)
      )
    ) voteAgreements += 1
  }
  return { cleanProposals, voteAgreements }
}

export function buildPrivateAssassinMerlinPosterior(input: {
  req: DecisionRequest
  view: PlayerView
  belief: BeliefSnapshot
}): PrivateAssassinMerlinPosterior {
  const { req, view, belief } = input
  if (
    req.kind !== 'assassinate'
    || view.phase !== 'assassination'
    || view.role !== 'assassin'
    || !view.rolesInPlay.includes('merlin')
    || req.seat !== view.seat
    || req.round !== view.round
    || req.proposalNum !== view.proposalNum
    || belief.throughSeq !== visibleEventCursor(view)
  ) throw new Error('Assassin Merlin posterior is inapplicable')
  return buildPrivateEvilSeatMerlinPosterior({ view, belief })
}

/**
 * PlayerView-only E3A predictor core. Evaluation may ask any evil seat for an
 * unlabelled Merlin prediction, while the production wrapper above retains
 * strict Assassin request and phase applicability.
 */
export function buildPrivateEvilSeatMerlinPosterior(input: {
  view: PlayerView
  belief: BeliefSnapshot
}): PrivateAssassinMerlinPosterior {
  const { view, belief } = input
  if (
    view.alignment !== 'evil'
    || ROLE_ALIGNMENT[view.role] !== 'evil'
    || !view.rolesInPlay.includes('merlin')
    || belief.throughSeq !== visibleEventCursor(view)
  ) throw new Error('evil-seat Merlin predictor is inapplicable')
  const actions = resolvedActions(view)
  const byMerlin = Array.from(
    { length: view.playerCount },
    (): WeightedWorld[] => [],
  )
  for (const weighted of belief.worlds) {
    const merlin = weighted.world.roleBySeat.indexOf('merlin')
    if (
      merlin < 0
      || weighted.world.roleBySeat[view.seat] !== view.role
      || !Number.isFinite(weighted.probability)
      || weighted.probability <= 0
    ) throw new Error('evil-seat predictor requires legal positive worlds')
    byMerlin[merlin].push(weighted)
  }
  const visiblePartners = new Set(evilPartnersOf(view.privateInfo))
  const rows = Array.from({ length: view.playerCount }, (_, seat) => seat)
    .filter((seat) => seat !== view.seat)
    .map((seat) => {
      const worlds = byMerlin[seat]
      const prior = stableProbabilitySum(worlds, (world) => world.probability)
      const proposalObservations = actions.filter(
        (action) => action.leader === seat,
      ).length
      const voteObservations = actions.filter(
        (action) => action.votes.some((vote) => vote.seat === seat),
      ).length
      const expected = worlds.map((world) => ({
        probability: world.probability,
        ...correctCounts(world, seat, actions),
      }))
      const expectedCleanTeamProposals = prior === 0 ? 0
        : stableProbabilitySum(
            expected,
            (row) => row.probability * row.cleanProposals,
          ) / prior
      const expectedVoteAgreements = prior === 0 ? 0
        : stableProbabilitySum(
            expected,
            (row) => row.probability * row.voteAgreements,
          ) / prior
      const cleanTeamProposalRate = proposalObservations === 0
        ? 0
        : expectedCleanTeamProposals / proposalObservations
      const voteAgreement = voteObservations === 0
        ? 0
        : expectedVoteAgreements / voteObservations
      return {
        seat,
        knownVisibleEvil: visiblePartners.has(seat),
        priorProbability: prior,
        proposalObservations,
        expectedCleanTeamProposals,
        cleanTeamProposalRate,
        voteObservations,
        expectedVoteAgreements,
        voteAgreement,
        rawBehaviorLogWeight:
          ASSASSIN_BEHAVIOR_COEFFICIENTS.cleanTeamProposalRate
            * cleanTeamProposalRate
          + ASSASSIN_BEHAVIOR_COEFFICIENTS.voteAgreement * voteAgreement,
      }
    })
  if (rows.some((row) => row.knownVisibleEvil && !close(row.priorProbability, 0))) {
    throw new Error('visible evil cannot carry Merlin prior')
  }
  const supported = rows.filter((row) => row.priorProbability > 0)
  if (!supported.length) throw new Error('Assassin posterior has no support')
  const minimum = Math.min(...supported.map((row) => row.rawBehaviorLogWeight))
  const maximum = Math.max(...supported.map((row) => row.rawBehaviorLogWeight))
  const rawSpan = maximum - minimum
  const scale = rawSpan > ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP
    ? ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP / rawSpan
    : 1
  const weighted = rows.map((row) => {
    const cappedBehaviorLogWeight = row.priorProbability === 0
      ? 0
      : (row.rawBehaviorLogWeight - maximum) * scale
    return {
      ...row,
      cappedBehaviorLogWeight,
      mass: row.priorProbability * Math.exp(cappedBehaviorLogWeight),
    }
  })
  const normalization = stableProbabilitySum(weighted, (row) => row.mass)
  const targets: AssassinMerlinTargetPosterior[] = weighted.map((row) => ({
    seat: row.seat,
    knownVisibleEvil: row.knownVisibleEvil,
    priorProbability: row.priorProbability,
    proposalObservations: row.proposalObservations,
    cleanTeamProposalRate: row.cleanTeamProposalRate,
    voteObservations: row.voteObservations,
    voteAgreement: row.voteAgreement,
    posteriorProbability: row.mass / normalization,
  }))
  // The posterior over Merlin candidates is the input to the assassination
  // shot, so a normalization slip here silently redirects the kill. Every row
  // is carried through, so the masses divided by their own stable total form a
  // distribution; guard it before it leaves this function.
  assertDistribution(
    targets.map((target) => target.posteriorProbability),
    'assassin Merlin posterior',
  )
  return {
    version: ASSASSIN_MERLIN_POSTERIOR_VERSION,
    source: {
      beliefModelVersion: belief.modelVersion,
      beliefThroughSeq: belief.throughSeq,
      beliefQuality: belief.quality,
      coefficientVersion: ASSASSIN_BEHAVIOR_COEFFICIENT_VERSION,
      behavioralLogWeightCap: ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP,
      behavioralLogWeightSpan: Math.min(
        rawSpan,
        ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP,
      ),
    },
    coefficients: ASSASSIN_BEHAVIOR_COEFFICIENTS,
    targets,
  }
}

/** Semantic decoder after the kernel's shared hostile-data canonicalizer. */
export function decodeCanonicalPrivateAssassinMerlinPosterior(
  value: CanonicalJsonValue,
): PrivateAssassinMerlinPosterior | undefined {
  const root = exactOwnDataRecord(value, [
    'version', 'source', 'coefficients', 'targets',
  ])
  const source = exactOwnDataRecord(root?.source, [
    'beliefModelVersion', 'beliefThroughSeq', 'beliefQuality',
    'coefficientVersion', 'behavioralLogWeightCap', 'behavioralLogWeightSpan',
  ])
  const coefficients = exactOwnDataRecord(root?.coefficients, [
    'cleanTeamProposalRate', 'voteAgreement',
  ])
  const targets = denseOwnDataArrayValues(root?.targets, 9)
  if (
    !root || !source || !coefficients || !targets
    || root.version !== ASSASSIN_MERLIN_POSTERIOR_VERSION
    || typeof source.beliefModelVersion !== 'string'
    || source.beliefModelVersion.length === 0
    || source.beliefModelVersion.length > 200
    || !Number.isSafeInteger(source.beliefThroughSeq)
    || (source.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      String(source.beliefQuality),
    )
    || source.coefficientVersion !== ASSASSIN_BEHAVIOR_COEFFICIENT_VERSION
    || source.behavioralLogWeightCap !== ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP
    || coefficients.cleanTeamProposalRate
      !== ASSASSIN_BEHAVIOR_COEFFICIENTS.cleanTeamProposalRate
    || coefficients.voteAgreement
      !== ASSASSIN_BEHAVIOR_COEFFICIENTS.voteAgreement
    || targets.length < 4
    || !probability(source.behavioralLogWeightSpan)
    || (source.behavioralLogWeightSpan as number)
      > ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP
  ) return undefined
  let previousSeat = -1
  const decoded: AssassinMerlinTargetPosterior[] = []
  for (const target of targets) {
    const row = exactOwnDataRecord(target, [
      'seat', 'knownVisibleEvil', 'priorProbability', 'proposalObservations',
      'cleanTeamProposalRate', 'voteObservations', 'voteAgreement',
      'posteriorProbability',
    ])
    if (
      !row
      || !Number.isSafeInteger(row.seat)
      || (row.seat as number) <= previousSeat
      || (row.seat as number) > 9
      || typeof row.knownVisibleEvil !== 'boolean'
      || !probability(row.priorProbability)
      || (row.knownVisibleEvil && row.priorProbability !== 0)
      || !nonnegativeCount(row.proposalObservations)
      || !probability(row.cleanTeamProposalRate)
      || !nonnegativeCount(row.voteObservations)
      || !probability(row.voteAgreement)
      || !probability(row.posteriorProbability)
    ) return undefined
    previousSeat = row.seat as number
    decoded.push(row as unknown as AssassinMerlinTargetPosterior)
  }
  if (
    !close(
      stableProbabilitySum(decoded, (row) => row.priorProbability),
      1,
    )
    || !close(
      stableProbabilitySum(decoded, (row) => row.posteriorProbability),
      1,
    )
  ) return undefined
  return value as unknown as PrivateAssassinMerlinPosterior
}

function nonnegativeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function validateAdmittedPrivateAssassinMerlinPosteriorHostJoin(
  value: PrivateAssassinMerlinPosterior,
  input: {
    req: DecisionRequest
    view: PlayerView
    belief: BeliefSnapshot
  },
): boolean {
  return isDeepStrictEqual(value, buildPrivateAssassinMerlinPosterior(input))
}
