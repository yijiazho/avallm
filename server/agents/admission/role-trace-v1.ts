/**
 * Role-component admission for the belief-only trace version, `decision-trace-v1`.
 *
 * `decision-trace-v1` is not historical: it is the base trace shape a decision
 * carries before a component run is attached. `createDecisionTrace` stamps it,
 * `composed.ts` overrides the version to `COMPONENT_DECISION_TRACE_VERSION` (v2)
 * once it attaches components, and the raw-LLM agent (`llm.ts`) does not, so
 * every raw-LLM decision and every belief-only external reply arrives here as a
 * live v1 trace. A clean v1 trace is admitted (external-diagnostic), not refused;
 * see `test/admission-results.test.ts`.
 *
 * What this module owns is the coherence a v1 trace must satisfy for its role
 * components. A v1 trace may name a role component in `componentVersions` (a
 * raw-LLM or external producer can claim one), but with no component run it can
 * never evidence one, so any such declaration must be accompanied by the
 * matching degradation. Every validator below enforces exactly that pairing.
 *
 * Genuinely retired, and not read here: the seven flat role payloads v1 traces
 * once carried. Those are refused at canonical ingress for every version by the
 * shared guard in `composed-trace.ts`, so every payload argument below is
 * statically absent; their field names survive only as leak-scan tombstones.
 * Role objectives, role utilities, the evil/Oberon pair, and the Morgana
 * counterfeit projections travel in the generic v2 component run instead.
 *
 * Isolation is the point. This module owns all role-named v1 trace knowledge
 * behind version-gated entry points, so the generic admission owner no longer
 * carries ten role-specific validators and registering a new role never edits
 * this file. `ARCH012` pins the generic owner as the only permitted importer.
 */

import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type {
  DecisionTrace,
} from '../trace.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
} from '../analysis/role-objective-types.ts'
import type {
  TraceValidationInput,
} from './trace-primitives.ts'
import {
  componentVersionsOf,
  degradationCodes,
  isExactNonLanguage,
  validForcedPolicyResult,
} from './trace-primitives.ts'

import type {
  RoleObjectiveRole,
} from '../analysis/role-objective-types.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../analysis/evil-objective-types.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
} from '../analysis/evil-objectives.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  validatePrivateEvilRoleUtilityProjection,
} from '../analysis/evil-role-utility.ts'
import {
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
} from '../analysis/morgana-counterfeit-types.ts'
import {
  buildMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  validatePrivateMorganaCounterfeitHostJoin,
  validatePrivateMorganaCounterfeitObjective,
  validatePublicCounterfeitMerlinRead,
  validatePublicCounterfeitMerlinReadHostJoin,
} from '../analysis/morgana-counterfeit.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  validatePrivateMorganaRoleUtilityProjection,
} from '../analysis/morgana-role-utility.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import {
  observePublicRecord,
} from '../analysis/observer.ts'
import {
  routedRoleObjectiveModel,
} from '../analysis/role-objective-router.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  validatePrivateRoleObjectiveHostJoin,
} from '../analysis/role-objectives.ts'
import {
  ROLE_UTILITY_DEGRADATION,
} from '../analysis/role-utility.ts'
import {
  exactBelief,
} from '../belief/exact.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
} from '../belief/identity.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../belief/types.ts'
import {
  projectPublicRecord,
} from '../communication/public-record.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
} from '../components/native-score-components.ts'
import {
  legalCandidates,
} from '../policy/candidates.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../policy/score.ts'
import {
  DECISION_TRACE_VERSION,
} from '../trace.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

function validMorganaCounterfeitTrace(
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const configured = components?.configuredMorganaCounterfeitObjective
  const readVersion = components?.morganaCounterfeitPublicRead
  const objectiveVersion = components?.morganaCounterfeitObjective
  // v1 flat-payload witness slots: always undefined at ingress (the flat public
  // read and counterfeit objective are refused), kept as the cross-language door.
  const read = undefined
  const objective = undefined
  const degradation = degradationCodes(trace)
  const degraded = degradation.includes(MORGANA_COUNTERFEIT_DEGRADATION)
  if (configured === undefined) {
    return readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
      && !degraded
  }
  if (
    configured !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || !hostView
  ) return false
  const applicable =
    hostView.role === 'morgana'
    && (req.kind === 'propose' || req.kind === 'vote')
  if (!applicable) {
    return readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
      && !degraded
  }
  if (degraded) {
    const atomic = readVersion === undefined
      && objectiveVersion === undefined
      && read === undefined
      && objective === undefined
    if (!atomic) return false
    const exactReconstructable =
      trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
      && isExactNonLanguage(components)
    if (!exactReconstructable) return true
    try {
      const belief = exactBelief(hostView)
      const publicRead = buildPublicCounterfeitMerlinRead(
        projectPublicRecord(hostView),
      )
      buildMorganaCounterfeitObjective({
        req,
        view: hostView,
        belief,
        publicRead,
        candidates: legalCandidates(req, hostView),
      })
      return false
    } catch {
      return true
    }
  }
  if (
    readVersion !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || objectiveVersion !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    || components?.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
    || !validatePublicCounterfeitMerlinRead(read)
    || !validatePrivateMorganaCounterfeitObjective(objective)
  ) return false
  const publicRecord = projectPublicRecord(hostView)
  if (!validatePublicCounterfeitMerlinReadHostJoin(read, publicRecord)) {
    return false
  }
  if (
    trace.beliefModelVersion !== EXACT_BELIEF_MODEL_VERSION
    || !isExactNonLanguage(components)
  ) {
    // Weighted transport does not carry the complete world list. The generic
    // entry may remain structurally readable, but it cannot claim exact host
    // verification or promotion eligibility.
    const genericObjective =
      (trace.components as DecisionTrace['components'])?.entries.find(
        (entry) =>
          entry.component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
      )
    return genericObjective?.status === 'admitted'
      && genericObjective.verification === 'structural'
      && genericObjective.promotionEligible === false
  }
  try {
    const belief = exactBelief(hostView)
    return (
      belief.throughSeq === trace.beliefThroughSeq
      && belief.quality === trace.quality
      && isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
      && validatePrivateMorganaCounterfeitHostJoin(objective, {
        req,
        view: hostView,
        belief,
        publicRead: read,
        candidates: legalCandidates(req, hostView),
      })
    )
  } catch {
    return false
  }
}

function validMorganaRoleUtilityTrace(
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const configured = components?.configuredMorganaRoleUtility
  const resolved = components?.morganaRoleUtility
  // v1 flat-payload witness slot: always undefined at ingress (the flat Morgana
  // role-utility projection is refused), kept as the cross-language door.
  const projection = undefined
  const degradation = degradationCodes(trace)
  const degraded = degradation.includes(MORGANA_ROLE_UTILITY_DEGRADATION)
  if (configured === undefined) {
    return resolved === undefined
      && projection === undefined
      && !degraded
  }
  if (
    configured !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    || !hostView
  ) return false
  const applicable =
    hostView.role === 'morgana'
    && (req.kind === 'propose' || req.kind === 'vote')
  if (!applicable) {
    return resolved === undefined
      && projection === undefined
      && !degraded
  }
  if (degraded) {
    const atomic = resolved === undefined
      && projection === undefined
      && components?.scorer !== MORGANA_ROLE_SCORER_VERSION
      && components?.scorer !== MORGANA_ROLE_SEEDED_SCORER_VERSION
    if (!atomic) return false
    const exactReconstructable =
      trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
      && isExactNonLanguage(components)
    if (!exactReconstructable) return true
    const configuredScorer =
      components?.configuredScorer ?? components?.scorer
    if (
      configuredScorer !== MORGANA_ROLE_SCORER_VERSION
      && configuredScorer !== MORGANA_ROLE_SEEDED_SCORER_VERSION
    ) return false
    const forcedResult = trace.forcedPolicyResult
    if (
      !validatePrivateMorganaCounterfeitObjective(
        undefined,
      )
      || !validatePrivateEvilRoleUtilityProjection(
        undefined,
      )
      || forcedResult === undefined
      || !validForcedPolicyResult(forcedResult)
    ) {
      // Upstream exact-dependency admission independently decides whether an
      // absent or malformed prerequisite is an honest narrow degradation.
      return true
    }
    // With the retired E1A and D2 payloads absent, the prerequisite check
    // above always yields to upstream exact-dependency admission, so no E1B
    // projection can be reconstructed from a v1 trace.
    return true
  }
  return resolved === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    && validatePrivateMorganaRoleUtilityProjection(projection)
    && components?.morganaCounterfeitObjective
      === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    && components?.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
}

function validPrivateRoleObjectiveTrace(
  // v1 flat-payload witness slot: always undefined at ingress (the flat role
  // objective is refused for every version), retained as the cross-language door.
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const declared = components?.roleObjective
  if (
    declared !== undefined
    && declared !== ROLE_OBJECTIVE_MODEL_VERSION
  ) {
    return value === undefined
      && !(
        Array.isArray(trace.degradation)
        && trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      )
  }
  const degradation = degradationCodes(trace)
  const roleDegraded = degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
  if (
    !hostView
    || (hostView.role !== 'merlin' && hostView.role !== 'percival')
  ) {
    return declared === undefined
      && value === undefined
      && !roleDegraded
  }
  if (
    components?.identityModel !== JOINT_IDENTITY_MODEL_VERSION
    || components.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
  ) return false
  if (value === undefined) {
    const degradedDeclaration =
      trace.version === DECISION_TRACE_VERSION
        ? declared === ROLE_OBJECTIVE_MODEL_VERSION
        : declared === undefined
    if (!degradedDeclaration || !roleDegraded) return false
    if (!trace.privateIdentity) {
      return degradation.includes('identity-projection-failed')
    }
    if (!trace.publicObserver) return false
    try {
      buildRoleObjectiveSnapshot({
        req,
        view: hostView,
        identity: trace.privateIdentity as never,
        observer: trace.publicObserver as never,
        candidates: legalCandidates(req, hostView),
      })
      return false
    } catch {
      return true
    }
  }
  if (
    declared !== ROLE_OBJECTIVE_MODEL_VERSION
    || roleDegraded
    || !trace.privateIdentity
    || !trace.publicObserver
  ) {
    return false
  }
  try {
    return validatePrivateRoleObjectiveHostJoin(value, {
      req,
      view: hostView,
      identity: trace.privateIdentity as never,
      observer: trace.publicObserver as never,
      candidates: legalCandidates(req, hostView),
    })
  } catch {
    return false
  }
}

function validPrivateEvilRoleObjectiveTrace(
  // v1 flat-payload witness slot: always undefined at ingress (the flat evil role
  // objective is refused for every version), retained as the cross-language door.
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const router = components?.roleObjectiveRouter
  const declared = components?.roleObjective
  const degradation = degradationCodes(trace)
  const roleDegraded = degradation.includes(
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
  )
  if (router === undefined) {
    return declared !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && value === undefined
      && !roleDegraded
  }
  if (router !== ROLE_OBJECTIVE_ROUTER_VERSION || !hostView) return false
  const routed = routedRoleObjectiveModel(hostView.role)
  if (routed !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION) {
    return value === undefined && !roleDegraded
  }
  if (
    components?.identityModel !== JOINT_IDENTITY_MODEL_VERSION
    || components?.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
  ) return false
  const observer = observePublicRecord(projectPublicRecord(hostView))
  const candidates = legalCandidates(req, hostView)
  if (value === undefined) {
    const degradedDeclaration =
      trace.version === DECISION_TRACE_VERSION
        ? declared === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        : declared === undefined
    if (!degradedDeclaration || !roleDegraded) return false
    if (trace.privateIdentity) {
      try {
        buildEvilRoleObjectiveSnapshot({
          req,
          view: hostView,
          identity: trace.privateIdentity as never,
          observer,
          candidates,
        })
        return false
      } catch {
        return true
      }
    }
    const exactNonLanguage = isExactNonLanguage(components)
    if (!exactNonLanguage) {
      return degradation.includes('identity-projection-failed')
    }
    try {
      const identity = projectJointIdentity(exactBelief(hostView), {
        roleQueries: [],
        hiddenTeam: true,
      })
      buildEvilRoleObjectiveSnapshot({
        req,
        view: hostView,
        identity,
        observer,
        candidates,
      })
      return false
    } catch {
      return true
    }
  }
  return declared === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    && !roleDegraded
    && !!trace.privateIdentity
    && validatePrivateEvilRoleObjectiveHostJoin(value, {
      req,
      view: hostView,
      identity: trace.privateIdentity as never,
      observer,
      candidates,
    })
}

function validRoleObjectiveRoute(
  trace: TraceValidationInput,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const router = components?.roleObjectiveRouter
  if (router === undefined) {
    return components?.roleObjective !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  }
  if (router !== ROLE_OBJECTIVE_ROUTER_VERSION || !hostView) return false
  const expected = routedRoleObjectiveModel(hostView.role)
  return components?.roleObjective === (
    expected === 'off' ? undefined : expected
  )
}

function validPrivateRoleUtilityTrace(
  // v1 flat-payload witness slot: always undefined at ingress (the flat role
  // utility is refused for every version), retained as the cross-language door.
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const declared = components?.roleUtility
  const configured = components?.configuredScorer ?? components?.scorer
  const configuredForRole = (
    configured === ROLE_OBJECTIVE_SCORER_VERSION
    || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || components?.scorer === ROLE_OBJECTIVE_SCORER_VERSION
    || components?.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || (
      (
        configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
        || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      )
      && (hostView?.role === 'merlin' || hostView?.role === 'percival')
    )
  )
  const applicable =
    configuredForRole
    && (req.kind === 'propose' || req.kind === 'vote')
    && (hostView?.role === 'merlin' || hostView?.role === 'percival')
  const degradation = degradationCodes(trace)
  if (!applicable) {
    return declared === undefined
      && value === undefined
      && !degradation.includes(ROLE_UTILITY_DEGRADATION)
  }
  if (value === undefined) {
    if (
      declared !== undefined
      || !degradation.includes(ROLE_UTILITY_DEGRADATION)
      || (
        components?.scorer !== GOOD_PROPOSAL_VOTE_SCORER_VERSION
        && components?.scorer !== GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      )
    ) return false
    // Reconstructing the C2 projection required the flat C1 objective, which
    // is refused at ingress, so a coherent degraded declaration is admitted
    // without a rebuild.
    return true
  }
  // A declared C2 projection can no longer be evidenced: its payload and the
  // C1 objective it joins against are both refused at ingress.
  return false
}

function validPrivateEvilRoleUtilityTrace(
  // v1 flat-payload witness slot: always undefined at ingress (the flat evil role
  // utility is refused for every version), retained as the cross-language door.
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = componentVersionsOf(trace)
  const configured = components?.configuredScorer ?? components?.scorer
  const applicable =
    (
      configured === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || configured === MORGANA_ROLE_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
    )
    && (req.kind === 'propose' || req.kind === 'vote')
    && hostView?.alignment === 'evil'
  const degradation = degradationCodes(trace)
  const dependencyDegradation = [
    'identity-projection-failed',
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
    EVIL_ROLE_UTILITY_DEGRADATION,
  ]
  const atomicWeightedDependencyFailure =
    trace.quality === 'weighted'
    && value === undefined
    && trace.privateIdentity === undefined
    && components?.evilRoleUtility === undefined
    && degradation.length === dependencyDegradation.length
    && dependencyDegradation.every((code) => degradation.includes(code))
    && (
      configured === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || configured === MORGANA_ROLE_SEEDED_SCORER_VERSION
        ? components?.scorer
          === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
        : components?.scorer === GOOD_PROPOSAL_VOTE_SCORER_VERSION
    )
  if (!applicable) {
    return components?.evilRoleUtility === undefined
      && value === undefined
      && !degradation.includes(EVIL_ROLE_UTILITY_DEGRADATION)
  }
  if (!hostView || !trace.publicObserver) return false
  // A declared D2 projection can no longer be evidenced either, so the only
  // remaining verdict is whether the weighted dependency failure is coherent.
  return atomicWeightedDependencyFailure
}

function validateExactRoleDependencyHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): boolean {
  const components = trace.componentVersions
  if (!components) return false
  const configured = components.configuredScorer ?? components.scorer
  const roleConfigured =
    configured === ROLE_OBJECTIVE_SCORER_VERSION
    || configured === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    || components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
    || components.scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  const role = view.role
  const applicable =
    roleConfigured
    && (req.kind === 'propose' || req.kind === 'vote')
    && isRoleObjectiveRole(role)
  const exactNonLanguage = isExactNonLanguage(components)
  // An applicable exact C1/C2 host join required the flat objective and
  // utility payloads to compare against a host reconstruction. Both are refused
  // at ingress, so the join can never succeed and the reconstruction is skipped
  // rather than computed and discarded.
  return !applicable || !exactNonLanguage
}

function validateRoutedEvilDependencyHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
): boolean {
  const components = trace.componentVersions
  if (!components) return false
  const applicable =
    components.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
    && routedRoleObjectiveModel(view.role)
      === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const exactNonLanguage = isExactNonLanguage(components)
  if (!applicable) return true
  if (!exactNonLanguage) {
    const identityFailed = trace.degradation.includes(
      'identity-projection-failed',
    )
    const objectiveFailed = trace.degradation.includes(
      EVIL_ROLE_OBJECTIVE_DEGRADATION,
    )
    // A "complete" routed-evil dependency required the flat D1 objective
    // alongside the identity. That payload is refused at ingress, so only the
    // paired-failure shape remains provable for a v1 trace.
    return (
      trace.privateIdentity === undefined
      && identityFailed
      && objectiveFailed
    )
  }

  // The exact routed-evil host join compared the flat D1 objective, and the
  // D2 branch its flat utility, against a host reconstruction. Both payloads are
  // refused at ingress, so the join cannot succeed and the reconstruction is
  // skipped rather than computed and discarded.
  return false
}

function isRoleObjectiveRole(role: string): role is RoleObjectiveRole {
  return role === 'merlin' || role === 'percival'
}

/**
 * Structural v1 role admission. Callers gate this on the trace being a
 * `decision-trace-v1` record; it never inspects a v2 component trace.
 */
export function validRoleTraceV1(input: {
  readonly trace: TraceValidationInput
  readonly req: DecisionRequest
  readonly view: PlayerView | undefined
}): boolean {
  const { trace, req, view } = input
  return (
    validRoleObjectiveRoute(trace, view)
    && validPrivateRoleObjectiveTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validPrivateEvilRoleObjectiveTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validPrivateRoleUtilityTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validPrivateEvilRoleUtilityTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validMorganaCounterfeitTrace(trace, req, view)
    && validMorganaRoleUtilityTrace(trace, req, view)
  )
}

/**
 * Exact v1 role admission against a full host view, including the two role
 * dependency host joins. Callers gate this on the trace being a v1 record.
 */
export function validRoleTraceV1HostJoin(input: {
  readonly trace: DecisionTrace
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly deterministicSeed: string
}): boolean {
  // deterministicSeed stays on the input contract (callers pass it) but is no
  // longer read here: the Morgana role-utility validator it once fed dropped it.
  const { trace, req, view } = input
  const components = trace.componentVersions
  const hasRoleObjective =
    components?.roleObjective !== undefined
    || trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
  return (
    validRoleObjectiveRoute(trace, view)
    && validPrivateEvilRoleObjectiveTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validMorganaCounterfeitTrace(trace, req, view)
    && validMorganaRoleUtilityTrace(trace, req, view)
    && validateExactRoleDependencyHostJoin(trace, req, view)
    && validateRoutedEvilDependencyHostJoin(trace, req, view)
    && (
      !hasRoleObjective
      || validPrivateRoleObjectiveTrace(
        undefined,
        trace,
        req,
        view,
      )
    )
    && validPrivateRoleUtilityTrace(
      undefined,
      trace,
      req,
      view,
    )
    && validPrivateEvilRoleUtilityTrace(
      undefined,
      trace,
      req,
      view,
    )
  )
}

/**
 * The two v1 role dependency host joins, for the external diagnostic path that
 * has a full host view but no deterministic seed.
 */
export function validRoleDependencyHostJoinV1(input: {
  readonly trace: DecisionTrace
  readonly req: DecisionRequest
  readonly view: PlayerView
}): boolean {
  return (
    validateExactRoleDependencyHostJoin(input.trace, input.req, input.view)
    && validateRoutedEvilDependencyHostJoin(input.trace, input.req, input.view)
  )
}
