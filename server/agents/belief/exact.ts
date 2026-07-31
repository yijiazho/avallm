import { evilPartnersOf, knownEvilOf, merlinCandidatesOf } from '../../engine/knowledge.ts'
import type { PlayerView, Role, Seat } from '../../engine/types.ts'
import {
  worldSatisfiesQuestRecord,
  worldSatisfiesView,
  type ConstraintOptions,
} from './constraints.ts'
import {
  DEFAULT_TOP_WORLD_LIMIT,
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
  type BeliefModel,
  type EvidenceContribution,
  type HiddenWorld,
  type PlayerMarginal,
  type RoleMarginal,
  type WeightedWorld,
} from './types.ts'
import {
  canonicalRoleMultiset,
  compareWorldKeys,
  enumerateCanonicalWorlds,
} from './worlds.ts'
import { projectUniformJointWorlds } from './projection.ts'
import { assertDistribution } from './invariants.ts'
import { LruMap } from '../../shared/lru.ts'
import {
  addProbability,
  clampProbability,
  compensatedSum,
  type CompensatedProbability,
} from '../canonical/probability-arithmetic.ts'

// Keyed on the per-seat private view (role, alignment, and private knowledge),
// not just the public cast, so this space is far wider than worlds.ts's
// CACHE_LIMIT=4 assignment cache and holds proportionally more entries.
const DEAL_CACHE_LIMIT = 32
const dealWorldCache = new LruMap<string, readonly HiddenWorld[]>(DEAL_CACHE_LIMIT)

// View-generic (the max event seq of any PlayerView), not belief-specific. It
// lives here because belief is its earliest consumer and the analysis, policy,
// cognition, and eval layers already import it from this module; there is no
// dedicated view-util home that would not invert the dependency direction.
export function visibleEventCursor(view: PlayerView): number {
  return view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1)
}

function dealCacheKey(view: PlayerView): string {
  const privateInfo = [
    ...knownEvilOf(view.privateInfo).map((seat) => `m${seat}`),
    ...evilPartnersOf(view.privateInfo).map((seat) => `e${seat}`),
    ...merlinCandidatesOf(view.privateInfo).map((seat) => `p${seat}`),
  ].join(',')
  return [
    canonicalRoleMultiset(view.rolesInPlay).join('|'),
    view.playerCount,
    view.seat,
    view.role,
    view.alignment,
    privateInfo,
  ].join(';')
}

function dealWorlds(view: PlayerView): readonly HiddenWorld[] {
  const key = dealCacheKey(view)
  const found = dealWorldCache.get(key)
  if (found) return found
  const candidates = enumerateCanonicalWorlds(
    { playerCount: view.playerCount, rolesInPlay: view.rolesInPlay },
    { seat: view.seat, role: view.role },
  )
  const worlds = candidates.filter((world) =>
    worldSatisfiesView(view, world, { questRecord: 'none' }))
  if (worlds.length === 0) failNoWorlds(view, 'none')
  dealWorldCache.set(key, worlds)
  return worlds
}

function failNoWorlds(view: PlayerView, record: ConstraintOptions['questRecord']): never {
  throw new Error(
    `exact belief ${EXACT_BELIEF_MODEL_VERSION} found no feasible worlds `
    + `for seat ${view.seat} (${view.role}), questRecord=${record ?? 'all'}`,
  )
}

export function feasibleWorlds(
  view: PlayerView,
  options: ConstraintOptions = {},
): readonly HiddenWorld[] {
  const candidates = dealWorlds(view)
  if (options.questRecord === 'none') return candidates
  const worlds = candidates.filter((world) => worldSatisfiesQuestRecord(view, world, options))
  if (worlds.length === 0) failNoWorlds(view, options.questRecord)
  return worlds
}

function uniformWeights(worlds: readonly HiddenWorld[]): readonly WeightedWorld[] {
  const probability = 1 / worlds.length
  return worlds.map((world) => ({ world, probability }))
}

/**
 * True when every world carries the same weight, which selects the exact
 * counting paths over the weighted-sum ones. An empty list reads as uniform;
 * that is unreachable here, since every snapshot originates from
 * beliefFromWeightedWorlds (which rejects empty input and always keeps at
 * least one positive world) or from validateBelief in identity.ts (which
 * rejects an empty world list at the host-input boundary).
 */
export function weightsAreUniform(worlds: readonly WeightedWorld[]): boolean {
  const first = worlds[0]?.probability
  return worlds.every((weightedWorld) => weightedWorld.probability === first)
}

/**
 * Reduce an accumulated marginal to a probability, snapping certainty to exactly
 * 1. Summing normalized non-uniform weights lands a few ULPs short, and
 * consumers read certainty by strict equality: the calibration bench
 * (server/eval/quest-factor-bench.ts) drops degenerate rows with
 * `evilProbability === 1`, and its uniform counterpart divides counts in
 * projection.ts, so dropping this snap would leave the paired uniform/weighted
 * variants silently filtering different row sets.
 */
function snapProbability(
  sum: number,
  matchingWorlds: number,
  totalWorlds: number,
): number {
  return matchingWorlds === totalWorlds ? 1 : clampProbability(sum)
}

function playerMarginals(
  worlds: readonly WeightedWorld[],
  playerCount: number,
): readonly PlayerMarginal[] {
  return Array.from({ length: playerCount }, (_, seat) => {
    let evilProbability = 0
    let evilWorlds = 0
    for (const weightedWorld of worlds) {
      if (weightedWorld.world.alignmentBySeat[seat] === 'evil') {
        evilWorlds++
        evilProbability += weightedWorld.probability
      }
    }
    evilProbability = snapProbability(evilProbability, evilWorlds, worlds.length)
    return {
      seat,
      goodProbability: 1 - evilProbability,
      evilProbability,
    }
  })
}

function roleMarginals(
  worlds: readonly WeightedWorld[],
  rolesInPlay: readonly Role[],
  playerCount: number,
): readonly RoleMarginal[] {
  const roles = [...new Set(canonicalRoleMultiset(rolesInPlay))]
  const out: RoleMarginal[] = []
  for (let seat = 0; seat < playerCount; seat++) {
    for (const role of roles) {
      let probability = 0
      let matchingWorlds = 0
      for (const weightedWorld of worlds) {
        if (weightedWorld.world.roleBySeat[seat] === role) {
          matchingWorlds++
          probability += weightedWorld.probability
        }
      }
      probability = snapProbability(probability, matchingWorlds, worlds.length)
      out.push({ seat, role, probability })
    }
  }
  return out
}

// Postcondition for every snapshot beliefFromWeightedWorlds emits: the world
// weights, each seat's alignment split, and each seat's role spread are all
// distributions. Checking the emitted object (not the intermediate arrays) means
// the guard covers both projection sources, the uniform kernel and the local
// fallbacks, from one place. A violation is a normalization bug in this module,
// so it throws rather than degrading a knowingly corrupt posterior downstream.
function assertSnapshotDistributions(snapshot: BeliefSnapshot): void {
  assertDistribution(
    snapshot.worlds.map((weightedWorld) => weightedWorld.probability),
    'belief world distribution',
  )
  for (const marginal of snapshot.playerMarginals) {
    assertDistribution(
      [marginal.goodProbability, marginal.evilProbability],
      `seat ${marginal.seat} alignment marginal`,
    )
  }
  const roleProbabilitiesBySeat = new Map<Seat, number[]>()
  for (const marginal of snapshot.roleMarginals) {
    const bucket = roleProbabilitiesBySeat.get(marginal.seat) ?? []
    bucket.push(marginal.probability)
    roleProbabilitiesBySeat.set(marginal.seat, bucket)
  }
  for (const [seat, probabilities] of roleProbabilitiesBySeat) {
    assertDistribution(probabilities, `seat ${seat} role marginal`)
  }
}

export function topWorlds(
  worlds: readonly WeightedWorld[],
  limit = DEFAULT_TOP_WORLD_LIMIT,
): readonly WeightedWorld[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`invalid top-world limit ${limit}`)
  return [...worlds]
    .sort((a, b) =>
      b.probability - a.probability || compareWorldKeys(a.world.key, b.world.key))
    .slice(0, limit)
}

export interface BeliefProjectionOptions {
  modelVersion: string
  quality: BeliefSnapshot['quality']
  provenance?: readonly EvidenceContribution[]
  degradation?: readonly string[]
}

/**
 * Normalize and project an arbitrary positive distribution over already
 * feasible worlds. This is the single projection path for both uniform and
 * factor-weighted snapshots.
 */
export function beliefFromWeightedWorlds(
  view: PlayerView,
  input: readonly WeightedWorld[],
  options: BeliefProjectionOptions,
): BeliefSnapshot {
  if (!input.length) throw new Error('belief projection requires at least one world')
  const keys = new Set<string>()
  // Compensated, and this is the summation in the belief layer that most needs
  // to be. It is the last one before a snapshot is emitted, it runs over the
  // largest array in the system (a ten-player servant view carries up to 60,480
  // feasible worlds), and every probability a consumer ever reads is divided by
  // it. A factor that normalizes carefully upstream has its work redone here, so
  // whatever error this total carries is the error the whole pipeline carries.
  const accumulator: CompensatedProbability = { sum: 0, compensation: 0 }
  for (const weightedWorld of input) {
    if (keys.has(weightedWorld.world.key)) {
      throw new Error(`belief projection contains duplicate world ${weightedWorld.world.key}`)
    }
    keys.add(weightedWorld.world.key)
    if (
      !Number.isFinite(weightedWorld.probability)
      || weightedWorld.probability < 0
    ) {
      throw new Error(`invalid world weight ${weightedWorld.probability}`)
    }
    addProbability(accumulator, weightedWorld.probability)
  }
  const total = accumulator.sum + accumulator.compensation
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('belief projection requires positive finite total weight')
  }
  if (options.quality === 'constraints-only' && !weightsAreUniform(input)) {
    throw new Error('constraints-only belief projection requires uniform weights')
  }
  const worlds = input
    .filter((weightedWorld) => weightedWorld.probability > 0)
    .map((weightedWorld) => ({
      world: weightedWorld.world,
      probability: options.quality === 'constraints-only'
        ? 1 / input.length
        : weightedWorld.probability / total,
    }))
  const uniformProjection = weightsAreUniform(worlds)
    ? projectUniformJointWorlds(
        view.playerCount,
        view.rolesInPlay,
        (visit) => worlds.forEach(({ world }) => visit(world)),
      )
    : undefined
  // Compensated for the same reason the normalization total above is, and it
  // was the last naive fold left in this function: same array, up to 60,480
  // terms. Measured on a ten-player servant view, the naive form missed by as
  // much as 2.3e-11, which is seven times PROBABILITY_TOLERANCE.
  //
  // Nothing rejects a weighted snapshot over that today, but analysis/observer.ts
  // already checks a public observer's entropy against log2(worldCount) at
  // exactly that tolerance. It passes only because a uniform support takes the
  // projection branch above and never reaches this sum. The trap is the next
  // person who mirrors that check for a weighted snapshot and finds it failing
  // on nothing but accumulated rounding.
  //
  // compensatedSum, not stableProbabilitySum: every term here is p * log2(p),
  // which is negative for every world and is not a probability.
  const entropy = uniformProjection
    ? uniformProjection.entropy
    : -compensatedSum(
        worlds,
        (weightedWorld) =>
          weightedWorld.probability * Math.log2(weightedWorld.probability),
      )
  const snapshot: BeliefSnapshot = {
    throughSeq: visibleEventCursor(view),
    modelVersion: options.modelVersion,
    quality: options.quality,
    worlds,
    playerMarginals: uniformProjection?.playerMarginals
      ?? playerMarginals(worlds, view.playerCount),
    roleMarginals: uniformProjection?.roleMarginals
      ?? roleMarginals(worlds, view.rolesInPlay, view.playerCount),
    entropy,
    topWorlds: topWorlds(worlds),
    provenance: structuredClone(options.provenance ?? []),
    degradation: [...(options.degradation ?? [])],
  }
  assertSnapshotDistributions(snapshot)
  return snapshot
}

export function exactBelief(view: PlayerView): BeliefSnapshot {
  return beliefFromWeightedWorlds(
    view,
    uniformWeights(feasibleWorlds(view)),
    {
      modelVersion: EXACT_BELIEF_MODEL_VERSION,
      quality: 'constraints-only',
    },
  )
}

export const exactWorldBeliefModel: BeliefModel = Object.freeze({
  version: EXACT_BELIEF_MODEL_VERSION,
  factorsVersion: 'off',
  infer: exactBelief,
})
