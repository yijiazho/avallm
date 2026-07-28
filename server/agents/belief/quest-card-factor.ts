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
import type {
  BeliefModel,
  BeliefSnapshot,
  HiddenWorld,
} from './types.ts'
import {
  capLogLikelihood,
  normalizeLogWeights,
} from './weighting.ts'

export const QUEST_CARD_FACTOR_VERSION = 'analytical-quest-card-v1'
export const QUEST_FACTOR_BUNDLE_VERSION = 'quest-card-only-v1'
export const QUEST_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+quest-card-v1'
export const QUEST_FACTOR_LOG_LIKELIHOOD_CAP = Math.log(2)

export interface QuestCardEvidence {
  evidenceId: string
  sourceSeq: number
  questNum: number
  team: readonly Seat[]
  failCount: number
  failsRequired: number
  scoreBefore: Readonly<{ good: number; evil: number }>
}

export interface QuestCardLikelihoodFactor {
  id: 'quest-card'
  version: string
  logLikelihood(
    world: HiddenWorld,
    evidence: QuestCardEvidence,
  ): number
}

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
    if (
      quest.result === undefined
      || quest.failCount === undefined
      || quest.team === undefined
    ) {
      continue
    }
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
      next[count] += distribution[count] * (1 - probability)
      next[count + 1] += distribution[count] * probability
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
  const decisive =
    evidence.scoreBefore.good === 2 || evidence.scoreBefore.evil === 2
  if (role === 'oberon') return decisive ? 0.95 : 0.85
  if (evidence.failsRequired === 2) {
    if (!coordinatedNonOberon) return 0.08
    return decisive ? 0.9 : 0.72
  }
  if (evilCount === 1) {
    if (decisive) return 0.88
    return evidence.questNum === 1 ? 0.35 : 0.65
  }
  if (decisive) return 0.62
  return evidence.questNum === 1 ? 0.25 : 0.5
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
    .filter((role) => ROLE_ALIGNMENT[role] === 'evil')
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
    raw[1] *= 1.5
  }
  const total = raw.reduce((sum, probability) => sum + probability, 0)
  const smoothing = 0.05
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
  const best = Math.max(...raw)
  const capped = raw.map((value) =>
    capLogLikelihood(
      value - best,
      QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
    ).value)
  const weighted = normalizeLogWeights(worlds, capped)
  return beliefFromWeightedWorlds(view, weighted, {
    modelVersion: QUEST_WEIGHTED_BELIEF_VERSION,
    quality: 'weighted',
    provenance: [{
      factorId: factor.id,
      factorVersion: factor.version,
      evidenceIds: evidence.map((item) => item.evidenceId),
      logLikelihoodCap: QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
      minLogLikelihood: Math.min(...capped),
      maxLogLikelihood: Math.max(...capped),
    }],
  })
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
      } catch {
        const fallback = exactBelief(view)
        const degraded: BeliefSnapshot = {
          ...fallback,
          modelVersion: QUEST_WEIGHTED_BELIEF_VERSION,
          quality: 'degraded',
          degradation: ['quest-card-factor-failed'],
        }
        return degraded
      }
    },
  })
}

export const questWeightedBeliefModel = createQuestWeightedBeliefModel()
