import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
  validatePrivateEvilRoleObjectiveSnapshot,
} from '../analysis/evil-objectives.ts'
import {
  MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateEvilRoleObjectiveSnapshot,
} from '../analysis/evil-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  validatePrivateRoleObjectiveHostJoin,
  validatePrivateRoleObjectiveSnapshot,
} from '../analysis/role-objectives.ts'
import {
  MAX_ROLE_OBJECTIVE_JSON_BYTES,
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateRoleObjectiveSnapshot,
} from '../analysis/role-objective-types.ts'
import {
  buildEvilRoleUtilityProjection,
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
  type PrivateEvilRoleUtilityProjection,
  validatePrivateEvilRoleUtilityHostJoin,
  validatePrivateEvilRoleUtilityProjection,
} from '../analysis/evil-role-utility.ts'
import {
  buildRoleUtilityProjection,
  MAX_ROLE_UTILITY_JSON_BYTES,
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
  validatePrivateRoleUtilityHostJoin,
  validatePrivateRoleUtilityProjection,
} from '../analysis/role-utility.ts'
import {
  validatePublicObserverSnapshot,
} from '../analysis/observer.ts'
import type {
  PublicObserverSnapshot,
} from '../analysis/observer-types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentitySnapshot,
} from '../belief/identity.ts'
import type {
  PrivateIdentitySnapshot,
} from '../belief/identity.ts'
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../policy/candidates.ts'
import { componentEnvelope } from './kernel.ts'
import type {
  ComponentAdmissionResult,
  ComponentHostInputDefinition,
  ComponentHostInputToken,
  ComponentToken,
  DecisionComponentContext,
  DecisionComponentDefinition,
} from './types.ts'
import {
  createDecisionComponentRegistry,
  type DecisionComponentRegistry,
} from './registry.ts'
import type { DecisionTrace } from '../trace.ts'

const MAX_ROOT_JSON_BYTES = 1_048_576

export const GOOD_ROLE_OBJECTIVE_COMPONENT:
ComponentToken<PrivateRoleObjectiveSnapshot> = Object.freeze({
  id: 'good-role-objective',
  version: ROLE_OBJECTIVE_MODEL_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const GOOD_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateRoleUtilityProjection> = Object.freeze({
  id: 'good-role-utility',
  version: ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const EVIL_ROLE_OBJECTIVE_COMPONENT:
ComponentToken<PrivateEvilRoleObjectiveSnapshot> = Object.freeze({
  id: 'evil-role-objective',
  version: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const EVIL_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateEvilRoleUtilityProjection> = Object.freeze({
  id: 'evil-role-utility',
  version: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})

export const PRIVATE_IDENTITY_INPUT:
ComponentHostInputToken<PrivateIdentitySnapshot> = Object.freeze({
  id: 'private-identity',
  version: JOINT_IDENTITY_MODEL_VERSION,
  privacy: 'private',
})
export const PRIVATE_PUBLIC_OBSERVER_INPUT:
ComponentHostInputToken<PublicObserverSnapshot> = Object.freeze({
  id: 'private-public-observer',
  version: PUBLIC_OBSERVER_MODEL_VERSION,
  privacy: 'private',
})

function admitted<Payload>(
  payload: Payload,
  exact: boolean,
): ComponentAdmissionResult<Payload> {
  return {
    admitted: true,
    payload,
    verification: exact ? 'exact' : 'structural',
    promotionEligible: exact,
  }
}

function rejected<Payload>(
  degradationCode: string,
): ComponentAdmissionResult<Payload> {
  return { admitted: false, degradationCode }
}

function privateContext(context: DecisionComponentContext): {
  req: Readonly<DecisionRequest>
  view: Readonly<PlayerView>
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
} {
  if (context.privacy !== 'private') {
    throw new Error('private role adapter received public context')
  }
  return {
    req: context.request,
    view: context.view,
    identity: context.hostInputs.require(PRIVATE_IDENTITY_INPUT),
    observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
  }
}

function exactQuality(
  objective: PrivateRoleObjectiveSnapshot
    | PrivateEvilRoleObjectiveSnapshot,
): boolean {
  return objective.source.beliefQuality === 'constraints-only'
}

export interface LegacyRoleAdapterConfiguration {
  readonly goodObjectiveAllDecisionKinds: boolean
}

export type LegacyRolePolicyFamily = 'good-role' | 'evil-role'

export interface LegacyRoleAdapterTraceBinding {
  readonly token: ComponentToken<unknown>
  readonly policyFamily: LegacyRolePolicyFamily
  payload(trace: DecisionTrace): unknown
  declaredVersion(trace: DecisionTrace): string | undefined
}

export const LEGACY_ROLE_ADAPTER_TRACE_BINDINGS:
readonly LegacyRoleAdapterTraceBinding[] = Object.freeze([
  Object.freeze({
    token: GOOD_ROLE_OBJECTIVE_COMPONENT,
    policyFamily: 'good-role' as const,
    payload: (trace: DecisionTrace) => trace.privateRoleObjective,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleObjective
        === ROLE_OBJECTIVE_MODEL_VERSION
        ? ROLE_OBJECTIVE_MODEL_VERSION
        : undefined,
  }),
  Object.freeze({
    token: GOOD_ROLE_UTILITY_COMPONENT,
    policyFamily: 'good-role' as const,
    payload: (trace: DecisionTrace) => trace.privateRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleUtility,
  }),
  Object.freeze({
    token: EVIL_ROLE_OBJECTIVE_COMPONENT,
    policyFamily: 'evil-role' as const,
    payload: (trace: DecisionTrace) => trace.privateEvilRoleObjective,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleObjective
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        ? EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        : undefined,
  }),
  Object.freeze({
    token: EVIL_ROLE_UTILITY_COMPONENT,
    policyFamily: 'evil-role' as const,
    payload: (trace: DecisionTrace) => trace.privateEvilRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.evilRoleUtility,
  }),
])

export function legacyRoleAdapterDefinitions(
  configuration: LegacyRoleAdapterConfiguration,
): readonly DecisionComponentDefinition<any>[] {
  const goodObjective: DecisionComponentDefinition<
    PrivateRoleObjectiveSnapshot
  > = {
    token: GOOD_ROLE_OBJECTIVE_COMPONENT,
    source: 'legacy-adapter',
    dependencies: [],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_ROLE_OBJECTIVE_JSON_BYTES,
    degradationCode: ROLE_OBJECTIVE_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && (context.view.role === 'merlin' || context.view.role === 'percival')
        && (
          configuration.goodObjectiveAllDecisionKinds
          || context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const payload = buildRoleObjectiveSnapshot({
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(GOOD_ROLE_OBJECTIVE_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      return validatePrivateRoleObjectiveSnapshot(payload)
        ? admitted(payload, exactQuality(payload))
        : rejected(ROLE_OBJECTIVE_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      return validatePrivateRoleObjectiveHostJoin(payload, {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(payload))
        : rejected(ROLE_OBJECTIVE_DEGRADATION)
    },
  }

  const goodUtility: DecisionComponentDefinition<
    PrivateRoleUtilityProjection
  > = {
    token: GOOD_ROLE_UTILITY_COMPONENT,
    source: 'legacy-adapter',
    dependencies: [GOOD_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_ROLE_UTILITY_JSON_BYTES,
    degradationCode: ROLE_UTILITY_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && (context.view.role === 'merlin' || context.view.role === 'percival')
        && (context.request.kind === 'propose' || context.request.kind === 'vote')
    },
    execute(context) {
      const { req, view, observer } = privateContext(context)
      const payload = buildRoleUtilityProjection({
        req,
        view,
        objective: context.dependencies.require(GOOD_ROLE_OBJECTIVE_COMPONENT),
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(GOOD_ROLE_UTILITY_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      return validatePrivateRoleUtilityProjection(payload)
        ? admitted(payload, true)
        : rejected(ROLE_UTILITY_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      const objective = host.dependencies.require(GOOD_ROLE_OBJECTIVE_COMPONENT)
      return validatePrivateRoleUtilityHostJoin(payload, {
        req,
        view,
        objective,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(objective))
        : rejected(ROLE_UTILITY_DEGRADATION)
    },
  }

  const evilObjective: DecisionComponentDefinition<
    PrivateEvilRoleObjectiveSnapshot
  > = {
    token: EVIL_ROLE_OBJECTIVE_COMPONENT,
    source: 'legacy-adapter',
    dependencies: [],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
    degradationCode: EVIL_ROLE_OBJECTIVE_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.alignment === 'evil'
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const payload = buildEvilRoleObjectiveSnapshot({
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(EVIL_ROLE_OBJECTIVE_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      return validatePrivateEvilRoleObjectiveSnapshot(payload)
        ? admitted(payload, exactQuality(payload))
        : rejected(EVIL_ROLE_OBJECTIVE_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      return validatePrivateEvilRoleObjectiveHostJoin(payload, {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(payload))
        : rejected(EVIL_ROLE_OBJECTIVE_DEGRADATION)
    },
  }

  const evilUtility: DecisionComponentDefinition<
    PrivateEvilRoleUtilityProjection
  > = {
    token: EVIL_ROLE_UTILITY_COMPONENT,
    source: 'legacy-adapter',
    dependencies: [EVIL_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
    degradationCode: EVIL_ROLE_UTILITY_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.alignment === 'evil'
        && (context.request.kind === 'propose' || context.request.kind === 'vote')
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const candidates = legalCandidates(req, view)
      const alternativeCandidates = req.kind === 'vote'
        ? hypotheticalProposalCandidates(view)
        : undefined
      const alternativeObjective = alternativeCandidates
        ? buildEvilRoleObjectiveSnapshot({
            req: { ...req, kind: 'propose' },
            view,
            identity,
            observer,
            candidates: alternativeCandidates,
          })
        : undefined
      const payload = buildEvilRoleUtilityProjection({
        req,
        view,
        objective: context.dependencies.require(EVIL_ROLE_OBJECTIVE_COMPONENT),
        candidates,
        ...(alternativeObjective ? { alternativeObjective } : {}),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(EVIL_ROLE_UTILITY_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      return validatePrivateEvilRoleUtilityProjection(payload)
        ? admitted(payload, true)
        : rejected(EVIL_ROLE_UTILITY_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      const candidates = legalCandidates(req, view)
      const alternativeCandidates = req.kind === 'vote'
        ? hypotheticalProposalCandidates(view)
        : undefined
      const alternativeObjective = alternativeCandidates
        ? buildEvilRoleObjectiveSnapshot({
            req: { ...req, kind: 'propose' },
            view,
            identity,
            observer,
            candidates: alternativeCandidates,
          })
        : undefined
      const objective = host.dependencies.require(EVIL_ROLE_OBJECTIVE_COMPONENT)
      return validatePrivateEvilRoleUtilityHostJoin(payload, {
        req,
        view,
        objective,
        identity,
        observer,
        candidates,
        ...(alternativeObjective && alternativeCandidates
          ? { alternativeObjective, alternativeCandidates }
          : {}),
      })
        ? admitted(payload, exactQuality(objective))
        : rejected(EVIL_ROLE_UTILITY_DEGRADATION)
    },
  }
  return [goodObjective, goodUtility, evilObjective, evilUtility]
}

function root<Value>(
  token: ComponentHostInputToken<Value>,
  validate: (value: unknown) => value is Value,
): ComponentHostInputDefinition<Value> {
  return {
    token,
    maxPayloadBytes: MAX_ROOT_JSON_BYTES,
    validate(value) {
      return validate(value)
        ? { valid: true, value }
        : { valid: false, degradationCode: 'role-adapter-root-invalid' }
    },
  }
}

export const LEGACY_ROLE_ADAPTER_HOST_INPUTS = Object.freeze([
  root(PRIVATE_IDENTITY_INPUT, validatePrivateIdentitySnapshot),
  root(PRIVATE_PUBLIC_OBSERVER_INPUT, validatePublicObserverSnapshot),
])

export function createLegacyRoleAdapterRegistry(
  configuration: LegacyRoleAdapterConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    legacyRoleAdapterDefinitions(configuration),
    { hostInputs: LEGACY_ROLE_ADAPTER_HOST_INPUTS },
  )
}
