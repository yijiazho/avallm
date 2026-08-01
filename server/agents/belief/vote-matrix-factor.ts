// Conservative analytical weighting from the public vote matrix.
//
// BELIEF-001. The constraints-only belief is blind to behaviour, and that
// blindness is measurable: on the wide bank's servant cell the compatibility
// heuristic seated `0.923` evil players per team against the exact-posterior
// policy's `1.181`, identical at q1 and diverging from q2 onward. The
// quest-card factor closed one of the three behavioural signals that heuristic
// reads. This closes the other two, which are both votes.
//
// `docs/research-strategy.md` calls the vote matrix the primary text of
// competitive play, and names evil's vote discipline as its biggest systematic
// leak. Hard feasibility remains authoritative; this only reweights worlds the
// exact constraints already permit, under a capped log-likelihood.
//
// WHAT IS PRICED, and what deliberately is not.
//
// Only EVIL votes carry a likelihood. A good player votes on an inference the
// host cannot reconstruct, so pricing good votes would mean inventing a model
// of someone else's reasoning and calling the result evidence. Because the cast
// is fixed, every world has the same number of good voters, so a constant for
// them cancels in the normalization and leaving them unpriced costs nothing.
//
// The evil model is one asymmetry: evil approves a team it can actually fail
// and is more reluctant about one it cannot. That single claim reproduces both
// heuristic signals rather than transcribing them. A seat that approved a team
// which turned out to seat evil is likelier to be evil, because the world where
// it is evil explains the approval; a seat that approved a clean team is
// likelier to be good, because that world does not. The heuristic spent two
// hand-weights on those two cases; here they are one rule read in two
// directions.
//
// Visibility is world-conditioned, which is the part a hand-weight cannot do.
// What matters is not how many evils are aboard but how many the VOTER can see:
// Oberon sees no partners and is seen by none, so a team's failability looks
// different to different evil seats in the same world.
//
// THE VIEWER'S OWN BALLOT IS EXCLUDED.
//
// `docs/probabilistic-agent-architecture.md` §3.4: an agent's own prior actions
// are not evidence for its own private hidden-world posterior. This factor
// originally had no viewer concept at all, and the omission was invisible from
// the good side, where the alignment test already skips the viewer in every
// feasible world. From the evil side it was live: an evil seat priced its own
// vote through `visibleFailPower`, which varies across worlds with how many
// partners it could see, so the seat read its own ballot back as evidence about
// a deal it already knows its own place in. See `voteMatrixEvidence`.

import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
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

export const VOTE_MATRIX_FACTOR_VERSION = 'analytical-vote-matrix-v1'
export const VOTE_MATRIX_BUNDLE_VERSION = 'vote-matrix-only-v1'
export const VOTE_MATRIX_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+vote-matrix-v1'
/**
 * The whole factor's contribution to any world is clamped here. A vote is much
 * weaker evidence than a Fail card, and a long game holds far more votes than
 * quests, so the cap is tighter than the quest factor's `log(2)`: without it a
 * dozen mildly-priced ballots could outweigh a hard Fail-count fact.
 */
export const VOTE_MATRIX_LOG_LIKELIHOOD_CAP = Math.log(1.5)

/*
 * Cost, measured because the quest-card factor had to pass this check before it
 * was seated and a sibling should not skip it. This factor iterates every
 * ballot for every world where that one iterates every quest, so it is the
 * heavier shape on paper. On 40 ten-player round-four-plus proposals, the
 * largest world sets and longest vote records the game produces, it runs at
 * 91.8 ms per decision against the uniform belief's 103.1 and the seated
 * quest-card factor's 85.7. No penalty: reweighting worlds the belief already
 * enumerated is cheap next to enumerating them.
 */

/**
 * The model itself: every probability this factor prices, in one place.
 *
 * These are **analytical conventions, not measured frequencies**. Read each
 * entry as "how a conservative observer prices this situation", not as an
 * estimate of anybody's actual behaviour. The quest-card factor's header makes
 * the same disclaimer and it applies here unchanged.
 *
 * Changing any value changes belief output for every seat that runs this
 * factor, so treat an edit as a new model and bump the versions above in the
 * same change. The pinning assertion in the suite is what makes a silent
 * retune fail.
 */
export const VOTE_MATRIX_MODEL_PARAMETERS = Object.freeze({
  /**
   * Evil approving a team it can see enough partners aboard to fail. This is
   * the whole point of the ballot, so it is high, and a decisive board removes
   * what little restraint remains.
   */
  canFail: Object.freeze({
    decisiveBoard: 0.92,
    openBoard: 0.82,
  }),
  /**
   * Evil approving a team it cannot fail. Not rare: approving clean teams is
   * how evil buys the credibility it spends later, and rejecting everything is
   * itself the loudest tell. Held near even so a single ballot moves little.
   */
  cannotFail: Object.freeze({
    decisiveBoard: 0.34,
    openBoard: 0.45,
  }),
  /**
   * Uniform mixture folded in before use, so no legal public ballot is ever
   * assigned probability zero by a convention.
   */
  uniformMixtureWeight: 0.08,
})

export interface VoteMatrixEvidence {
  evidenceId: string
  sourceSeq: number
  round: number
  proposalNum: number
  team: readonly Seat[]
  failsRequired: number
  votes: readonly Readonly<{ seat: Seat; approve: boolean }>[]
  decisiveBoard: boolean
}

export type VoteMatrixLikelihoodFactor =
  LikelihoodFactor<VoteMatrixEvidence, 'vote-matrix'>

function voteRevealSeq(
  view: PlayerView,
  round: number,
  proposalNum: number,
): number {
  const event = view.events.find(
    (candidate) =>
      candidate.type === 'voteReveal'
      && candidate.payload.round === round
      && candidate.payload.proposalNum === proposalNum,
  )
  if (!event) {
    throw new Error(
      `voted proposal ${round}.${proposalNum} has no visible reveal event`,
    )
  }
  return event.seq
}

/**
 * Every resolved ballot in the public record, minus the viewer's own vote.
 *
 * The hammer is excluded because the engine auto-approves it with no vote: a
 * ballot nobody cast carries no information about anybody, and pricing the
 * absence would invent evidence.
 *
 * `viewerSeat` is required rather than read off the view, matching
 * proposal-factor.ts, so a caller cannot omit the exclusion by accident.
 * `docs/probabilistic-agent-architecture.md` §3.4: an agent's own prior actions
 * are not evidence for its own private hidden-world posterior.
 *
 * The exclusion is per BALLOT, not per record. A vote reveal is a table-level
 * event carrying everyone's vote, so dropping the whole record because the
 * viewer is in it would discard every other seat's ballot too.
 *
 * It changes nothing for a GOOD viewer, and the asymmetry is worth stating
 * because it is why this went unnoticed. `logLikelihood` prices a seat only in
 * worlds where that seat is evil, and a good viewer knows its own role, so the
 * viewer is good in every feasible world and its ballot was already skipped by
 * the alignment test. An EVIL viewer is evil in every feasible world, so its
 * own ballot was priced, and `visibleFailPower` varies across worlds with how
 * many partners it could see: the seat read its own vote back as evidence about
 * a deal it is a part of. The measured servant results this factor records were
 * taken from a good seat and are therefore unaffected.
 */
export function voteMatrixEvidence(
  view: PlayerView,
  viewerSeat: Seat,
): readonly VoteMatrixEvidence[] {
  const evidence: VoteMatrixEvidence[] = []
  const score = { good: 0, evil: 0 }
  let questCursor = 0
  for (const proposal of view.proposals) {
    // Board state as of this ballot: quests resolved strictly before it.
    while (
      questCursor < view.quests.length
      && view.quests[questCursor]!.status === 'complete'
      && view.quests[questCursor]!.num < proposal.round
    ) {
      // Narrowed by the loop guard above, and re-read here only so the union
      // discriminates for the compiler.
      const quest = view.quests[questCursor]!
      if (quest.status !== 'complete') break
      score[quest.result === 'success' ? 'good' : 'evil']! += 1
      questCursor += 1
    }
    if (proposal.outcome !== 'voted') continue
    const quest = view.quests[proposal.round - 1]
    if (!quest) continue
    const failsRequired = quest.failsRequired
    // Resolved once: it is a linear scan of the event log, the two fields below
    // want the same number, and belief inference runs per decision.
    const sourceSeq = voteRevealSeq(view, proposal.round, proposal.proposalNum)
    evidence.push({
      evidenceId: `event:${sourceSeq}:vote-matrix`,
      sourceSeq,
      round: proposal.round,
      proposalNum: proposal.proposalNum,
      team: [...proposal.team].sort((left, right) => left - right),
      failsRequired,
      votes: proposal.votes
        .filter((vote) => vote.seat !== viewerSeat)
        .map((vote) => Object.freeze({
          seat: vote.seat,
          approve: vote.vote === 'approve',
        })),
      decisiveBoard: score.good >= 2 || score.evil >= 2,
    })
  }
  return evidence
}

/**
 * How many evil seats aboard this team the given evil voter can SEE.
 *
 * Oberon is the whole reason this is world-conditioned rather than a count. It
 * knows no partners and no partner knows it, so a team that two coordinating
 * evils read as failable looks unfailable to an Oberon aboard the same team.
 */
export function visibleFailPower(
  world: HiddenWorld,
  voter: Seat,
  team: readonly Seat[],
): number {
  const roleOf = (seat: Seat) => world.roleBySeat[seat]!
  const voterIsOberon = roleOf(voter) === 'oberon'
  let seen = 0
  for (const seat of team) {
    if (seat === voter) {
      seen += 1
      continue
    }
    if (ROLE_ALIGNMENT[roleOf(seat)]! !== 'evil') continue
    // Neither side of an Oberon pairing can see the other.
    if (voterIsOberon || roleOf(seat) === 'oberon') continue
    seen += 1
  }
  return seen
}

/** Probability this evil voter approves, under the model. */
export function evilApproveProbability(
  world: HiddenWorld,
  evidence: VoteMatrixEvidence,
  voter: Seat,
): number {
  const parameters = VOTE_MATRIX_MODEL_PARAMETERS
  const canFail =
    visibleFailPower(world, voter, evidence.team) >= evidence.failsRequired
  const board = canFail ? parameters.canFail : parameters.cannotFail
  const raw = evidence.decisiveBoard ? board.decisiveBoard : board.openBoard
  const mixture = parameters.uniformMixtureWeight
  // Mixed with a coin before use, so no ballot is ever impossible under a
  // convention and one surprising vote cannot annihilate a feasible world.
  return (1 - mixture) * raw + mixture * 0.5
}

export const analyticalVoteMatrixFactor: VoteMatrixLikelihoodFactor =
  Object.freeze({
    id: 'vote-matrix',
    version: VOTE_MATRIX_FACTOR_VERSION,
    logLikelihood(world: HiddenWorld, evidence: VoteMatrixEvidence) {
      let total = 0
      for (const vote of evidence.votes) {
        if (ROLE_ALIGNMENT[world.roleBySeat[vote.seat]!] !== 'evil') continue
        const approve = evilApproveProbability(world, evidence, vote.seat)
        // No guard against a zero here, unlike quest-card-factor, and the
        // difference is real rather than an oversight: that factor reads a
        // fail-count distribution which can legitimately be zero for an
        // unsupported count, while every probability here is floored by the
        // uniform mixture at half its weight. The floor is what keeps a ballot
        // priceable, and `the mixture keeps every priced vote away from
        // certainty` in the suite is what holds it.
        total += Math.log(vote.approve ? approve : 1 - approve)
      }
      return total
    },
  })

export const VOTE_MATRIX_FACTOR_DEGRADATION = 'vote-matrix-factor-failed'

function weightedSnapshot(
  view: PlayerView,
  factor: VoteMatrixLikelihoodFactor,
): BeliefSnapshot {
  const worlds = feasibleWorlds(view)
  const evidence = voteMatrixEvidence(view, view.seat)
  if (!evidence.length) {
    // No ballot has been cast, so there is nothing to weigh and the honest
    // answer is the uniform posterior under this model's name.
    const uniform = exactBelief(view)
    return { ...uniform, modelVersion: VOTE_MATRIX_WEIGHTED_BELIEF_VERSION }
  }
  const raw = worlds.map((world) =>
    evidence.reduce(
      (sum, item) => sum + factor.logLikelihood(world, item),
      0,
    ))
  // Folded, not spread: see the note in proposal-factor.ts.
  let best = -Infinity
  for (const value of raw) if (value > best) best = value
  const capped = raw.map((value) =>
    capLogLikelihood(value - best, VOTE_MATRIX_LOG_LIKELIHOOD_CAP).value)
  return beliefFromWeightedWorlds(
    view,
    normalizeLogWeights(worlds, capped),
    {
      modelVersion: VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
      quality: 'weighted',
      provenance: [
        buildFactorProvenance(
          factor,
          evidence.map((item) => item.evidenceId),
          VOTE_MATRIX_LOG_LIKELIHOOD_CAP,
          capped,
        ),
      ],
    },
  )
}

export function createVoteMatrixWeightedBeliefModel(
  factor: VoteMatrixLikelihoodFactor = analyticalVoteMatrixFactor,
): BeliefModel {
  return Object.freeze({
    version: VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
    factorsVersion: VOTE_MATRIX_BUNDLE_VERSION,
    infer(view: PlayerView): BeliefSnapshot {
      try {
        return weightedSnapshot(view, factor)
      } catch (error) {
        const fallback = exactBelief(view)
        return {
          ...fallback,
          modelVersion: VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
          quality: 'degraded',
          degradation: [
            VOTE_MATRIX_FACTOR_DEGRADATION,
            error instanceof Error ? error.message : String(error),
          ],
        }
      }
    },
  })
}

export const voteMatrixWeightedBeliefModel =
  createVoteMatrixWeightedBeliefModel()
