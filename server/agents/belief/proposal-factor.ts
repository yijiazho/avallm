// Conservative analytical weighting from the public proposal record.
//
// BELIEF-001, the half that was still missing. Nothing in this folder scored a
// proposal as evidence about the seat that made it: the quest-card factor reads
// cards, the vote-matrix factor reads ballots, and the third behavioural channel
// the compatibility heuristic reads, who a leader chose to seat, was unpriced.
// POLICY-002/NB-016 is the measured defect this is aimed at, the heuristic
// seating `0.923` evil per team against the exact-posterior policy's `1.181`.
//
// Hard feasibility stays authoritative. This only reweights worlds the exact
// constraints already permit, under a capped log-likelihood, and it never adds
// or removes a world.
//
// WHAT IS PRICED.
//
// One quantity per proposal per non-leader seat: was that seat aboard. The
// baseline is the a priori share of non-leader seats a team of this size holds,
// which is derived from the public shape of the proposal rather than authored,
// so the model carries no hidden dependence on table size. Against that
// baseline the model makes exactly one claim: an EVIL leader normally seats a
// partner it can SEE LESS often than chance would, because a team that reads
// clean is the cheapest cover in the game, and the exceptions are the
// situations where the arithmetic overrides the cover.
//
// WHICH DIRECTION THE CLAIM POINTS, which is the whole model.
//
// The first version of this file priced the opposite: evil stacks partners. It
// measured WORSE THAN NO FACTOR, dirty-team rate `88.4%` against the
// constraints-only base's `85.6%` on 216 held-out servant proposals, with
// calibration also going the wrong way (Brier `+0.0024`, log loss `+0.0051`).
// That is not a tuning miss, it is the sign.
//
// `docs/research-strategy.md` says so directly and said so first. §1 names
// "approve any team containing an evil player, propose teams with evil players
// on them" as the AvalonBench NAIVE MINION baseline and then says real evil
// play is that heuristic PLUS CAMOUFLAGE. §5.4, the script our own evil bots
// are prompted with, is explicit: propose semi-plausible teams including
// exactly one evil, yourself. §5.5 lists the proposal tell the strong-human
// feature set actually uses, and it is a PAIR signal, a leader who keeps
// including one particular other player, not stacking in general.
//
// So the sign here is taken from the brief, not from the measurement. The
// measurement is what caught the error; it is not what chose the replacement,
// and the distinction matters because the population that generated those
// records implements the brief's camouflage rule with a citation to it.
//
// WHY GOOD LEADERS ARE PRICED AT THE BASELINE RATHER THAN LEFT OUT.
//
// The vote-matrix factor leaves good voters unpriced and that costs it nothing,
// because the cast is fixed so every world holds the same number of evil voters
// and a constant for the good ones cancels in the normalization. That argument
// does NOT transfer here. A proposal prices one seat, the leader, and whether
// that seat is evil varies from world to world, so skipping good leaders would
// give different worlds different numbers of terms and tilt the posterior by
// arithmetic rather than by evidence. Pricing a good leader at the derived
// baseline is not a model of good play: it is the statement that the host
// cannot reconstruct a good leader's reasoning, which is the same position
// commit 54deb4f4 arrived at for votes after modelling good's behaviour
// measured worse. The baseline is world-invariant, so every good-leader world
// receives the identical constant and only the evil-leader worlds move.
//
// VISIBILITY IS WORLD-CONDITIONED.
//
// What matters is not how many evil seats the leader put aboard but how many it
// could see. Mordred is visible to its partners; Oberon knows nobody and is
// known by nobody, so an Oberon leader reads exactly like a good one under this
// model and receives the baseline constant. That is the honest answer: an
// Oberon leader genuinely has no partner information to act on.
//
// THE VIEWER'S OWN PROPOSALS ARE EXCLUDED.
//
// `docs/probabilistic-agent-architecture.md` §3.4: an agent's own prior actions
// are not evidence for its own private hidden-world posterior. An evil viewer
// that stacked its own team would otherwise read its own choice back as proof
// that it is evil, which it already knows, and would smear that certainty
// across the worlds it is trying to distinguish. The viewer seat is an explicit
// parameter of the evidence builder rather than an implicit read, because the
// vote-matrix factor has no viewer concept at all and reweights an evil
// viewer's posterior through its own ballot.

// WHAT IT MEASURED, and why it is seated nowhere.
//
// Held-out servant proposals, same policy, only the belief changed, against
// both frozen populations. Heuristic corpus, `2039` decisions: dirty-team rate
// `77.7%` against the constraints-only base's `81.1%`, paired `-3.38%`
// (95% `-5.17%` to `-1.59%`, `p = 2.6e-4`). Random corpus, `2297` decisions:
// `72.8%` against `74.2%`, paired `-1.44%` (95% `-3.48%` to `+0.61%`,
// `p = 0.18`), which is null.
//
// The primary POLICY-002 quantity does not move. That defect is the base
// seating `1.126` evil per team against the compatibility heuristic's `0.941`,
// and this factor reads `1.111`: a paired difference of `-0.0147` whose
// interval (`-0.0483` to `+0.0188`) contains zero. It removes the occasional
// dirty team without placing fewer evil seats. Calibration says the same thing
// in the same direction and at the same size: player-evil Brier `-0.00104` and
// log loss `-0.00220` on the heuristic corpus, `-0.00026` and `-0.00050` on the
// random one, against the seated quest factor's `-0.00526` and `-0.01114`.
//
// And the heuristic number is the circular one. `decidePropose` in
// `server/agents/heuristic.ts` implements this camouflage rule directly, citing
// the same brief sections this model is built from, so that population is close
// to built to satisfy it. Read together, the honest summary is that this factor
// finds a small amount of exactly what its opponent was told to do and nothing
// where the opponent proposes without regard to alignment.
//
// The sign result is worth more than the factor. Running the naive-minion sign
// over the identical cases gives `85.2%`, paired `+4.07%` (`p = 2.3e-6`) and
// calibration worse on both metrics: WORSE THAN NO FACTOR, significantly, on
// the same corpus where the camouflage sign helps. Whichever way a proposal
// factor should point, it is not the AvalonBench baseline direction, and that
// holds across both populations.
//
// Cost is not the obstacle but is recorded: on 40 ten-player round-four-plus
// proposals it runs `158.3` ms per decision against the seated quest factor's
// `142.5` and a uniform belief's `79.4`. Those absolutes are not comparable to
// the figures recorded for the quest and vote factors, which were taken on a
// harness that reuses one agent; this one builds a fresh agent per decision and
// so defeats the cache. The `+11%` against the seated sibling is the comparable
// number.

import { MAX_PROPOSALS, ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { PlayerView, Seat } from '../../engine/types.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
  feasibleWorlds,
} from './exact.ts'
import {
  buildFactorProvenance,
  type BeliefModel,
  type BeliefSnapshot,
  type HiddenWorld,
  type LikelihoodFactor,
} from './types.ts'
import { capLogLikelihood } from '../canonical/probability-arithmetic.ts'
import { normalizeLogWeights } from './log-weights.ts'

export const PROPOSAL_FACTOR_VERSION = 'analytical-proposal-v1'
export const PROPOSAL_BUNDLE_VERSION = 'proposal-only-v1'
export const PROPOSAL_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+proposal-v1'

/**
 * The whole factor's contribution to any world is clamped here, relative to the
 * best world, exactly as the quest-card factor clamps its own.
 *
 * `log(1.5)`, matching the vote-matrix factor rather than the quest factor's
 * `log(2)`, and the reason is the same one only more so. The quest factor reads
 * at most five events in a game. Every ballot has a proposal behind it and the
 * hammer adds one the ballot record never sees, so the proposal record is the
 * LONGEST behavioural record the game produces. A per-event contribution small
 * enough to be defensible still accumulates over a dozen of them, and no pile
 * of team choices may be allowed to outweigh a hard Fail-count fact.
 */
export const PROPOSAL_LOG_LIKELIHOOD_CAP = Math.log(1.5)

/**
 * The model itself: every probability this factor prices, in one place.
 *
 * These are **analytical conventions, not measured frequencies**. The
 * quest-card and vote-matrix factor headers make the same disclaimer and it
 * applies here unchanged: read each entry as "how a conservative observer
 * prices this situation", not as an estimate of anybody's actual behaviour.
 *
 * Every entry except the mixture is an ODDS LIFT, not a probability. It
 * multiplies the odds that a seat is aboard, starting from the derived
 * baseline rate for the proposal's shape. Odds rather than probability because
 * the baseline moves with the table: a five-player opening team puts one of the
 * four non-leader seats aboard (`0.25`) where a ten-player fourth quest puts
 * four of nine (`0.444`), and a flat probability that reads as a strong lift on
 * the small table would read as a SUPPRESSION on the large one, inverting the
 * factor's own claim without anybody choosing that.
 *
 * The default is BELOW one, which is the camouflage claim in the header. The
 * three exceptions above one are the situations where the arithmetic overrides
 * the cover, and each of them is named in the brief rather than invented here.
 * Keys are listed in the precedence order `partnerOddsLift` applies:
 *
 * - `hammer`: the fifth proposal, which the engine auto-approves with no
 *   ballot. The team goes out whatever anybody thinks of it, so a partner
 *   aboard costs nothing this round. This is the situation §6.4 names when it
 *   says approving on proposal one is not the same event as approving near the
 *   hammer, read on the proposing side.
 * - `twoFailsRequired`: a quest a lone evil cannot fail whatever it draws. An
 *   evil leader that does not seat a visible partner has spent the round, and
 *   §5.4's own two-Fail rule says so.
 * - `decisiveBoard`: either side one quest from winning. The reason to stay
 *   unread expires when the game is about to end either way.
 * - `firstRound`: the cheapest cover in the game, so the strongest suppression.
 *   Round one buys credibility at almost no cost, and there are four more
 *   quests in which to spend it.
 * - `laterRound`: everything else. Still suppressed, less strongly, because the
 *   board is shorter and the cover is worth relatively less.
 *
 * Changing any value changes belief output for every seat that runs this
 * factor, so treat an edit as a new model and bump the versions above in the
 * same change. The pinning assertion in the suite is what makes a silent
 * retune fail.
 */
export const PROPOSAL_MODEL_PARAMETERS = Object.freeze({
  partnerOddsLift: Object.freeze({
    hammer: 1.6,
    twoFailsRequired: 2.2,
    decisiveBoard: 1.6,
    firstRound: 0.5,
    laterRound: 0.6,
  }),
  /**
   * Uniform mixture folded in before use, so no legal public team is ever
   * assigned probability zero by a convention and no run of proposals can pin
   * a world.
   */
  uniformMixtureWeight: 0.08,
})

export interface ProposalEvidence {
  evidenceId: string
  sourceSeq: number
  round: number
  proposalNum: number
  leader: Seat
  team: readonly Seat[]
  playerCount: number
  failsRequired: number
  decisiveBoard: boolean
  hammer: boolean
}

export type ProposalLikelihoodFactor =
  LikelihoodFactor<ProposalEvidence, 'proposal'>

function proposalSeq(
  view: PlayerView,
  round: number,
  proposalNum: number,
): number {
  const event = view.events.find(
    (candidate) =>
      candidate.type === 'proposal'
      && candidate.payload.round === round
      && candidate.payload.proposalNum === proposalNum,
  )
  if (!event) {
    throw new Error(
      `proposal ${round}.${proposalNum} has no visible proposal event`,
    )
  }
  return event.seq
}

/**
 * Every proposal in the public record except the viewer's own.
 *
 * `viewerSeat` is required rather than read off the view, so a caller cannot
 * omit the §3.4 exclusion by accident and so a test can state it directly.
 *
 * Pending proposals are included. A proposal on the table has already been
 * committed by its leader and is exactly as much of a choice as a resolved one;
 * excluding it would blind the factor at the vote decision, which is the moment
 * the posterior is most often consulted.
 *
 * The team recorded is the FINAL team, post-revision if the leader revised. The
 * revision itself is a second signal this deliberately does not price: what the
 * leader settled on is the choice it is answerable for, and modelling why a
 * leader changed its mind is a claim about play this model does not make.
 */
export function proposalEvidence(
  view: PlayerView,
  viewerSeat: Seat,
): readonly ProposalEvidence[] {
  const evidence: ProposalEvidence[] = []
  const score = { good: 0, evil: 0 }
  let questCursor = 0
  for (const proposal of view.proposals) {
    // Board state as of this proposal: quests resolved strictly before it.
    while (
      questCursor < view.quests.length
      && view.quests[questCursor].status === 'complete'
      && view.quests[questCursor].num < proposal.round
    ) {
      const quest = view.quests[questCursor]
      if (quest.status !== 'complete') break
      score[quest.result === 'success' ? 'good' : 'evil'] += 1
      questCursor += 1
    }
    // §3.4. The viewer's own choices are not evidence about the viewer.
    if (proposal.leader === viewerSeat) continue
    const quest = view.quests[proposal.round - 1]
    if (!quest) continue
    const sourceSeq = proposalSeq(view, proposal.round, proposal.proposalNum)
    evidence.push({
      evidenceId: `event:${sourceSeq}:proposal`,
      sourceSeq,
      round: proposal.round,
      proposalNum: proposal.proposalNum,
      leader: proposal.leader,
      team: [...proposal.team].sort((left, right) => left - right),
      playerCount: view.playerCount,
      failsRequired: quest.failsRequired,
      decisiveBoard: score.good >= 2 || score.evil >= 2,
      hammer: proposal.proposalNum >= MAX_PROPOSALS,
    })
  }
  return evidence
}

/**
 * The a priori chance that any one non-leader seat is aboard, from the public
 * shape of the proposal alone.
 *
 * Derived rather than authored, and deliberately independent of WHICH seats are
 * aboard: a baseline read off the observed team would be the observed team, and
 * every world would price identically. It depends only on how many seats the
 * team holds, whether the leader took one of them, and how many players are at
 * the table, all of which are the same in every world.
 */
export function baselineInclusionRate(evidence: ProposalEvidence): number {
  const leaderAboard = evidence.team.includes(evidence.leader)
  const others = evidence.playerCount - 1
  if (others <= 0) throw new Error('a proposal needs at least two seats')
  const seatsToPlace = evidence.team.length - (leaderAboard ? 1 : 0)
  return seatsToPlace / others
}

/** Whether an evil `leader` can see that `seat` is a partner, in this world. */
export function partnerVisibleToLeader(
  world: HiddenWorld,
  leader: Seat,
  seat: Seat,
): boolean {
  const leaderRole = world.roleBySeat[leader]
  const seatRole = world.roleBySeat[seat]
  if (ROLE_ALIGNMENT[leaderRole] !== 'evil') return false
  if (ROLE_ALIGNMENT[seatRole] !== 'evil') return false
  // Neither side of an Oberon pairing can see the other, in either direction.
  if (leaderRole === 'oberon' || seatRole === 'oberon') return false
  return true
}

/** The contextual odds lift this situation applies to a visible partner. */
export function partnerOddsLift(evidence: ProposalEvidence): number {
  const lifts = PROPOSAL_MODEL_PARAMETERS.partnerOddsLift
  if (evidence.hammer) return lifts.hammer
  if (evidence.failsRequired === 2) return lifts.twoFailsRequired
  if (evidence.decisiveBoard) return lifts.decisiveBoard
  return evidence.round === 1 ? lifts.firstRound : lifts.laterRound
}

/**
 * Probability this seat is aboard, under the model, given the world.
 *
 * A good leader, and an Oberon leader who can see nobody, price every seat at
 * the baseline, so their worlds all receive the same world-invariant constant
 * and the factor moves only the worlds where a leader had partner information
 * and acted, or declined to act, on it.
 */
export function inclusionProbability(
  world: HiddenWorld,
  evidence: ProposalEvidence,
  seat: Seat,
): number {
  const base = baselineInclusionRate(evidence)
  let probability = base
  if (partnerVisibleToLeader(world, evidence.leader, seat)) {
    // Odds lift, then back to a probability. `base` is strictly inside (0, 1)
    // for every legal proposal shape, so the odds are finite and positive.
    // A lift below one is a suppression, which is the usual case here.
    const odds = (base / (1 - base)) * partnerOddsLift(evidence)
    probability = odds / (1 + odds)
  }
  const mixture = PROPOSAL_MODEL_PARAMETERS.uniformMixtureWeight
  // Mixed with a coin before use, so no team is ever impossible under a
  // convention and one surprising proposal cannot annihilate a feasible world.
  return (1 - mixture) * probability + mixture * 0.5
}

export const analyticalProposalFactor: ProposalLikelihoodFactor =
  Object.freeze({
    id: 'proposal',
    version: PROPOSAL_FACTOR_VERSION,
    logLikelihood(world: HiddenWorld, evidence: ProposalEvidence) {
      const aboard = new Set(evidence.team)
      let total = 0
      for (let seat = 0; seat < evidence.playerCount; seat++) {
        // The leader's own seat is never priced. Leaders seat themselves at a
        // rate that has nothing to do with alignment, and the baseline above
        // already excludes the leader from the seats it distributes.
        if (seat === evidence.leader) continue
        const probability = inclusionProbability(world, evidence, seat)
        total += Math.log(aboard.has(seat) ? probability : 1 - probability)
      }
      return total
    },
  })

/**
 * Stable code every consumer matches on, and the only thing the degraded
 * snapshot carries.
 *
 * No free-text detail rides along, unlike the quest-card factor's. That
 * factor's detail entry needs its own sanitizer to stop an error message
 * smuggling an em-dash or a stack frame into a rendered surface, and a third
 * private copy of that sanitizer in this folder is how a class of bug gets
 * planted. If a detail channel is wanted for all three, it should be one shared
 * helper rather than a copy per factor.
 */
export const PROPOSAL_FACTOR_DEGRADATION = 'proposal-factor-failed'

function weightedSnapshot(
  view: PlayerView,
  factor: ProposalLikelihoodFactor,
): BeliefSnapshot {
  const worlds = feasibleWorlds(view)
  const evidence = proposalEvidence(view, view.seat)
  if (!evidence.length) {
    // Nobody else has proposed yet, so there is nothing to weigh and the honest
    // answer is the uniform posterior under this model's name.
    const uniform = exactBelief(view)
    return { ...uniform, modelVersion: PROPOSAL_WEIGHTED_BELIEF_VERSION }
  }
  const raw = worlds.map((world) =>
    evidence.reduce(
      (sum, item) => sum + factor.logLikelihood(world, item),
      0,
    ))
  // Folded rather than spread. `Math.max(...raw)` passes one argument per
  // world, and the argument list is a stack allocation: it throws RangeError
  // somewhere above 100k arguments, and where exactly moves with the stack
  // size. The largest legal seat view enumerates 60,480 worlds (10 players,
  // merlin+percival+assassin+morgana+mordred), so the spread form survives
  // today on roughly a 2x margin that no test pins and a thread with a smaller
  // stack would erode. language-factor.ts already folds for this reason.
  let best = -Infinity
  for (const value of raw) if (value > best) best = value
  const capped = raw.map((value) =>
    capLogLikelihood(value - best, PROPOSAL_LOG_LIKELIHOOD_CAP).value)
  return beliefFromWeightedWorlds(
    view,
    normalizeLogWeights(worlds, capped),
    {
      modelVersion: PROPOSAL_WEIGHTED_BELIEF_VERSION,
      quality: 'weighted',
      provenance: [
        buildFactorProvenance(
          factor,
          evidence.map((item) => item.evidenceId),
          PROPOSAL_LOG_LIKELIHOOD_CAP,
          capped,
        ),
      ],
    },
  )
}

export function createProposalWeightedBeliefModel(
  factor: ProposalLikelihoodFactor = analyticalProposalFactor,
): BeliefModel {
  return Object.freeze({
    version: PROPOSAL_WEIGHTED_BELIEF_VERSION,
    factorsVersion: PROPOSAL_BUNDLE_VERSION,
    infer(view: PlayerView): BeliefSnapshot {
      try {
        return weightedSnapshot(view, factor)
      } catch {
        const fallback = exactBelief(view)
        return {
          ...fallback,
          modelVersion: PROPOSAL_WEIGHTED_BELIEF_VERSION,
          quality: 'degraded',
          degradation: [PROPOSAL_FACTOR_DEGRADATION],
        }
      }
    },
  })
}

export const proposalWeightedBeliefModel = createProposalWeightedBeliefModel()
