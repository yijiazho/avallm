// Conservative analytical weighting from public quest-card outcomes.
//
// Hard feasibility remains authoritative. This factor only reweights worlds
// that exact constraints already permit, and its entire history contribution
// is capped so it can never overwhelm role or Fail-count facts.

import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { PlayerView, Role, Seat } from '../../engine/types.ts'
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

export const QUEST_CARD_FACTOR_VERSION = 'analytical-quest-card-v1'
export const QUEST_FACTOR_BUNDLE_VERSION = 'quest-card-only-v1'
export const QUEST_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+quest-card-v1'
export const QUEST_FACTOR_LOG_LIKELIHOOD_CAP = Math.log(2)

/**
 * The model itself: every probability this factor prices, in one place.
 *
 * These are **analytical conventions, not measured frequencies**. Nothing in
 * `docs/` reports a fit to human or model play; the migration record calls them
 * "hand-authored likelihoods" and notes that the held-out calibration win was a
 * sensitivity check rather than evidence that the numbers describe anybody's
 * actual behavior. Read each entry as "how a conservative observer prices this
 * situation", not as an estimate.
 *
 * Every entry is a per-evil-player probability of placing a Fail on one quest,
 * except the two mixture knobs at the bottom. Keys name the situation being
 * priced: an evil role, how many Fails the quest needs, whether the board is
 * decisive (either side one quest from winning), the opening quest versus any
 * later one, and whether two or more non-Oberon evils are aboard and can
 * therefore coordinate.
 *
 * Safety rail: the whole factor's contribution to any world is clamped by
 * `QUEST_FACTOR_LOG_LIKELIHOOD_CAP`, so no combination of these numbers can
 * overwhelm hard feasibility or the Fail-count facts. They redistribute
 * probability inside the feasible set and nothing more.
 *
 * Changing any value changes belief output for every seat that runs this
 * factor, so treat an edit as a new model: bump `QUEST_CARD_FACTOR_VERSION`
 * (and the derived bundle/belief versions) in the same change. The pinning
 * assertion in `test/quest-factor.test.ts` is what makes a silent retune fail
 * the suite.
 */
export const QUEST_CARD_MODEL_PARAMETERS = Object.freeze({
  /**
   * Oberon has no partners to read and no one reading him, so he plays his own
   * card on his own account whatever the rest of the table is doing.
   */
  oberonAboard: Object.freeze({
    decisiveBoard: 0.95,
    openBoard: 0.85,
  }),
  /**
   * Quests needing two Fails. Without two coordinating non-Oberon evils a Fail
   * is close to wasted, so it is rare; with coordination it is the whole point
   * of being aboard.
   */
  twoFailsRequired: Object.freeze({
    uncoordinated: 0.08,
    coordinatedDecisiveBoard: 0.9,
    coordinatedOpenBoard: 0.72,
  }),
  /**
   * One evil aboard a one-Fail quest. Nobody can cover for a slow play, so the
   * only restraint is wanting to stay unread, and a decisive board removes even
   * that. Quest 1 is the cheapest place to buy cover.
   */
  loneEvilAboard: Object.freeze({
    decisiveBoard: 0.88,
    firstQuest: 0.35,
    laterQuest: 0.65,
  }),
  /**
   * Several evils aboard a one-Fail quest. Each individual is likelier to hold
   * back, since a partner can carry the Fail and a double Fail burns the team's
   * cover for nothing.
   */
  multipleEvilAboard: Object.freeze({
    decisiveBoard: 0.62,
    firstQuest: 0.25,
    laterQuest: 0.5,
  }),
  /**
   * Reweighting applied to the "exactly one Fail" outcome when known partners
   * are aboard a one-Fail quest, before renormalization. Independent Bernoulli
   * draws understate how often coordinated evils place exactly one card.
   */
  coordinatedSingleFailBoost: 1.5,
  /**
   * Uniform mixture folded into the final distribution so no legal public card
   * pattern is ever assigned probability zero by a convention.
   */
  uniformMixtureWeight: 0.05,
})

export interface QuestCardEvidence {
  evidenceId: string
  sourceSeq: number
  questNum: number
  team: readonly Seat[]
  failCount: number
  failsRequired: number
  scoreBefore: Readonly<{ good: number; evil: number }>
}

export type QuestCardLikelihoodFactor =
  LikelihoodFactor<QuestCardEvidence, 'quest-card'>

function questResultSeq(view: PlayerView, questNum: number): number {
  const event = view.events.find(
    (candidate) =>
      candidate.type === 'questResult'
      && candidate.payload.round === questNum,
  )
  if (!event) {
    throw new Error(`resolved quest ${questNum} has no visible quest-result event`)
  }
  return event.seq
}

export function questCardEvidence(
  view: PlayerView,
): readonly QuestCardEvidence[] {
  const score = { good: 0, evil: 0 }
  const evidence: QuestCardEvidence[] = []
  for (const quest of [...view.quests].sort((left, right) => left.num - right.num)) {
    if (quest.status !== 'complete') continue
    const sourceSeq = questResultSeq(view, quest.num)
    evidence.push({
      evidenceId: `event:${sourceSeq}:quest-card`,
      sourceSeq,
      questNum: quest.num,
      team: [...quest.team].sort((left, right) => left - right),
      failCount: quest.failCount,
      failsRequired: quest.failsRequired,
      scoreBefore: { ...score },
    })
    score[quest.result === 'success' ? 'good' : 'evil']++
  }
  return evidence
}

function convolveBernoulli(probabilities: readonly number[]): number[] {
  let distribution = [1]
  for (const probability of probabilities) {
    const next = Array<number>(distribution.length + 1).fill(0)
    for (let count = 0; count < distribution.length; count++) {
      next[count]! += distribution[count]! * (1 - probability)
      next[count + 1]! += distribution[count]! * probability
    }
    distribution = next
  }
  return distribution
}

function failProbability(
  role: Role,
  evilCount: number,
  coordinatedNonOberon: boolean,
  evidence: QuestCardEvidence,
): number {
  const parameters = QUEST_CARD_MODEL_PARAMETERS
  const decisive =
    evidence.scoreBefore.good === 2 || evidence.scoreBefore.evil === 2
  if (role === 'oberon') {
    return decisive
      ? parameters.oberonAboard.decisiveBoard
      : parameters.oberonAboard.openBoard
  }
  if (evidence.failsRequired === 2) {
    if (!coordinatedNonOberon) return parameters.twoFailsRequired.uncoordinated
    return decisive
      ? parameters.twoFailsRequired.coordinatedDecisiveBoard
      : parameters.twoFailsRequired.coordinatedOpenBoard
  }
  // Deliberate: `evilCount` counts every evil seat aboard, Oberon included, so
  // a lone Morgana beside an unseen Oberon is priced on the multi-evil branch
  // even though the two cannot coordinate. The two axes are separate on
  // purpose (see docs/agent-architecture-migration.md, Phase 5B record, which
  // lists "evil count aboard" and "non-Oberon coordination" as distinct
  // contextual inputs): coordination decides whether partners can divide the
  // work, while the raw count decides how much Fail pressure the quest is
  // already under. A second evil aboard raises the chance the quest fails
  // without this seat's card whether or not this seat knows about it, and the
  // observer doing the pricing does not know which world it is in either. If
  // that argument ever stops convincing, the branch to reach for is
  // `nonOberonCount === 1` rather than `evilCount === 1`, and the evidence that
  // would settle it is a paired held-out calibration run over Oberon casts
  // (7 and 10 player) with `server/eval/quest-factor-bench.ts`: swap the branch,
  // rerun both arms, and keep the variant with the better Brier and log loss.
  if (evilCount === 1) {
    if (decisive) return parameters.loneEvilAboard.decisiveBoard
    return evidence.questNum === 1
      ? parameters.loneEvilAboard.firstQuest
      : parameters.loneEvilAboard.laterQuest
  }
  if (decisive) return parameters.multipleEvilAboard.decisiveBoard
  return evidence.questNum === 1
    ? parameters.multipleEvilAboard.firstQuest
    : parameters.multipleEvilAboard.laterQuest
}

/**
 * Transparent fail-count distribution before the global factor cap. A small
 * uniform mixture prevents an analytical convention from assigning zero
 * probability to a legal observed card pattern.
 */
export function questFailCountDistribution(
  world: HiddenWorld,
  evidence: QuestCardEvidence,
): readonly number[] {
  const evilRoles = evidence.team
    .map((seat) => world.roleBySeat[seat])
    .filter(
      (role): role is NonNullable<typeof role> =>
        role !== undefined && ROLE_ALIGNMENT[role] === 'evil',
    )
  if (!evilRoles.length) return [1]
  const nonOberonCount = evilRoles.filter((role) => role !== 'oberon').length
  const coordinatedNonOberon = nonOberonCount >= 2
  const probabilities = evilRoles.map((role) =>
    failProbability(
      role,
      evilRoles.length,
      coordinatedNonOberon,
      evidence,
    ))
  const raw = convolveBernoulli(probabilities)
  if (evidence.failsRequired === 1 && coordinatedNonOberon && raw.length > 1) {
    // Known partners commonly try to place one Fail rather than doubling.
    raw[1]! *= QUEST_CARD_MODEL_PARAMETERS.coordinatedSingleFailBoost
  }
  const total = raw.reduce((sum, probability) => sum + probability, 0)
  const smoothing = QUEST_CARD_MODEL_PARAMETERS.uniformMixtureWeight
  return raw.map(
    (probability) =>
      (1 - smoothing) * probability / total
      + smoothing / raw.length,
  )
}

export const analyticalQuestCardFactor: QuestCardLikelihoodFactor =
  Object.freeze({
    id: 'quest-card',
    version: QUEST_CARD_FACTOR_VERSION,
    logLikelihood(world: HiddenWorld, evidence: QuestCardEvidence) {
      const distribution = questFailCountDistribution(world, evidence)
      const probability = distribution[evidence.failCount]
      if (probability === undefined || probability <= 0) {
        throw new Error(
          `quest ${evidence.questNum}: unsupported fail count ${evidence.failCount}`,
        )
      }
      return Math.log(probability)
    },
  })

function weightedSnapshot(
  view: PlayerView,
  factor: QuestCardLikelihoodFactor,
): BeliefSnapshot {
  const worlds = feasibleWorlds(view)
  const evidence = questCardEvidence(view)
  if (!evidence.length) {
    const uniform = exactBelief(view)
    return {
      ...uniform,
      modelVersion: QUEST_WEIGHTED_BELIEF_VERSION,
    }
  }
  const raw = worlds.map((world) =>
    evidence.reduce(
      (sum, item) => sum + factor.logLikelihood(world, item),
      0,
    ))
  // Folded, not spread: see the note in proposal-factor.ts. One argument per
  // world against a stack-sized ceiling, and this factor is the seated one, so
  // it is the copy that would degrade a real game if the margin ever closed.
  let best = -Infinity
  for (const value of raw) if (value > best) best = value
  const capped = raw.map((value) =>
    capLogLikelihood(
      value - best,
      QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
    ).value)
  const weighted = normalizeLogWeights(worlds, capped)
  return beliefFromWeightedWorlds(view, weighted, {
    modelVersion: QUEST_WEIGHTED_BELIEF_VERSION,
    quality: 'weighted',
    provenance: [
      buildFactorProvenance(
        factor,
        evidence.map((item) => item.evidenceId),
        QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
        capped,
      ),
    ],
  })
}

/**
 * Stable code every consumer matches on. `docs/design-implementation.md` names
 * it, and admission and eval paths look for exactly this token, so it stays the
 * first entry of `degradation` no matter what else is appended.
 */
export const QUEST_CARD_FACTOR_DEGRADATION = 'quest-card-factor-failed'

/** Prefix of the optional second entry carrying the failure detail. */
export const QUEST_CARD_FACTOR_DETAIL_PREFIX = 'quest-card-factor-detail:'

/** Cap on the whole detail entry, prefix included. */
export const QUEST_CARD_FACTOR_DETAIL_MAX_LENGTH = 160

/**
 * Bounded, house-style diagnosis of a factor failure.
 *
 * Without this, an unsupported Fail count, a normalization error, and an
 * outright programming bug all collapse into one opaque token and a real
 * regression hides as a quiet belief-quality drop.
 *
 * The message is treated as untrusted: it is flattened to single-line printable
 * ASCII, dashes are normalized to a hyphen so the text cannot smuggle an
 * em-dash or en-dash into any surface that renders it, and the result is length
 * capped so no stack trace can ride along. It carries only the error class and
 * message, never a world, a role, or a seat, so it cannot leak private state.
 */
function factorFailureDetail(error: unknown): string {
  const described = error instanceof Error
    ? `${error.name}: ${error.message}`
    : `non-error thrown: ${typeof error}`
  const cleaned = described
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const budget =
    QUEST_CARD_FACTOR_DETAIL_MAX_LENGTH - QUEST_CARD_FACTOR_DETAIL_PREFIX.length
  const bounded = cleaned.length > budget
    ? `${cleaned.slice(0, budget - 3)}...`
    : cleaned
  return `${QUEST_CARD_FACTOR_DETAIL_PREFIX}${bounded || 'no message'}`
}

export function createQuestWeightedBeliefModel(
  factor: QuestCardLikelihoodFactor = analyticalQuestCardFactor,
): BeliefModel {
  return Object.freeze({
    version: QUEST_WEIGHTED_BELIEF_VERSION,
    factorsVersion: QUEST_FACTOR_BUNDLE_VERSION,
    infer(view: PlayerView): BeliefSnapshot {
      try {
        return weightedSnapshot(view, factor)
      } catch (error) {
        const fallback = exactBelief(view)
        const degraded: BeliefSnapshot = {
          ...fallback,
          modelVersion: QUEST_WEIGHTED_BELIEF_VERSION,
          quality: 'degraded',
          degradation: [
            QUEST_CARD_FACTOR_DEGRADATION,
            factorFailureDetail(error),
          ],
        }
        return degraded
      }
    },
  })
}

export const questWeightedBeliefModel = createQuestWeightedBeliefModel()
