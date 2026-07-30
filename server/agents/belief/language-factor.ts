// Conservative language-evidence weighting over an already complete belief.
//
// Interpretation and inference are deliberately separate. This module sees
// only finite admitted evidence plus a narrow attribution context; it never
// reads player-authored text or asks a provider to interpret it.

import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import {
  exactKeys,
  plainRecord,
  tableSize,
} from '../components/canonical-shape.ts'
import {
  addProbability,
  PROBABILITY_TOLERANCE,
  type CompensatedProbability,
} from '../components/probability-arithmetic.ts'
import type {
  Alignment,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import {
  projectLanguageInterpreterInput,
  validateLanguageEvidenceCursor,
  validateLanguageInterpreterInput,
} from '../communication/language-contract.ts'
import {
  LANGUAGE_EVIDENCE_CLASSES,
  LANGUAGE_EVIDENCE_CONFIDENCES,
  LANGUAGE_EVIDENCE_DIRECTIONS,
  LANGUAGE_EVIDENCE_VERSION,
  type LanguageEvidence,
  type LanguageEvidenceClass,
  type LanguageEvidenceConfidence,
  type LanguageEvidenceCursor,
  type LanguageEvidenceDirection,
  type LanguageInterpreterInput,
} from '../communication/language-types.ts'
import {
  beliefFromWeightedWorlds,
  visibleEventCursor,
} from './exact.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
  type HiddenWorld,
  type WeightedWorld,
} from './types.ts'

export const LANGUAGE_INFERENCE_CONTEXT_VERSION =
  'language-inference-context-v1'
export const LANGUAGE_LIKELIHOOD_FACTOR_VERSION =
  'bounded-language-likelihood-v1'
export const LANGUAGE_FACTOR_BUNDLE_VERSION =
  'bounded-language-only-v1'
export const LANGUAGE_BELIEF_VERSION_SUFFIX = 'bounded-language-v1'
export const LANGUAGE_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+bounded-language-v1'
export const LANGUAGE_HISTORY_LOG_ODDS_CAP = Math.log(1.25)

/** Stable configured identity of the mechanical plus language belief path. */
export function languageBeliefPipelineVersion(
  mechanicalBelief: string,
): string {
  return `${mechanicalBelief}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`
}

/** Stable configured identity of all factors available to that path. */
export function combinedLanguageFactorBundleVersion(
  mechanicalFactors: string,
): string {
  return mechanicalFactors === 'off'
    ? LANGUAGE_FACTOR_BUNDLE_VERSION
    : `${mechanicalFactors}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`
}

const INTERPRETER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const PUBLIC_RATIONALE_MAX_LENGTH = 500

export interface LanguageInferenceSource {
  sourceSeq: number
  speakerSeat: Seat
}

/**
 * The complete data allowed to cross from interpretation into arithmetic.
 *
 * In particular, it contains no raw speech, player names, rationale,
 * posterior summaries, private data, or plans.
 */
export interface LanguageInferenceContext {
  schemaVersion: typeof LANGUAGE_INFERENCE_CONTEXT_VERSION
  viewerSeat: Seat
  throughSeq: number
  playerCount: number
  interpreterVersion: string
  sources: readonly LanguageInferenceSource[]
}

export interface LanguageLikelihoodFactor {
  id: 'language'
  version: string
  logLikelihood(
    world: HiddenWorld,
    evidence: LanguageLikelihoodEvidence,
  ): number
}

/** Finite evidence fields permitted to participate in factor arithmetic. */
export interface LanguageLikelihoodEvidence {
  sourceSeq: number
  subject: Seat
  direction: LanguageEvidenceDirection
  class: LanguageEvidenceClass
  confidence: LanguageEvidenceConfidence
  interpreterVersion: string
}

export interface LanguageEvidenceState {
  evidence: readonly LanguageEvidence[]
  cursor: LanguageEvidenceCursor
}

const CONFIDENCE_LIKELIHOOD_RATIO: Readonly<
  Record<LanguageEvidenceConfidence, number>
> = Object.freeze({
  low: 1.02,
  medium: 1.05,
  high: 1.10,
})

function targetAlignment(
  direction: LanguageEvidenceDirection,
): Alignment | undefined {
  if (direction === 'moreGood') return 'good'
  if (direction === 'moreEvil') return 'evil'
  return undefined
}

export const boundedLanguageLikelihoodFactor: LanguageLikelihoodFactor =
  Object.freeze({
    id: 'language',
    version: LANGUAGE_LIKELIHOOD_FACTOR_VERSION,
    logLikelihood(
      world: HiddenWorld,
      evidence: LanguageLikelihoodEvidence,
    ) {
      const alignment = targetAlignment(evidence.direction)
      if (!alignment) return 0
      return world.alignmentBySeat[evidence.subject] === alignment
        ? Math.log(CONFIDENCE_LIKELIHOOD_RATIO[evidence.confidence])
        : 0
    },
  })

function finiteSeat(value: unknown, playerCount: number): value is Seat {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) < playerCount
}

/*
 * plainRecord, not plainDataRecord: nothing on this path runs downstream of the
 * canonical JSON boundary, so no caller hands these validators a record built
 * with Object.create(null). The inference context is an object literal built by
 * projectLanguageInferenceContext, the evidence comes back from an interpreter
 * reply through admitLanguageEvidence, and the factor state is assembled in
 * composed.ts; the only structuredClone on the way preserves Object.prototype.
 * The null-prototype relaxation would buy nothing here and would cost the
 * prototype pin on an untrusted interpreter's output.
 *
 * This replaced a private isRecord that admitted a Proxy and any prototype at
 * all, which is the drift the shared module's header describes.
 */

export function validateLanguageInferenceContext(
  value: unknown,
): asserts value is LanguageInferenceContext {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'schemaVersion',
      'viewerSeat',
      'throughSeq',
      'playerCount',
      'interpreterVersion',
      'sources',
    ])
    || value.schemaVersion !== LANGUAGE_INFERENCE_CONTEXT_VERSION
    || !tableSize(value.playerCount)
    || !finiteSeat(value.viewerSeat, value.playerCount as number)
    || !Number.isSafeInteger(value.throughSeq)
    || (value.throughSeq as number) < -1
    || typeof value.interpreterVersion !== 'string'
    || !INTERPRETER_VERSION_PATTERN.test(value.interpreterVersion)
    || !Array.isArray(value.sources)
  ) {
    throw new Error('language inference context failed v1 validation')
  }
  const playerCount = value.playerCount as number
  const throughSeq = value.throughSeq as number
  if (
    !value.sources.every((source) =>
      plainRecord(source)
      && exactKeys(source, ['sourceSeq', 'speakerSeat'])
      && Number.isSafeInteger(source.sourceSeq)
      && (source.sourceSeq as number) >= 0
      && (source.sourceSeq as number) <= throughSeq
      && finiteSeat(source.speakerSeat, playerCount))
    || !value.sources.every((source, index, all) =>
      index === 0
      || (all[index - 1] as LanguageInferenceSource).sourceSeq
        < (source as LanguageInferenceSource).sourceSeq)
  ) {
    throw new Error('language inference context failed v1 validation')
  }
}

/**
 * Reduce validated Phase 6A input to the only attribution data the likelihood
 * factor needs. The viewer is explicit because the Phase 6A public projection
 * is intentionally identical for every seat.
 */
export function projectLanguageInferenceContext(
  viewerSeat: Seat,
  input: LanguageInterpreterInput,
  interpreterVersion: string,
): LanguageInferenceContext {
  validateLanguageInterpreterInput(input)
  const context: LanguageInferenceContext = {
    schemaVersion: LANGUAGE_INFERENCE_CONTEXT_VERSION,
    viewerSeat,
    throughSeq: input.throughSeq,
    playerCount: input.publicContext.playerCount,
    interpreterVersion,
    sources: input.utteranceHistory.map((utterance) => ({
      sourceSeq: utterance.sourceSeq,
      speakerSeat: utterance.speaker.seat,
    })),
  }
  validateLanguageInferenceContext(context)
  return context
}

function validateEvidence(
  value: unknown,
  context: LanguageInferenceContext,
  sources: ReadonlyMap<number, Seat>,
): asserts value is LanguageEvidence {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'schemaVersion',
      'sourceSeq',
      'subject',
      'direction',
      'class',
      'confidence',
      'publicRationale',
      'interpreterVersion',
    ])
    || value.schemaVersion !== LANGUAGE_EVIDENCE_VERSION
    || !Number.isSafeInteger(value.sourceSeq)
    || !sources.has(value.sourceSeq as number)
    || !finiteSeat(value.subject, context.playerCount)
    || !LANGUAGE_EVIDENCE_DIRECTIONS.includes(
      value.direction as LanguageEvidenceDirection,
    )
    || !LANGUAGE_EVIDENCE_CLASSES.includes(
      value.class as LanguageEvidenceClass,
    )
    || !LANGUAGE_EVIDENCE_CONFIDENCES.includes(
      value.confidence as LanguageEvidenceConfidence,
    )
    || typeof value.publicRationale !== 'string'
    || value.publicRationale.trim().length === 0
    || value.publicRationale.length > PUBLIC_RATIONALE_MAX_LENGTH
    || value.interpreterVersion !== context.interpreterVersion
  ) {
    throw new Error('language evidence failed likelihood contract')
  }
}

function validateBaseBelief(
  view: PlayerView,
  base: BeliefSnapshot,
  context: LanguageInferenceContext,
): void {
  if (
    view.seat !== context.viewerSeat
    || view.playerCount !== context.playerCount
    || base.throughSeq !== visibleEventCursor(view)
    || !base.worlds.length
  ) {
    throw new Error('language factor cursor or viewer contract mismatch')
  }
  const publicInput = projectLanguageInterpreterInput(view)
  const publicSources = publicInput.utteranceHistory.map((utterance) => ({
    sourceSeq: utterance.sourceSeq,
    speakerSeat: utterance.speaker.seat,
  }))
  if (
    context.throughSeq !== publicInput.throughSeq
    || JSON.stringify(context.sources) !== JSON.stringify(publicSources)
  ) {
    throw new Error('language factor public cursor contract mismatch')
  }
  const keys = new Set<string>()
  // Compensated rather than `+=`: this streams the whole feasible support, and
  // a ten-player servant view carries up to 60,480 worlds. Adding those left to
  // right drifts as far as 1.6e-12 from 1, so the naive form could only be
  // checked against a tolerance loose enough to hide a real normalization bug.
  const probabilityTotal: CompensatedProbability = { sum: 0, compensation: 0 }
  for (const weightedWorld of base.worlds) {
    if (
      keys.has(weightedWorld.world.key)
      || !Number.isFinite(weightedWorld.probability)
      || weightedWorld.probability <= 0
      || weightedWorld.probability > 1
      || weightedWorld.world.roleBySeat.length !== context.playerCount
      || weightedWorld.world.alignmentBySeat.length !== context.playerCount
      || weightedWorld.world.roleBySeat.some(
        (role, seat) =>
          ROLE_ALIGNMENT[role]
            !== weightedWorld.world.alignmentBySeat[seat],
      )
    ) {
      throw new Error('language factor base belief contract mismatch')
    }
    keys.add(weightedWorld.world.key)
    addProbability(probabilityTotal, weightedWorld.probability)
  }
  const resolvedTotal = probabilityTotal.sum + probabilityTotal.compensation
  if (
    // Finite first: a compensated total that overflowed carries NaN, and every
    // tolerance comparison against NaN is false. See invariants.ts.
    !Number.isFinite(resolvedTotal)
    || Math.abs(resolvedTotal - 1) > PROBABILITY_TOLERANCE
    || base.provenance.some((item) => item.factorId === 'language')
    || base.modelVersion.includes('bounded-language-v1')
  ) {
    throw new Error('language factor requires one normalized mechanical base')
  }
}

function degradedBase(
  base: BeliefSnapshot,
  reason:
    | 'language-factor-contract-mismatch'
    | 'language-factor-failed',
): BeliefSnapshot {
  return {
    ...base,
    quality: 'degraded',
    degradation: base.degradation.includes(reason)
      ? base.degradation.slice()
      : [...base.degradation, reason],
  }
}

function combinedModelVersion(base: BeliefSnapshot): string {
  return base.modelVersion === EXACT_BELIEF_MODEL_VERSION
    ? LANGUAGE_WEIGHTED_BELIEF_VERSION
    : `${base.modelVersion}+${LANGUAGE_BELIEF_VERSION_SUFFIX}`
}

/**
 * Normalize log weights without dropping a positive base world when a valid
 * but extremely small IEEE-754 probability underflows after normalization.
 */
function normalizePreservingSupport(
  worlds: readonly HiddenWorld[],
  logWeights: readonly number[],
): readonly WeightedWorld[] {
  if (
    worlds.length === 0
    || worlds.length !== logWeights.length
    || logWeights.some((weight) => !Number.isFinite(weight))
  ) {
    throw new Error('language factor requires finite log weights')
  }
  const maximum = logWeights.reduce(
    (current, weight) => Math.max(current, weight),
    -Infinity,
  )
  const relative = logWeights.map((weight) =>
    Math.max(Number.MIN_VALUE, Math.exp(weight - maximum)))
  const total = relative.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('language factor normalization failed')
  }
  const probabilities = relative.map((weight) => weight / total)
  for (let index = 0; index < probabilities.length; index++) {
    if (probabilities[index] === 0) probabilities[index] = Number.MIN_VALUE
  }
  const correctedTotal = probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  )
  let largest = 0
  for (let index = 1; index < probabilities.length; index++) {
    if (probabilities[index] > probabilities[largest]) largest = index
  }
  probabilities[largest] += 1 - correctedTotal
  if (probabilities.some((probability) =>
    !Number.isFinite(probability) || probability <= 0)) {
    throw new Error('language factor normalization lost base support')
  }
  return worlds.map((world, index) => ({
    world,
    probability: probabilities[index],
  }))
}

function weightedLanguageSnapshot(
  view: PlayerView,
  base: BeliefSnapshot,
  context: LanguageInferenceContext,
  state: LanguageEvidenceState,
  factor: LanguageLikelihoodFactor,
): BeliefSnapshot {
  const evidence = state.evidence
  const sources = new Map(
    context.sources.map((source) => [
      source.sourceSeq,
      source.speakerSeat,
    ]),
  )
  for (const item of evidence) validateEvidence(item, context, sources)
  const evidenceSeqs = evidence.map((item) => item.sourceSeq)
  if (new Set(evidenceSeqs).size !== evidenceSeqs.length) {
    throw new Error('language likelihood evidence repeats a source')
  }

  const active = evidence
    .filter((item) =>
      item.direction !== 'unchanged'
      && sources.get(item.sourceSeq) !== context.viewerSeat)
    .slice()
    .sort((left, right) => left.sourceSeq - right.sourceSeq)
    .map((item): LanguageLikelihoodEvidence => ({
      sourceSeq: item.sourceSeq,
      subject: item.subject,
      direction: item.direction,
      class: item.class,
      confidence: item.confidence,
      interpreterVersion: item.interpreterVersion,
    }))
  if (!active.length) return base

  const raw = base.worlds.map(({ world }) =>
    active.reduce((sum, item) => {
      const contribution = factor.logLikelihood(world, item)
      if (!Number.isFinite(contribution)) {
        throw new Error('language factor returned a non-finite contribution')
      }
      return sum + contribution
    }, 0))
  let maximum = -Infinity
  let minimum = Infinity
  for (const value of raw) {
    maximum = Math.max(maximum, value)
    minimum = Math.min(minimum, value)
  }
  const span = maximum - minimum
  if (!Number.isFinite(span)) {
    throw new Error('language factor produced a non-finite history span')
  }
  const scale = span > LANGUAGE_HISTORY_LOG_ODDS_CAP
    ? LANGUAGE_HISTORY_LOG_ODDS_CAP / span
    : 1
  const capped = raw.map((value) => (value - maximum) * scale)
  const weighted = normalizePreservingSupport(
    base.worlds.map((entry) => entry.world),
    base.worlds.map(
      (entry, index) => Math.log(entry.probability) + capped[index],
    ),
  )
  return beliefFromWeightedWorlds(view, weighted, {
    modelVersion: combinedModelVersion(base),
    quality: base.quality === 'degraded' ? 'degraded' : 'weighted',
    provenance: [
      ...base.provenance,
      {
        factorId: factor.id,
        factorVersion: factor.version,
        evidenceIds: active.map((item) =>
          `event:${item.sourceSeq}:language:${item.interpreterVersion}:`
          + `subject:${item.subject}:${item.class}:`
          + `${item.direction}:${item.confidence}`),
        logLikelihoodCap: LANGUAGE_HISTORY_LOG_ODDS_CAP,
        minLogLikelihood: capped.reduce(
          (current, value) => Math.min(current, value),
          Infinity,
        ),
        maxLogLikelihood: capped.reduce(
          (current, value) => Math.max(current, value),
          -Infinity,
        ),
      },
    ],
    degradation: base.degradation,
  })
}

function validateApplicationContract(
  view: PlayerView,
  base: BeliefSnapshot,
  context: LanguageInferenceContext,
  state: LanguageEvidenceState,
  factor: LanguageLikelihoodFactor,
): void {
  validateLanguageInferenceContext(context)
  validateBaseBelief(view, base, context)
  if (
    factor.id !== 'language'
    || factor.version !== LANGUAGE_LIKELIHOOD_FACTOR_VERSION
    || typeof factor.logLikelihood !== 'function'
    || !plainRecord(state)
    || !exactKeys(state, ['evidence', 'cursor'])
    || !Array.isArray(state.evidence)
  ) {
    throw new Error('language likelihood factor contract mismatch')
  }
  validateLanguageEvidenceCursor(state.cursor)
  if (state.cursor.throughSeq !== context.throughSeq) {
    throw new Error('language evidence cursor does not match context')
  }
  const sources = new Map(
    context.sources.map((source) => [
      source.sourceSeq,
      source.speakerSeat,
    ]),
  )
  for (const item of state.evidence) validateEvidence(item, context, sources)
  const evidenceSeqs = state.evidence.map((item) => item.sourceSeq)
  if (new Set(evidenceSeqs).size !== evidenceSeqs.length) {
    throw new Error('language likelihood evidence repeats a source')
  }
  const canonicalEvidenceSeqs = evidenceSeqs.slice().sort((a, b) => a - b)
  if (
    JSON.stringify(canonicalEvidenceSeqs)
      !== JSON.stringify(state.cursor.countedSourceSeqs)
  ) {
    throw new Error('language evidence cursor does not match admitted evidence')
  }
}

/**
 * Apply admitted evidence to a supplied mechanical posterior. Contract failure
 * and computation failure preserve that exact posterior and its provenance;
 * they never reconstruct a uniform belief.
 */
export function applyBoundedLanguageEvidence(
  view: PlayerView,
  base: BeliefSnapshot,
  context: LanguageInferenceContext,
  state: LanguageEvidenceState,
  factor: LanguageLikelihoodFactor = boundedLanguageLikelihoodFactor,
): BeliefSnapshot {
  try {
    validateApplicationContract(view, base, context, state, factor)
  } catch {
    return degradedBase(base, 'language-factor-contract-mismatch')
  }
  try {
    return weightedLanguageSnapshot(
      view,
      base,
      context,
      state,
      factor,
    )
  } catch {
    return degradedBase(base, 'language-factor-failed')
  }
}
