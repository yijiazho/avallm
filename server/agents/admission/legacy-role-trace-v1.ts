/**
 * Isolated legacy reader for historical `decision-trace-v1` role-specific flat
 * projections.
 *
 * The seven flat role payloads are now refused at canonical ingress, so every
 * payload argument below is statically absent. What survives is the version and
 * degradation coherence a historical trace must still satisfy: a v1 trace may
 * declare a role component it produced, but it can no longer evidence one, so
 * the declaration must be accompanied by the matching degradation.
 *
 * The current composed trace (`COMPONENT_DECISION_TRACE_VERSION`) omits every
 * flat role field. Role objectives, role utilities, the evil/Oberon pair, and
 * the Morgana counterfeit projections all travel in the generic component run
 * instead, and no current write path emits them. Every validator below is
 * therefore reachable only for a stored v1 artifact.
 *
 * Isolation is the point. This module owns all role-named v1 trace knowledge
 * behind two version-gated entry points, so the generic admission owner no
 * longer carries ten role-specific validators and registering a new role never
 * edits this file. Architecture fitness pins the generic owner as the only
 * permitted importer.
 */

import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type { DecisionTrace } from '../trace.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
} from '../analysis/role-objective-types.ts'
import type { TraceValidationInput } from './trace-primitives.ts'
import {
  enumStringArray,
  stringArray,
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
  buildEvilRoleUtilityProjection,
  validatePrivateEvilRoleUtilityHostJoin,
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
  buildMorganaRoleUtilityProjection,
  validatePrivateMorganaRoleUtilityHostJoin,
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
  roleObjectiveIdentityScope,
  validatePrivateRoleObjectiveHostJoin,
} from '../analysis/role-objectives.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  buildRoleUtilityProjection,
  validatePrivateRoleUtilityHostJoin,
  validatePrivateRoleUtilityProjection,
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
  hypotheticalProposalCandidates,
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
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const configured = components?.configuredMorganaCounterfeitObjective
  const readVersion = components?.morganaCounterfeitPublicRead
  const objectiveVersion = components?.morganaCounterfeitObjective
  const read = undefined
  const objective = undefined
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
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
      && components?.belief === EXACT_BELIEF_MODEL_VERSION
      && components?.factors === 'off'
      && components?.languageEvidence === 'off'
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
    || components?.belief !== EXACT_BELIEF_MODEL_VERSION
    || components?.factors !== 'off'
    || components?.languageEvidence !== 'off'
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

function validMorganaRolePolicyTrace(
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
  deterministicSeed?: string,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const configured = components?.configuredMorganaRoleUtility
  const resolved = components?.morganaRoleUtility
  const projection = undefined
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
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
      && components?.belief === EXACT_BELIEF_MODEL_VERSION
      && components?.factors === 'off'
      && components?.languageEvidence === 'off'
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
    // projection can be reconstructed from a historical trace.
    return true
  }
  return resolved === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    && validatePrivateMorganaRoleUtilityProjection(projection)
    && components?.morganaCounterfeitObjective
      === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    && components?.evilRoleUtility === EVIL_ROLE_UTILITY_PROJECTION_VERSION
}

function validPrivateRoleObjectiveTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
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
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
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
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const router = components?.roleObjectiveRouter
  const declared = components?.roleObjective
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
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
    const exactNonLanguage =
      components.belief === EXACT_BELIEF_MODEL_VERSION
      && components.languageEvidence === 'off'
      && components.factors === 'off'
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
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
  const router = components?.roleObjectiveRouter
  if (router === undefined) {
    return components?.roleObjective !== EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && undefined === undefined
  }
  if (router !== ROLE_OBJECTIVE_ROUTER_VERSION || !hostView) return false
  const expected = routedRoleObjectiveModel(hostView.role)
  return components?.roleObjective === (
    expected === 'off' ? undefined : expected
  )
}

function validPrivateRoleUtilityTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
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
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
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
    if (
      hostView
      && undefined
      && trace.publicObserver
    ) {
      try {
        buildRoleUtilityProjection({
          req,
          view: hostView,
          objective: undefined as never,
          observer: trace.publicObserver as never,
          candidates: legalCandidates(req, hostView),
        })
        return false
      } catch {
        return true
      }
    }
    return true
  }
  // A declared C2 projection can no longer be evidenced: its payload and the
  // C1 objective it joins against are both refused at ingress.
  return false
}

function validPrivateEvilRoleUtilityTrace(
  value: unknown,
  trace: TraceValidationInput,
  req: DecisionRequest,
  hostView?: PlayerView,
): boolean {
  const components = trace.componentVersions as
    | Record<string, unknown>
    | undefined
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
  const degradation = Array.isArray(trace.degradation)
    ? trace.degradation as unknown[]
    : []
  const dependencyDegradation = [
    'identity-projection-failed',
    EVIL_ROLE_OBJECTIVE_DEGRADATION,
    EVIL_ROLE_UTILITY_DEGRADATION,
  ]
  const atomicWeightedDependencyFailure =
    trace.quality === 'weighted'
    && value === undefined
    && trace.privateIdentity === undefined
    && undefined === undefined
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
  const exactNonLanguage =
    components.belief === EXACT_BELIEF_MODEL_VERSION
    && components.languageEvidence === 'off'
    && components.factors === 'off'
  if (!applicable || !exactNonLanguage) return true

  try {
    const belief = exactBelief(view)
    if (
      trace.beliefModelVersion !== belief.modelVersion
      || trace.beliefThroughSeq !== belief.throughSeq
      || trace.quality !== belief.quality
      || !isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
    ) return false

    const scope = trace.privateIdentity
      ? {
          roleQueries: trace.privateIdentity.scope.roleQueries.map(
            (query) => ({ roles: [...query.queriedRoles] }),
          ),
          hiddenTeam: trace.privateIdentity.scope.hiddenTeam,
        }
      : roleObjectiveIdentityScope(role, view.rolesInPlay)
    const identity = projectJointIdentity(belief, scope)
    const observer = observePublicRecord(projectPublicRecord(view))
    const candidates = legalCandidates(req, view)
    const objective = buildRoleObjectiveSnapshot({
      req,
      view,
      identity,
      observer,
      candidates,
    })
    const utility = buildRoleUtilityProjection({
      req,
      view,
      objective,
      observer,
      candidates,
    })
    return (
      components.identityModel === JOINT_IDENTITY_MODEL_VERSION
      && components.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
      && components.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
      && !trace.degradation.includes('identity-projection-failed')
      && !trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      && !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
      && isDeepStrictEqual(trace.privateIdentity, identity)
      && isDeepStrictEqual(trace.publicObserver, observer)
      && isDeepStrictEqual(undefined, objective)
      && isDeepStrictEqual(undefined, utility)
    )
  } catch {
    return false
  }
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
  const exactNonLanguage =
    components.belief === EXACT_BELIEF_MODEL_VERSION
    && components.languageEvidence === 'off'
    && components.factors === 'off'
  if (!applicable) return true
  if (!exactNonLanguage) {
    const identityFailed = trace.degradation.includes(
      'identity-projection-failed',
    )
    const objectiveFailed = trace.degradation.includes(
      EVIL_ROLE_OBJECTIVE_DEGRADATION,
    )
    const complete =
      trace.privateIdentity !== undefined
      && trace.privateIdentity.scope.hiddenTeam
      && undefined !== undefined
      && !identityFailed
      && !objectiveFailed
    const pairedFailure =
      trace.privateIdentity === undefined
      && undefined === undefined
      && identityFailed
      && objectiveFailed
    return complete || pairedFailure
  }

  try {
    const belief = exactBelief(view)
    if (
      trace.beliefModelVersion !== belief.modelVersion
      || trace.beliefThroughSeq !== belief.throughSeq
      || trace.quality !== belief.quality
      || !isDeepStrictEqual(
        trace.beliefPlayerMarginals,
        belief.playerMarginals,
      )
    ) return false
    const identity = projectJointIdentity(belief, {
      roleQueries: trace.privateIdentity
        ? trace.privateIdentity.scope.roleQueries.map(
            (query) => ({ roles: [...query.queriedRoles] }),
          )
        : [],
      hiddenTeam: true,
    })
    const observer = observePublicRecord(projectPublicRecord(view))
    const candidates = legalCandidates(req, view)
    const objective = buildEvilRoleObjectiveSnapshot({
      req,
      view,
      identity,
      observer,
      candidates,
    })
    const d2Applied =
      components.scorer === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || components.scorer === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || components.scorer === MORGANA_ROLE_SCORER_VERSION
      || components.scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
    const alternativeObjective = req.kind === 'vote'
      ? buildEvilRoleObjectiveSnapshot({
          req: { ...req, kind: 'propose' },
          view,
          identity,
          observer,
          candidates: hypotheticalProposalCandidates(view),
        })
      : undefined
    const utility = d2Applied
      ? buildEvilRoleUtilityProjection({
          req,
          view,
          objective,
          candidates,
          ...(alternativeObjective ? { alternativeObjective } : {}),
        })
      : undefined
    return (
      components.identityModel === JOINT_IDENTITY_MODEL_VERSION
      && components.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
      && components.roleObjective
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
      && !trace.degradation.includes('identity-projection-failed')
      && !trace.degradation.includes(
        EVIL_ROLE_OBJECTIVE_DEGRADATION,
      )
      && isDeepStrictEqual(trace.privateIdentity, identity)
      && isDeepStrictEqual(trace.publicObserver, observer)
      && isDeepStrictEqual(undefined, objective)
      && (
        d2Applied
          ? (
              components.evilRoleUtility
                === EVIL_ROLE_UTILITY_PROJECTION_VERSION
              && !trace.degradation.includes(
                EVIL_ROLE_UTILITY_DEGRADATION,
              )
              && isDeepStrictEqual(undefined, utility)
            )
          : (
              components.evilRoleUtility === undefined
              && undefined === undefined
            )
      )
    )
  } catch {
    return false
  }
}

function isRoleObjectiveRole(role: string): role is RoleObjectiveRole {
  return role === 'merlin' || role === 'percival'
}

/**
 * Structural v1 role admission. Callers gate this on the trace being a v1
 * `decision-trace-v1` record; it never inspects a current component trace.
 */
export function validLegacyRoleTraceV1(input: {
  readonly trace: TraceValidationInput
  readonly req: DecisionRequest
  readonly view: PlayerView | undefined
}): boolean {
  const { trace, req, view } = input
  const record = trace as Record<string, unknown>
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
    && validMorganaRolePolicyTrace(trace, req, view)
  )
}

/**
 * Exact v1 role admission against a full host view, including the two role
 * dependency host joins. Callers gate this on the trace being a v1 record.
 */
export function validLegacyRoleTraceV1HostJoin(input: {
  readonly trace: DecisionTrace
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly deterministicSeed: string
}): boolean {
  const { trace, req, view, deterministicSeed } = input
  const components = trace.componentVersions
  const hasRoleObjective =
    components?.roleObjective !== undefined
    || undefined !== undefined
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
    && validMorganaRolePolicyTrace(trace, req, view, deterministicSeed)
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
export function validLegacyRoleDependencyHostJoinV1(input: {
  readonly trace: DecisionTrace
  readonly req: DecisionRequest
  readonly view: PlayerView
}): boolean {
  return (
    validateExactRoleDependencyHostJoin(input.trace, input.req, input.view)
    && validateRoutedEvilDependencyHostJoin(input.trace, input.req, input.view)
  )
}
