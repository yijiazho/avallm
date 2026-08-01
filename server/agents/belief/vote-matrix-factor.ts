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
// THAT LAST SENTENCE IS MEASURABLY FALSE, and it is the largest known
// improvement available to this factor.
//
// The cancellation argument needs good voters to behave the same way in every
// world. Checked against Avalon-NLU (20 annotated six-player human games with
// ground-truth roles, MIT licensed, github.com/sstepput/Avalon-NLU), 464 ballots,
// as a one-off offline read:
//
//   evil voter, team it can fail   79.4% approve   |  odds ratio 4.19
//   evil voter, team it cannot     47.9% approve   |  (this model prices ~5.6)
//   good voter, team seating evil  59.2% approve   |  odds ratio 0.11
//   good voter, clean team         92.7% approve   |  (this model assumes 1.00)
//
// The evil asymmetry is confirmed and the authored parameters land close to the
// observed size, which is the good news. But a good voter's approval rate is
// world-DEPENDENT: whether the team is clean is a property of the world, so a
// good vote is not a constant and does not cancel. It is being discarded, not
// cancelled, and it is the larger of the two signals.
//
// Not a Merlin artifact, which was the obvious objection. Splitting by role,
// servants alone give 66.9% against 91.7% (odds ratio 0.18) and Percival the
// same 0.18; Merlin is perfect, as it should be. Seats that genuinely do not
// know still discriminate strongly.
//
// This also revisits BELIEF-001's v1-versus-v2 history directly. v2 modelled
// both sides of the asymmetry and lost to v1 on the heuristic corpus, and the
// tracker's standing note was that v2 had been penalized for modelling play
// correctly against an opponent that does not play that way. The human data
// supports that reading rather than the bot-corpus verdict.
//
// Caveats: 20 games, one research-study population, six players, so no Oberon
// or Mordred visibility asymmetry and no two-Fail quest, which is exactly the
// dimension `visibleFailPower` exists for. This is direction and rough
// magnitude, not calibration.
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
/**
 * v2 adds good-vote pricing. Named `-good-v2` rather than `-v2` on purpose: an
 * earlier, different v2 built on the off-team feature was reverted, and a bare
 * `v2` in a trace would be ambiguous with it forever.
 */
export const VOTE_MATRIX_FACTOR_V2_VERSION = 'analytical-vote-matrix-good-v2'
export const VOTE_MATRIX_BUNDLE_V2_VERSION = 'vote-matrix-good-only-v2'
export const VOTE_MATRIX_WEIGHTED_BELIEF_V2_VERSION =
  'exact-constraints+vote-matrix-good-v2'
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

/**
 * v2 only: how a GOOD seat votes, which v1 leaves unpriced.
 *
 * Conditioned on how many quests have resolved, because a good player's
 * discrimination is not a constant, it is bought with information. On the human
 * corpus the odds ratio between approving a dirty team and a clean one runs
 * `0.65`, `0.23`, `0.13`, `0.05`, `0.03` across quests one to five: at the
 * opening a good seat cannot tell and approves nearly everything, and by the
 * last quest it is refusing dirty teams three times in four. A flat parameter
 * would credit an opening ballot nobody could have informed.
 *
 * Approval of a CLEAN team is flat by contrast, `89%` to `95%` across the whole
 * game, so it is one number. Good players do not become reluctant in general,
 * they become better at spotting dirt.
 *
 * These are deliberately WEAKER than observed. The corpus is 20 games, which
 * licenses a direction and a rough shape, not a magnitude, so each dirty-team
 * entry is shrunk toward the clean rate. Under-crediting a real signal costs
 * accuracy; over-crediting a signal fitted to 20 games costs correctness.
 */
export const VOTE_MATRIX_GOOD_PARAMETERS = Object.freeze({
  /** Approving a team that is clean in this world. Flat across the game. */
  cleanTeam: 0.92,
  /**
   * Approving a team that is dirty IN THIS WORLD, by resolved-quest count.
   * Index 3 covers three or more.
   *
   * Index 0 equals `cleanTeam` exactly, so an opening ballot contributes
   * nothing. That is the honest reading of a seat with no information rather
   * than a rounding choice: the corpus shows a `0.65` odds ratio there, which
   * is the weakest cell and the one most likely to be noise, and a factor that
   * claims to read a vote nobody could have informed is claiming to read the
   * dealer.
   */
  dirtyTeamByResolvedQuests: Object.freeze([0.92, 0.78, 0.62, 0.52]),
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
  /**
   * Quests resolved before this ballot. Public, so world-invariant, and it is
   * how much a good seat could possibly know when it voted. v2 reads it; v1
   * ignores it, which is why adding it does not change v1's output.
   */
  resolvedQuests: number
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
      resolvedQuests: score.good + score.evil,
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

/**
 * Probability a GOOD voter approves, under v2, given the world.
 *
 * World-dependent because whether the team is dirty is a property of the world,
 * which is the whole reason this term does not cancel the way v1 assumed.
 * Nothing here models the voter's REASONING, which was v1's stated objection
 * and remains a good objection: this is an observed behavioural regularity
 * conditioned on public context, exactly the shape the evil half already uses.
 */
export function goodApproveProbability(
  world: HiddenWorld,
  evidence: VoteMatrixEvidence,
): number {
  const parameters = VOTE_MATRIX_GOOD_PARAMETERS
  const dirty = evidence.team.some(
    (seat) => ROLE_ALIGNMENT[world.roleBySeat[seat]!] === 'evil',
  )
  const table = parameters.dirtyTeamByResolvedQuests
  const raw = dirty
    ? table[Math.min(evidence.resolvedQuests, table.length - 1)]!
    : parameters.cleanTeam
  const mixture = VOTE_MATRIX_MODEL_PARAMETERS.uniformMixtureWeight
  return (1 - mixture) * raw + mixture * 0.5
}

/**
 * v2: the same evil asymmetry, plus the good votes v1 discards.
 *
 * NOT the earlier reverted v2, and the distinction matters enough to state
 * here. That one priced the brief's OFF-TEAM feature, approval of teams the
 * voter is not on, and it lost to v1 on the heuristic corpus. Its revert was
 * then corrected on the argument that our heuristic does not follow the
 * round-one rejection convention, so v2 had been penalized for modelling humans
 * correctly. Human games say otherwise on both counts: off-team approval runs
 * `62.4%` for good against `51.7%` for evil, an odds ratio of `0.64` where that
 * feature needs it well above one, and good approves the first proposal `93.8%`
 * of the time, which is what `decideVote` already hard-codes. The off-team
 * feature is not supported by the only human population we have, and this
 * version does not use it.
 *
 * What this prices instead is the one asymmetry that corpus does support, and
 * supports strongly: a good seat's approval discriminates on whether the team
 * is actually dirty, weakly at the opening and sharply once quests resolve.
 *
 * MEASURED, AND IT DOES NOT BEAT v1 ON EITHER BOT POPULATION.
 *
 * Held-out servant proposals, only the belief changed, 200 seeds per cast.
 *
 *   heuristic corpus, 2039 decisions
 *     base   81.1% dirty   1.126 evil per team
 *     v1     50.9%         0.737
 *     v2     52.1%         0.682
 *
 *   random corpus, 2297 decisions
 *     base   74.2% dirty   0.996 evil per team
 *     v1     73.7%         0.998   (paired -0.57 points, p = 0.59, null)
 *     v2     75.6%         1.003   (paired +1.35 points, p = 0.16, null)
 *
 * The heuristic result splits: v2 is `1.2` points worse on dirty rate and
 * `0.055` better on evil per team, which is the POLICY-002 target quantity and
 * the one where both versions already beat the compatibility heuristic's
 * `0.923`. Those two metrics disagree because they measure different things, a
 * team holding ANY evil against the COUNT of evil aboard, and nothing here
 * decides which matters more. The v1-versus-v2 difference is also not tested:
 * each arm is paired against the base, not against the other, so `50.9` against
 * `52.1` is a comparison of two effects and not a measured contrast.
 *
 * On the random corpus v2 is directionally worse than doing nothing. That is
 * the expected shape rather than a surprise: random seats do not vote
 * purposefully, so good approval carries no cleanliness signal there and this
 * model prices one that is not present. It is a population mismatch of exactly
 * the kind §3.3 anticipates, and it is why the model degrades to noise rather
 * than to harm.
 *
 * Cap saturation was the hazard I expected from tripling the priced ballots,
 * and it is not one. Measured over 152 decisions on eight seeded seven-player
 * games, v1 clamps `0.833` of worlds at the cap and v2 `0.821`, so the added
 * evidence is not being spent flattening the posterior. That was measured once
 * rather than left as a standing test: a capped factor moves ENTROPY by about
 * `0.0016` bits out of `9.27` while moving dirty-team rate by thirty points, so
 * no entropy-shaped assertion can express the invariant, and the honest guard
 * is the decision-quality measurement above.
 *
 * A THIRD POPULATION SEPARATES THEM, AND IT FAVOURS v2.
 *
 * The two bot corpora above cannot settle a vote factor for opposite reasons,
 * so `servant-propose-calibration` gained a composed opponent table: good seats
 * that vote from an exact posterior, which is purposeful, and derived from the
 * game's structure rather than from a convention or from the human corpus.
 * Opponents are pinned to `full-role`'s seated quest-card belief, so the arm
 * never faces itself. On 1713 held-out decisions:
 *
 *   composed corpus, base 78.4% dirty and 1.069 evil per team
 *     v1   80.2%   1.169   paired +1.81 points, p = 0.11, null
 *     v2   59.8%   0.798   paired -18.62 points, p = 1.5e-63
 *
 * v1 does NOTHING against an opponent it did not have hard-coded, and that is
 * the second half of the finding. `decideVote`'s evil branch reads
 * `if (aboard >= failsNeeded) return approve`, which is v1's entire model
 * written as a deterministic rule. Its 30-point result on the heuristic corpus
 * is therefore circular in exactly the way the proposal factor's was, and this
 * is the first measurement able to show that.
 *
 * v2's good half, whose parameters came from human games, transfers to a
 * population built from Bayesian inference rather than from those games. Two
 * independent origins converging on "good seats avoid teams they believe are
 * dirty" is evidence rather than construction. The honest scope: v2 works
 * against opponents whose good seats vote on inferred cleanliness. Humans do
 * (measured), composed agents do (by construction), the heuristic does
 * partially through `suspicion()`, and random play does not, which is the whole
 * spread of results above in one sentence.
 *
 * Still unseated. A factor is a whole BeliefModel and quest-card holds that
 * slot, so seating this is not a configuration change, and one non-circular
 * population is a strong signal rather than a promotion.
 */
export const analyticalVoteMatrixFactorV2: VoteMatrixLikelihoodFactor =
  Object.freeze({
    id: 'vote-matrix',
    version: VOTE_MATRIX_FACTOR_V2_VERSION,
    logLikelihood(world: HiddenWorld, evidence: VoteMatrixEvidence) {
      let total = 0
      for (const vote of evidence.votes) {
        const evil = ROLE_ALIGNMENT[world.roleBySeat[vote.seat]!] === 'evil'
        const approve = evil
          ? evilApproveProbability(world, evidence, vote.seat)
          : goodApproveProbability(world, evidence)
        total += Math.log(vote.approve ? approve : 1 - approve)
      }
      return total
    },
  })

export const VOTE_MATRIX_FACTOR_DEGRADATION = 'vote-matrix-factor-failed'

function weightedSnapshot(
  view: PlayerView,
  factor: VoteMatrixLikelihoodFactor,
  beliefVersion: string,
): BeliefSnapshot {
  const worlds = feasibleWorlds(view)
  const evidence = voteMatrixEvidence(view, view.seat)
  if (!evidence.length) {
    // No ballot has been cast, so there is nothing to weigh and the honest
    // answer is the uniform posterior under this model's name.
    const uniform = exactBelief(view)
    return { ...uniform, modelVersion: beliefVersion }
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
      modelVersion: beliefVersion,
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
  versions: { belief: string; bundle: string } = {
    belief: VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
    bundle: VOTE_MATRIX_BUNDLE_VERSION,
  },
): BeliefModel {
  return Object.freeze({
    version: versions.belief,
    factorsVersion: versions.bundle,
    infer(view: PlayerView): BeliefSnapshot {
      try {
        return weightedSnapshot(view, factor, versions.belief)
      } catch (error) {
        const fallback = exactBelief(view)
        return {
          ...fallback,
          modelVersion: versions.belief,
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

/** v2, kept beside v1 so the two remain independently measurable arms. */
export const voteMatrixGoodWeightedBeliefModel =
  createVoteMatrixWeightedBeliefModel(analyticalVoteMatrixFactorV2, {
    belief: VOTE_MATRIX_WEIGHTED_BELIEF_V2_VERSION,
    bundle: VOTE_MATRIX_BUNDLE_V2_VERSION,
  })
