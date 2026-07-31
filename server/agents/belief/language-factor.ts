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
} from '../canonical/canonical-shape.ts'
import {
  addProbability,
  logWeightsToProbabilitiesPreservingSupport,
  PROBABILITY_TOLERANCE,
  type CompensatedProbability,
} from '../canonical/probability-arithmetic.ts'
import type {
  Alignment,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import {
  projectLanguageInterpreterInput,
  validateLanguageEvidenceCursor,
  validateLanguageInterpreterInput,
} from '../record/language-contract.ts'
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
} from '../record/language-types.ts'
import {
  beliefFromWeightedWorlds,
  visibleEventCursor,
} from './exact.ts'
import {
  buildFactorProvenance,
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
  type HiddenWorld,
  type LikelihoodFactor,
  type WeightedWorld,
} from './types.ts'

// Version tokens, each pinning a distinct contract. Do not change a string
// value without treating it as a new model: consumers, fixtures, and admission
// paths match these exact tokens.
//   LANGUAGE_INFERENCE_CONTEXT_VERSION  the shape of the attribution context
//                                       that crosses interpretation -> math.
//   LANGUAGE_LIKELIHOOD_FACTOR_VERSION  the factor's own id.version, checked in
//                                       the application contract and provenance.
//   LANGUAGE_FACTOR_BUNDLE_VERSION      the factors-available bundle label.
//   LANGUAGE_BELIEF_VERSION_SUFFIX      appended to a non-exact base model
//                                       version once the factor has been applied.
//   LANGUAGE_WEIGHTED_BELIEF_VERSION    the whole belief model version when the
//                                       base is the plain exact-constraints model.
export const LANGUAGE_INFERENCE_CONTEXT_VERSION =
  'language-inference-context-v1'
export const LANGUAGE_LIKELIHOOD_FACTOR_VERSION =
  'bounded-language-likelihood-v1'
export const LANGUAGE_FACTOR_BUNDLE_VERSION =
  'bounded-language-only-v1'
export const LANGUAGE_BELIEF_VERSION_SUFFIX = 'bounded-language-v1'
export const LANGUAGE_WEIGHTED_BELIEF_VERSION =
  'exact-constraints+bounded-language-v1'
// Not a version token: the absolute log-odds cap on the whole history factor.
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

export type LanguageLikelihoodFactor =
  LikelihoodFactor<LanguageLikelihoodEvidence, 'language'>

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
 * Zip the support-preserving normalization back onto the base worlds.
 *
 * The arithmetic moved to components/probability-arithmetic.ts, where it sits
 * beside the plain normalizer as a second named policy over one shared core.
 * The two still emit different masses, which is why they are two functions and
 * not one with a flag: this one floors an underflowed world at
 * Number.MIN_VALUE rather than letting it vanish, and settles the residual on
 * the largest mass so the total lands on 1 as closely as doubles allow. The
 * history factor wants both because it reweights the entire feasible support
 * and a world that reaches zero here can never be argued back.
 *
 * The comment this replaced said the residual made the result sum to exactly 1.
 * That was two claims too strong. It is within an ulp, not exact (see the
 * dominant-mass case recorded on the shared function), and until the projection
 * total in exact.ts was compensated the settlement was undone by the
 * renormalization one call downstream anyway.
 */
function normalizePreservingSupport(
  worlds: readonly HiddenWorld[],
  logWeights: readonly number[],
): readonly WeightedWorld[] {
  if (worlds.length === 0 || worlds.length !== logWeights.length) {
    throw new Error('language factor requires one log weight per world')
  }
  const probabilities = logWeightsToProbabilitiesPreservingSupport(logWeights)
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
  // validateApplicationContract already ran validateEvidence and the
  // repeated-source check over exactly this state.evidence before we were
  // called, so this function trusts the items and only needs the source map to
  // route each seq back to its speaker.
  const evidence = state.evidence
  const sources = new Map(
    context.sources.map((source) => [
      source.sourceSeq,
      source.speakerSeat,
    ]),
  )

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
  // Capping semantics here differ from the quest factor's capLogLikelihood on
  // purpose. The quest factor clamps each world's summed log-likelihood to
  // [-cap, cap] relative to the best world, an independent per-world clip. The
  // language factor instead rescales the whole raw span (max - min) by a single
  // factor when it exceeds the cap, so the RELATIVE ordering and spacing of
  // every world are preserved and only the overall strength of the history
  // signal is bounded. History accumulates across many utterances, so a hard
  // per-world clip would flatten the tail of a long, coherent read; span-scaling
  // keeps the shape and only limits how far the whole factor can move belief.
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
      buildFactorProvenance(
        factor,
        active.map((item) =>
          `event:${item.sourceSeq}:language:${item.interpreterVersion}:`
          + `subject:${item.subject}:${item.class}:`
          + `${item.direction}:${item.confidence}`),
        LANGUAGE_HISTORY_LOG_ODDS_CAP,
        capped,
      ),
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
