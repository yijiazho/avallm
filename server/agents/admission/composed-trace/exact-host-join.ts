// Exact host-join validation: the checks that exist only because the host holds
// the real view and can re-derive a trace rather than merely inspect it. Held
// apart from the detached validators for the same reason they are held apart
// from these: a check cannot come to depend on host state without moving files,
// and moving files is seen.

import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import {
  isHostReconstructibleCognition,
} from '../../belief/host-reconstructible.ts'
import {
  MORGANA_ROLE_SCORER_DEGRADATION,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  validatePrivateMorganaRoleUtilityHostJoin,
} from '../../analysis/morgana-role-utility.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../../candidate/candidates.ts'
import {
  resolvedArchitectureIdentityTraceJoin,
} from '../../components/architecture-metadata.ts'
import {
  componentPayload,
} from '../../components/kernel.ts'
import type {
  DecisionComponentPlan,
} from '../../components/kernel.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../../components/native-score-components.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../components/resolved-brain.ts'
import {
  mechanicalDecision,
} from '../../policy/decision-frame.ts'
import type {
  AdmittedDecisionLayerTrace,
} from './production-registries.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  stablePolicyBucket,
} from '../../policy/score.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
} from '../../trace.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import {
  validRoleTraceV1HostJoin,
} from '../role-trace-v1.ts'
import {
  validForcedPolicyResult,
} from '../trace-primitives.ts'
import {
  validDecisionTraceProvenance,
  validGenericComponentRun,
  validGenericComponentRunHostJoin,
} from './component-run.ts'
import {
  validBeliefVersionRelation,
  validCandidateScores,
  validComponentVersions,
  validPrivateIdentityTrace,
  validPublicObserverTrace,
} from './field-validators.ts'
import {
  validTrustedPassiveComponentAttribution,
  validateExactNativeScoreSurface,
} from './native-score-replay.ts'
import {
  exactPolicyHostSurface,
  replayExactDecisionLayerHostJoin,
} from './policy-host-surface.ts'
import {
  configuredNativeScorerVersion,
} from './production-registries.ts'
import {
  validComposedTraceRelations,
} from './relations.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

function validExactDecisionFrameTrace(
  trace: DecisionTrace,
  selectedDecision: Decision,
): boolean {
  const frame = trace.decisionFrame
  if (!frame) return false
  return frame.voice.version === trace.componentVersions?.voice
    && frame.voice.applied
      === !isDeepStrictEqual(trace.action, frame.committedMechanicalAction)
    && isDeepStrictEqual(
      mechanicalDecision(trace.action),
      frame.committedMechanicalAction,
    )
    && isDeepStrictEqual(
      mechanicalDecision(selectedDecision),
      frame.committedMechanicalAction,
    )
    && candidateIdForDecision(frame.committedMechanicalAction)
      === trace.chosenCandidateId
}

/**
 * Shared strict composed-trace admission for persisted artifacts and
 * generation-time benchmark capture. Unlike the external envelope validator,
 * this accepts finalized applied-outcome telemetry and validates score/action
 * relations against the selected decision supplied by replay.
 */
export interface ExactComposedTraceHostJoinInput {
  trace: DecisionTrace
  decisionLayerAdmission?: AdmittedDecisionLayerTrace
  req: DecisionRequest
  view: PlayerView
  /** Authoritative applied/replayed action, including normalized communication. */
  authoritativeAction: Decision
  /** Selected mechanical decision, before any engine fallback replacement. */
  selectedDecision: Decision
  deterministicSeed: string
  /**
   * Trusted construction-time witness, when the caller owns the producing
   * resolved brain. Self-contained external and stored traces cannot supply
   * it.
   */
  expectedComponentPlan?: DecisionComponentPlan
  /**
   * Out-of-band configured identity owned by the producing resolved brain.
   * Current exact score replay never accepts trace scorer labels as
   * provenance.
   */
  expectedArchitectureIdentity?: ResolvedArchitectureIdentity
  /** Require the component-bearing producer schema even for an empty plan. */
  expectComponentTrace?: boolean
}

export function validExactComposedTraceHostJoin(
  input: ExactComposedTraceHostJoinInput,
): boolean {
  try {
    const {
      trace,
      decisionLayerAdmission,
      req,
      view,
      authoritativeAction,
      selectedDecision,
      deterministicSeed,
      expectedComponentPlan,
      expectedArchitectureIdentity,
      expectComponentTrace,
    } = input
    const policyHostSurface = exactPolicyHostSurface(
      req,
      view,
      expectedArchitectureIdentity,
    )
    const decisionLayerReplay =
      policyHostSurface && expectedArchitectureIdentity
        ? replayExactDecisionLayerHostJoin(
            trace,
            decisionLayerAdmission,
            req,
            view,
            policyHostSurface,
            expectedArchitectureIdentity,
          )
        : undefined
    const strategicHostSurface =
      policyHostSurface && decisionLayerReplay
        ? {
            ...policyHostSurface,
            candidateBoundary: decisionLayerReplay.surface,
          }
        : policyHostSurface
    const genericRoleComponentsValid = validGenericComponentRun(trace, view)
    const genericRoleHostJoinValid = validGenericComponentRunHostJoin(
      trace,
      req,
      view,
      deterministicSeed,
    )
    if (
      !strategicHostSurface
      || !validMechanicalDecisionTraceHostJoin({
        trace,
        req,
        view,
        authoritativeAction,
        selectedDecision,
      })
      || !validDecisionTraceProvenance(trace)
      || !validComponentVersions(trace.componentVersions)
      || !validBeliefVersionRelation(trace)
      || !genericRoleComponentsValid
      || !genericRoleHostJoinValid
      || (
        expectedArchitectureIdentity !== undefined
        && (
          !policyHostSurface
          || !decisionLayerReplay
        )
      )
      || (
        expectComponentTrace === true
        && trace.version !== COMPONENT_DECISION_TRACE_VERSION
      )
      || (
        expectedArchitectureIdentity !== undefined
        && !resolvedArchitectureIdentityTraceJoin(
          expectedArchitectureIdentity,
          trace,
        )
      )
      || (
        expectedComponentPlan !== undefined
        && (
          trace.version !== COMPONENT_DECISION_TRACE_VERSION
          || expectedArchitectureIdentity === undefined
          || !isDeepStrictEqual(
            trace.componentPlan,
            expectedComponentPlan,
          )
          || !validTrustedPassiveComponentAttribution(trace)
        )
      )
      || !validCandidateScores(trace.candidateScores, view.playerCount)
      || !validForcedPolicyResult(trace.forcedPolicyResult)
      || !validExactDecisionFrameTrace(trace, selectedDecision)
      || !validPublicObserverTrace(
        trace.publicObserver,
        trace,
        view,
      )
      || !validPrivateIdentityTrace(
        trace.privateIdentity,
        trace,
        view.rolesInPlay,
      )
      || (
        trace.version === DECISION_TRACE_VERSION
        && !validRoleTraceV1HostJoin({
          trace,
          req,
          view,
          deterministicSeed,
        })
      )
    ) return false
    const components = trace.componentVersions!

    const legal = legalCandidates(req, view)
    const scores = trace.candidateScores ?? []
    if (
      scores.length !== legal.length
      || scores.some(
        (score, index) => score.candidateId !== legal[index].id,
      )
    ) return false

    const configured = components.configuredScorer ?? components.scorer
    const nativeRun = trace.components
    // The retired flat role payloads can never be present, so a trace without
    // a generic component run carries no role projection at all.
    const roleUtility = nativeRun
      ? componentPayload(nativeRun, GOOD_ROLE_UTILITY_COMPONENT)
      : undefined
    const evilRoleUtility = nativeRun
      ? componentPayload(nativeRun, EVIL_ROLE_UTILITY_COMPONENT)
      : undefined
    const morganaObjective = nativeRun
      ? componentPayload(
          nativeRun,
          MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
        )
      : undefined
    const morganaUtility = nativeRun
      ? componentPayload(
          nativeRun,
          configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
            ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
            : MORGANA_ROLE_UTILITY_COMPONENT,
        )
      : undefined
    const morganaConfigured =
      configured === MORGANA_ROLE_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
    const d2Configured =
      configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const c2Configured =
      configured === ROLE_OBJECTIVE_SCORER_VERSION
      || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const c2Resolved =
      components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
      || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    const exactNativeInputs =
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      && isHostReconstructibleCognition(components)
    if (
      morganaConfigured
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const seeded = configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
      const applicable =
        view.role === 'morgana'
        && (req.kind === 'propose' || req.kind === 'vote')
      const applied =
        applicable
        && morganaUtility !== undefined
        && !trace.degradation.includes(MORGANA_ROLE_SCORER_DEGRADATION)
      const d2Base = seeded
        ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        : EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      const downstream = (
        (req.kind === 'propose' || req.kind === 'vote')
        && view.alignment === 'evil'
      )
        ? d2Base
        : (
            (req.kind === 'propose' || req.kind === 'vote')
            && (view.role === 'merlin' || view.role === 'percival')
          )
          ? seeded
            ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            : ROLE_OBJECTIVE_SCORER_VERSION
          : seeded
            ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
            : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      const expectedResolved = applied ? configured : downstream
      if (
        components.scorer !== expectedResolved
        || components.configuredScorer !== (
          expectedResolved === configured ? undefined : configured
        )
      ) return false
      if (applied) {
        const projection = morganaUtility!
        const selectionMode =
          configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
            ? 'seeded-near-equal-vote-within-d2-band'
            : 'top-counterfeit-within-d2-band'
        if (
          !morganaObjective
          || !evilRoleUtility
          || !validatePrivateMorganaRoleUtilityHostJoin(projection, {
            req,
            view,
            candidates: legal,
            forced: trace.forcedPolicyResult!,
            counterfeitObjective: morganaObjective,
            evilRoleUtility,
            selectionMode,
            deterministicSeed,
          })
        ) return false
      }
    }
    if (
      (c2Configured || c2Resolved)
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const applicable =
        (req.kind === 'propose' || req.kind === 'vote')
        && (view.role === 'merlin' || view.role === 'percival')
      const roleApplied =
        applicable
        && roleUtility !== undefined
        && !trace.degradation.includes('role-objective-scorer-failed')
      const seeded =
        configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
        || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      const base = seeded
        ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      const expectedResolved = roleApplied
        ? seeded
          ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          : ROLE_OBJECTIVE_SCORER_VERSION
        : base
      if (components.scorer !== expectedResolved) return false
    }
    if (
      d2Configured
      && trace.version === DECISION_TRACE_VERSION
    ) {
      const eligible =
        (req.kind === 'propose' || req.kind === 'vote')
        && view.alignment === 'evil'
      const d2Applied =
        eligible
        && evilRoleUtility !== undefined
        && !trace.degradation.includes('evil-role-objective-scorer-failed')
      const seeded =
        configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      const expectedResolved = d2Applied
        ? configured
        : (
            (req.kind === 'propose' || req.kind === 'vote')
            && (view.role === 'merlin' || view.role === 'percival')
          )
          ? seeded
            ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
            : ROLE_OBJECTIVE_SCORER_VERSION
          : seeded
            ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
            : GOOD_PROPOSAL_VOTE_SCORER_VERSION
      if (
        components.scorer !== expectedResolved
        || components.configuredScorer !== (
          expectedResolved === configured ? undefined : configured
        )
      ) return false
    }

    if (
      exactNativeInputs
      && configuredNativeScorerVersion(components.scorer)
      && (
        expectedArchitectureIdentity === undefined
        || !validateExactNativeScoreSurface(
          trace,
          req,
          view,
          deterministicSeed,
          strategicHostSurface,
          expectedArchitectureIdentity,
        )
      )
    ) return false

    const expectedBucket = stablePolicyBucket([
      deterministicSeed,
      req.seat,
      req.kind,
      req.round,
      req.proposalNum,
      trace.beliefThroughSeq,
    ].join(':'))
    const invalidSeedBucket = scores.some((score) => {
      const baseBucket = score.features?.version === GOOD_VOTE_FEATURE_VERSION
        ? score.features.seedBucket
        : undefined
      const roleBucket = score.roleObjectiveFeatures?.seedBucket
      const evilBucket = score.evilRoleObjectiveFeatures?.seedBucket
      const morganaBucket =
        score.morganaRoleObjectiveFeatures?.seedBucket
      const expectedEvilBucket = stablePolicyBucket([
        deterministicSeed,
        req.seat,
        req.kind,
        req.round,
        req.proposalNum,
        trace.beliefThroughSeq,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].join(':'))
      return (
        baseBucket !== undefined && baseBucket !== expectedBucket
      ) || (
        roleBucket !== undefined && roleBucket !== expectedBucket
      ) || (
        evilBucket !== undefined && evilBucket !== expectedEvilBucket
      ) || (
        morganaBucket !== undefined
        && morganaBucket !== stablePolicyBucket([
          deterministicSeed,
          req.seat,
          req.kind,
          req.round,
          req.proposalNum,
          trace.beliefThroughSeq,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].join(':'))
      )
    })
    if (invalidSeedBucket) return false

    const relationTrace: DecisionTrace = structuredClone(trace)
    relationTrace.action = structuredClone(selectedDecision)
    return validComposedTraceRelations(
      relationTrace,
      view.playerCount,
      view,
    )
  } catch {
    return false
  }
}

/**
 * Scorer-independent mechanical join shared by finalized admission paths.
 */
function validMechanicalDecisionTraceHostJoin(input: {
  trace: DecisionTrace
  req: DecisionRequest
  view: PlayerView
  authoritativeAction: Decision
  selectedDecision: Decision
}): boolean {
  const {
    trace,
    req,
    view,
    authoritativeAction,
    selectedDecision,
  } = input
  return req.seat === view.seat
    && selectedDecision.kind === req.kind
    && authoritativeAction.kind === req.kind
    && trace.viewerSeat === req.seat
    && isDeepStrictEqual(trace.request, req)
    && isDeepStrictEqual(trace.action, authoritativeAction)
    && trace.chosenCandidateId
      === candidateIdForDecision(selectedDecision)
}

export function validFinalizedDiagnosticDecisionTrace(
  req: DecisionRequest,
  authoritativeDecision: Decision,
  selectedDecision: Decision,
  candidate: DecisionTrace,
  hostView: PlayerView,
): boolean {
  return (
    validMechanicalDecisionTraceHostJoin({
      trace: candidate,
      req,
      view: hostView,
      authoritativeAction: authoritativeDecision,
      selectedDecision,
    })
    && validDecisionTraceProvenance(candidate)
    && validComponentVersions(candidate.componentVersions)
    && validBeliefVersionRelation(candidate)
    && validGenericComponentRun(candidate, hostView)
    && validPublicObserverTrace(
      candidate.publicObserver,
      candidate,
      hostView,
    )
    && validPrivateIdentityTrace(
      candidate.privateIdentity,
      candidate,
      hostView.rolesInPlay,
    )
  )
}
