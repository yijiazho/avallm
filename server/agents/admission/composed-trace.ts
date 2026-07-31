// Agent-owned detached validation, host reconstruction, and promotion
// admission for composed decision traces. Transport and evaluation consume
// this module; neither owns or mirrors these equations.

import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  canonicalizeTransportJson,
} from '../canonical/canonical-json.ts'
import type {
  CanonicalJsonValue,
} from '../canonical/canonical-json.ts'
import type {
  DecisionComponentPlan,
} from '../components/kernel.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../components/resolved-brain.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../components/robust-evil-quest-card.ts'
import type {
  AdmittedDecisionLayerTrace,
} from '../policy/decision-layer/admission-replay.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
} from '../role-decision-layers/robust-evil-quest-card.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
} from '../trace.ts'
import type {
  DecisionTrace,
} from '../trace.ts'
import {
  validDecisionTrace,
} from './composed-trace/detached.ts'
import {
  validExactComposedTraceHostJoin,
  validFinalizedDiagnosticDecisionTrace,
} from './composed-trace/exact-host-join.ts'
import type {
  ExactComposedTraceHostJoinInput,
} from './composed-trace/exact-host-join.ts'
import {
  DECISION_LAYER_ADMISSION,
} from './composed-trace/production-registries.ts'
import {
  isFullPlayerView,
} from './composed-trace/trace-shape.ts'
import {
  validRoleDependencyHostJoinV1,
} from './role-trace-v1.ts'

/**
 * A complete decision trace may contain the maximum two-megabyte component
 * run plus the surrounding belief, analysis, plan, and communication data.
 * Bound the entire hostile object before inspecting even its discriminator.
 */
export const MAX_DECISION_TRACE_JSON_BYTES = 4_194_304

declare const canonicalDecisionTraceCandidateBrand: unique symbol

/**
 * Strict JSON snapshot of one trace-shaped input. This state is safe to
 * inspect for replay lookup, but it is not host-admitted and carries no trust.
 */
export interface CanonicalDecisionTraceCandidate {
  readonly kind: 'canonical-decision-trace-candidate'
  readonly trace: Readonly<DecisionTrace>
  readonly bytes: number
  readonly [canonicalDecisionTraceCandidateBrand]: true
}

const canonicalDecisionTraceCandidates =
  new WeakSet<CanonicalDecisionTraceCandidate>()
const decisionLayerAdmissionByCandidate =
  new WeakMap<
    CanonicalDecisionTraceCandidate,
    AdmittedDecisionLayerTrace | null
  >()

export type DecisionTraceSnapshotRejection =
  | 'trace-json-unsafe'
  | 'trace-too-large'
  | 'trace-not-object'
  | 'removed-flat-field'

export type DecisionTraceSnapshotResult =
  | CanonicalDecisionTraceCandidate
  | Readonly<{
      kind: 'rejected'
      reason: DecisionTraceSnapshotRejection
    }>

/**
 * Snapshot hostile trace input exactly once. The returned graph is sorted,
 * detached, deeply frozen, accessor-free, proxy-free, dense, and bounded.
 * Domain admission must consume this snapshot rather than the caller object.
 */
export function snapshotDecisionTraceInput(
  value: unknown,
): DecisionTraceSnapshotResult {
  const canonical = canonicalizeTransportJson(
    value,
    MAX_DECISION_TRACE_JSON_BYTES,
  )
  if (!canonical.ok) {
    return Object.freeze({
      kind: 'rejected',
      reason: canonical.failureCode === 'payload-too-large'
        ? 'trace-too-large'
        : 'trace-json-unsafe',
    })
  }
  if (
    !canonical.payload
    || typeof canonical.payload !== 'object'
    || Array.isArray(canonical.payload)
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'trace-not-object',
    })
  }
  const root = canonical.payload as Record<string, CanonicalJsonValue>
  const versions = root.componentVersions
  if (
    Object.hasOwn(root, 'privateEvilQuestCardPolicy')
    || (
      versions !== null
      && typeof versions === 'object'
      && !Array.isArray(versions)
      && (
        Object.hasOwn(versions, 'evilQuestCardPolicy')
        || Object.hasOwn(versions, 'configuredEvilQuestCardPolicy')
      )
    )
  ) {
    return Object.freeze({
      kind: 'rejected',
      reason: 'removed-flat-field',
    })
  }
  const trace =
    canonical.payload as unknown as Readonly<DecisionTrace>
  const decisionLayerAdmission =
    trace.version === COMPONENT_DECISION_TRACE_VERSION
      ? DECISION_LAYER_ADMISSION.admitCanonical(
          trace.decisionLayerRun as unknown as CanonicalJsonValue,
        ) ?? null
      : null
  const candidate = Object.freeze({
    kind: 'canonical-decision-trace-candidate',
    trace,
    bytes: canonical.bytes,
  }) as CanonicalDecisionTraceCandidate
  canonicalDecisionTraceCandidates.add(candidate)
  decisionLayerAdmissionByCandidate.set(
    candidate,
    decisionLayerAdmission,
  )
  return candidate
}

export type DecisionTraceAdmissionRejection =
  | DecisionTraceSnapshotRejection
  | 'canonical-candidate-untrusted'
  | 'external-detached-invalid'
  | 'external-host-join-failed'
  | 'finalized-diagnostic-invalid'
  | 'trusted-identity-host-join-failed'

export type EvilQuestCardAdmissionState =
  | Readonly<{ state: 'not-configured' }>
  | Readonly<{
      state: 'configured-inactive'
      configuredVersion: string
    }>
  | Readonly<{
      state: 'resolved'
      configuredVersion: string
      resolvedVersion: string
    }>
  | Readonly<{
      state: 'universally-suppressed'
      configuredVersion: string
    }>

interface DecisionTraceAdmissionFacts {
  readonly evilQuestCardPolicy: EvilQuestCardAdmissionState
}

export type DecisionTraceAdmissionResult =
  | Readonly<{
      kind: 'trusted-exact'
      lifecycle: 'finalized-artifact'
      trace: Readonly<DecisionTrace>
      identity: ResolvedArchitectureIdentity
      promotionEvidenceEligible: boolean
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'external-diagnostic'
      lifecycle: 'pre-apply-external'
      trace: Readonly<DecisionTrace>
      promotionEvidenceEligible: false
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'artifact-diagnostic'
      lifecycle: 'finalized-artifact'
      trace: Readonly<DecisionTrace>
      promotionEvidenceEligible: false
      facts: DecisionTraceAdmissionFacts
    }>
  | Readonly<{
      kind: 'rejected'
      lifecycle: 'pre-apply-external' | 'finalized-artifact'
      reason: DecisionTraceAdmissionRejection
    }>

/**
 * Pre-apply admission for an untrusted reply, reached only through
 * `parseExternalDecisionReply`. That entry point has no production caller
 * today, so this arm is exercised solely by the suite. It is not redundant with
 * `finalized-artifact`: this lifecycle validates a trace whose action has not
 * been applied yet, so it takes an optional partial host view instead of the
 * full `PlayerView`, deterministic seed, and authoritative outcome the
 * finalized arm requires. It is also the only path that reaches
 * `validDecisionTrace`, and through it the sole structural checks on language
 * evidence, private plan outcome, and belief marginals. Deleting it would
 * quietly drop those checks rather than relocate them.
 */
export interface ExternalDecisionTraceAdmissionInput {
  readonly kind: 'pre-apply-external'
  readonly trace: unknown
  readonly req: DecisionRequest
  readonly decision: Decision
  readonly hostView?: Pick<PlayerView, 'rolesInPlay'>
}

export interface FinalizedDecisionTraceAdmissionInput {
  readonly kind: 'finalized-artifact'
  readonly trace: unknown
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly authoritativeAction: Decision
  /**
   * A caller-owned selected action may be supplied by live capture. Stored
   * consumers omit it; admission then reads the canonical finalized outcome,
   * never the caller's raw object, and falls back to the applied action.
   */
  readonly selectedDecision?: Decision
  readonly deterministicSeed: string
  readonly expectedComponentPlan?: DecisionComponentPlan
  readonly expectedArchitectureIdentity?: ResolvedArchitectureIdentity
  readonly expectComponentTrace?: boolean
  /**
   * Temporary test-facade requirement. Runtime and evaluation diagnostics
   * retain structural host validation; the remaining B2 facade asks the
   * closed union for full generic replay until its callers migrate.
   */
  readonly diagnosticVerification?: 'structural' | 'exact'
}

export type DecisionTraceAdmissionInput =
  | ExternalDecisionTraceAdmissionInput
  | FinalizedDecisionTraceAdmissionInput

export type CanonicalDecisionTraceAdmissionInput =
  | (
      Omit<ExternalDecisionTraceAdmissionInput, 'trace'>
      & { readonly trace: CanonicalDecisionTraceCandidate }
    )
  | (
      Omit<FinalizedDecisionTraceAdmissionInput, 'trace'>
      & { readonly trace: CanonicalDecisionTraceCandidate }
    )

function evilQuestCardAdmissionState(
  trace: Readonly<DecisionTrace>,
  identity?: ResolvedArchitectureIdentity,
): EvilQuestCardAdmissionState {
  const robustConfigured = identity?.decisionLayerOrder.some(
    (layer) =>
      layer.id === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.id
      && layer.version === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.version,
  )
    && identity.components.configured.some(
      (component) =>
        component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
        && component.version === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    )
  if (robustConfigured) {
    const journal = trace.decisionLayerRun?.journal.find(
      (entry) =>
        entry.layer.id === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.id
        && entry.layer.version
          === ROBUST_EVIL_QUEST_CARD_DECISION_LAYER.version,
    )
    const component = trace.components?.entries.find(
      (entry) =>
        entry.component.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
        && entry.component.version
          === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    )
    if (
      journal?.status === 'applied'
      && component?.status === 'admitted'
      && journal.attributedComponents.some(
        (ref) =>
          ref.id === EVIL_QUEST_CARD_ROBUST_COMPONENT.id
          && ref.version === EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      )
    ) {
      return Object.freeze({
        state: 'resolved',
        configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
        resolvedVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      })
    }
    if (
      journal?.status === 'suppressed'
      && journal.suppressionCode === 'universal-policy-selected'
      && component?.status === 'suppressed'
    ) {
      return Object.freeze({
        state: 'universally-suppressed',
        configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
      })
    }
    return Object.freeze({
      state: 'configured-inactive',
      configuredVersion: EVIL_QUEST_CARD_ROBUST_COMPONENT.version,
    })
  }
  return Object.freeze({ state: 'not-configured' })
}

function promotionEvidenceEligible(
  trace: Readonly<DecisionTrace>,
): boolean {
  return trace.version === COMPONENT_DECISION_TRACE_VERSION
    && trace.components !== undefined
    && trace.decisionLayerRun !== undefined
    && trace.decisionLayerRun.journal.every(
      (entry) => entry.status !== 'degraded',
    )
    && trace.components.entries.every((entry) =>
      entry.status !== 'degraded'
      && (
        entry.status !== 'admitted'
        || entry.promotionEligible
      ))
}

function rejectedAdmission(
  lifecycle: DecisionTraceAdmissionResult['lifecycle'],
  reason: DecisionTraceAdmissionRejection,
): DecisionTraceAdmissionResult {
  return Object.freeze({ kind: 'rejected', lifecycle, reason })
}

/**
 * Admit an already snapshotted trace candidate against its lifecycle and
 * host. This function never sees the caller's original object.
 */
export function admitCanonicalDecisionTrace(
  input: CanonicalDecisionTraceAdmissionInput,
): DecisionTraceAdmissionResult {
  const candidate = input.trace
  if (!canonicalDecisionTraceCandidates.has(candidate)) {
    return rejectedAdmission(
      input.kind === 'pre-apply-external'
        ? 'pre-apply-external'
        : 'finalized-artifact',
      'canonical-candidate-untrusted',
    )
  }
  const trace = candidate.trace as DecisionTrace
  const decisionLayerAdmission =
    decisionLayerAdmissionByCandidate.get(candidate) ?? null
  if (input.kind === 'pre-apply-external') {
    if (!validDecisionTrace(
      input.req,
      input.decision,
      trace,
      input.hostView,
      decisionLayerAdmission ?? undefined,
    )) {
      return rejectedAdmission(
        'pre-apply-external',
        'external-detached-invalid',
      )
    }
    if (
      isFullPlayerView(input.hostView)
      && (
        (
          trace.version !== COMPONENT_DECISION_TRACE_VERSION
          && (
            !validRoleDependencyHostJoinV1({
              trace,
              req: input.req,
              view: input.hostView,
            })
          )
        )
      )
    ) {
      return rejectedAdmission(
        'pre-apply-external',
        'external-host-join-failed',
      )
    }
    return Object.freeze({
      kind: 'external-diagnostic',
      lifecycle: 'pre-apply-external',
      trace,
      promotionEvidenceEligible: false,
      facts: Object.freeze({
        evilQuestCardPolicy: evilQuestCardAdmissionState(
          trace,
        ),
      }),
    })
  }

  const selectedDecision = input.selectedDecision
    ?? trace.privatePlanOutcome?.selected?.decision
    ?? input.authoritativeAction
  const exactInput: ExactComposedTraceHostJoinInput = {
    trace,
    ...(decisionLayerAdmission
      ? { decisionLayerAdmission }
      : {}),
    req: input.req,
    view: input.view,
    authoritativeAction: input.authoritativeAction,
    selectedDecision,
    deterministicSeed: input.deterministicSeed,
    ...(input.expectedComponentPlan
      ? { expectedComponentPlan: input.expectedComponentPlan }
      : {}),
    ...(input.expectedArchitectureIdentity
      ? {
          expectedArchitectureIdentity:
            input.expectedArchitectureIdentity,
        }
      : {}),
    ...(input.expectComponentTrace
      ? { expectComponentTrace: true }
      : {}),
  }
  const facts = Object.freeze({
    evilQuestCardPolicy: evilQuestCardAdmissionState(
      trace,
      input.expectedArchitectureIdentity,
    ),
  })
  if (
    trace.version === COMPONENT_DECISION_TRACE_VERSION
    && !decisionLayerAdmission
  ) {
    return rejectedAdmission(
      'finalized-artifact',
      input.expectedArchitectureIdentity !== undefined
        ? 'trusted-identity-host-join-failed'
        : 'finalized-diagnostic-invalid',
    )
  }
  if (input.expectedArchitectureIdentity !== undefined) {
    if (!validExactComposedTraceHostJoin(exactInput)) {
      return rejectedAdmission(
        'finalized-artifact',
        'trusted-identity-host-join-failed',
      )
    }
    return Object.freeze({
      kind: 'trusted-exact',
      lifecycle: 'finalized-artifact',
      trace,
      identity: input.expectedArchitectureIdentity,
      promotionEvidenceEligible: promotionEvidenceEligible(trace),
      facts,
    })
  }
  const diagnosticValid =
    input.diagnosticVerification === 'exact'
      ? validExactComposedTraceHostJoin(exactInput)
      : validFinalizedDiagnosticDecisionTrace(
          input.req,
          input.authoritativeAction,
          selectedDecision,
          trace,
          input.view,
        )
  if (!diagnosticValid) {
    return rejectedAdmission(
      'finalized-artifact',
      'finalized-diagnostic-invalid',
    )
  }
  return Object.freeze({
    kind: 'artifact-diagnostic',
    lifecycle: 'finalized-artifact',
    trace,
    promotionEvidenceEligible: false,
    facts,
  })
}

/**
 * Public one-shot ingress. Canonicalization happens before any trace field is
 * read, and admitted consumers receive only that detached snapshot.
 */
export function admitDecisionTrace(
  input: DecisionTraceAdmissionInput,
): DecisionTraceAdmissionResult {
  const snapshot = snapshotDecisionTraceInput(input.trace)
  if (snapshot.kind === 'rejected') {
    return rejectedAdmission(
      input.kind === 'pre-apply-external'
        ? 'pre-apply-external'
        : 'finalized-artifact',
      snapshot.reason,
    )
  }
  return admitCanonicalDecisionTrace({
    ...input,
    trace: snapshot,
  })
}
