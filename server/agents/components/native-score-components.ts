/**
 * The built-in score-projection components and their host inputs.
 *
 * Each entry declares a score-family component token and wires it to the
 * analysis builder that produces its payload, through the shared role-projection
 * skeleton. The beliefIsExact predicate and the host-input tokens declared here
 * are also consumed by the sibling native role components module.
 */
import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  SITUATION_ANALYSIS_VERSION,
  type SituationAnalysis,
} from '../analysis/situation-types.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
  validateAdmittedPrivateEvilRoleObjectiveHostJoin,
} from '../analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateEvilRoleObjectiveSnapshot,
} from '../analysis/evil-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  decodeCanonicalPrivateRoleObjectiveSnapshot,
  validateAdmittedPrivateRoleObjectiveHostJoin,
} from '../analysis/role-objectives.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateRoleObjectiveSnapshot,
} from '../analysis/role-objective-types.ts'
import {
  buildAdmittedEvilRoleUtilityProjection,
  decodeCanonicalPrivateEvilRoleUtilityProjection,
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateEvilRoleUtilityProjection,
  validateAdmittedPrivateEvilRoleUtilityHostJoin,
} from '../analysis/evil-role-utility.ts'
import {
  buildAdmittedRoleUtilityProjection,
  decodeCanonicalPrivateRoleUtilityProjection,
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
  validateAdmittedPrivateRoleUtilityHostJoin,
} from '../analysis/role-utility.ts'
import { validatePublicObserverSnapshot } from '../analysis/observer.ts'
import type {
  PublicObserverSnapshot,
} from '../analysis/observer-types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  validatePrivateIdentitySnapshot,
} from '../belief/identity.ts'
import type {
  PrivateIdentitySnapshot,
} from '../belief/identity.ts'
import {
  type BeliefSnapshot,
} from '../belief/types.ts'
import {
  buildAdmittedMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  decodeCanonicalPrivateMorganaCounterfeitObjective,
  decodeCanonicalPublicCounterfeitMerlinRead,
  validateAdmittedPrivateMorganaCounterfeitHostJoin,
  validateAdmittedPublicCounterfeitMerlinReadHostJoin,
} from '../analysis/morgana-counterfeit.ts'
import {
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type PrivateMorganaCounterfeitObjective,
  type PublicCounterfeitMerlinReadSnapshot,
} from '../analysis/morgana-counterfeit-types.ts'
import {
  buildAdmittedMorganaRoleUtilityProjection,
  decodeCanonicalPrivateMorganaRoleUtilityProjection,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type MorganaRoleSelectionMode,
  type PrivateMorganaRoleUtilityProjection,
  validateAdmittedPrivateMorganaRoleUtilityHostJoin,
} from '../analysis/morgana-role-utility.ts'
import {
  buildServantObjective,
  decodeCanonicalServantObjectiveSnapshot,
  validateAdmittedServantObjectiveHostJoin,
} from '../analysis/servant-objective.ts'
import {
  SERVANT_OBJECTIVE_DEGRADATION,
  SERVANT_OBJECTIVE_MODEL_VERSION,
  type ServantObjectiveSnapshot,
} from '../analysis/servant-objective-types.ts'
import {
  buildServantRoleUtilityProjection,
  decodeCanonicalServantRoleUtilityProjection,
  SERVANT_ROLE_UTILITY_DEGRADATION,
  SERVANT_ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateServantRoleUtilityProjection,
  validateAdmittedServantRoleUtilityHostJoin,
} from '../analysis/servant-role-utility.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../candidate/candidates.ts'
import {
  appliesFrom,
  merlinSeated,
  EVIL_CLAIM,
  MORGANA_CLAIM,
  SERVANT_CLAIM,
} from '../candidate/applicability.ts'
import {
  FORCED_POLICY_VERSION,
  type ForcedPolicyResult,
} from '../candidate/types.ts'
import {
  publicRoleProjection,
  roleProjection,
  type PrivateComponentContext,
} from './role-projection.ts'
import type {
  ComponentHostInputDefinition,
  ComponentHostInputToken,
  ComponentToken,
  DecisionComponentDefinition,
} from './types.ts'
import {
  createDecisionComponentRegistry,
  type DecisionComponentRegistry,
} from './registry.ts'

const MAX_ROOT_JSON_BYTES = 1_048_576
const MAX_BELIEF_ROOT_JSON_BYTES = 16_777_216

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
/**
 * Private despite being built from public inputs alone.
 *
 * Nothing in the payload is secret, but the component only APPLIES to a
 * servant seat, so its presence on a decision is itself the private fact. A
 * public token would publish "this seat is a servant" to every spectator
 * through the run entry, without a single secret field.
 */
export const SERVANT_OBJECTIVE_COMPONENT:
ComponentToken<ServantObjectiveSnapshot> = Object.freeze({
  id: 'servant-objective',
  version: SERVANT_OBJECTIVE_MODEL_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const SERVANT_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateServantRoleUtilityProjection> = Object.freeze({
  id: 'servant-role-utility',
  version: SERVANT_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT:
ComponentToken<PrivateMorganaCounterfeitObjective> = Object.freeze({
  id: 'morgana-counterfeit-objective',
  version: MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT:
ComponentToken<PublicCounterfeitMerlinReadSnapshot> = Object.freeze({
  id: 'morgana-counterfeit-public-read',
  version: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  kind: 'observer',
  privacy: 'public',
})
export const MORGANA_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateMorganaRoleUtilityProjection> = Object.freeze({
  id: 'morgana-role-utility',
  version: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const MORGANA_ROLE_UTILITY_SEEDED_COMPONENT:
ComponentToken<PrivateMorganaRoleUtilityProjection> = Object.freeze({
  id: 'morgana-role-utility-seeded',
  version: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
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
export const PRIVATE_BELIEF_INPUT:
ComponentHostInputToken<BeliefSnapshot> = Object.freeze({
  id: 'private-resolved-belief',
  version: 'resolved-belief-snapshot-v1',
  privacy: 'private',
})
export const PRIVATE_SITUATION_INPUT:
ComponentHostInputToken<SituationAnalysis> = Object.freeze({
  id: 'private-situation-analysis',
  version: SITUATION_ANALYSIS_VERSION,
  privacy: 'private',
})
export const PRIVATE_FORCED_POLICY_INPUT:
ComponentHostInputToken<ForcedPolicyResult> = Object.freeze({
  id: 'private-universal-forced-policy',
  version: FORCED_POLICY_VERSION,
  privacy: 'private',
})
export const PRIVATE_DETERMINISTIC_SEED_INPUT:
ComponentHostInputToken<string> = Object.freeze({
  id: 'private-deterministic-seed',
  version: 'deterministic-seed-v1',
  privacy: 'private',
})

function identityContext(context: PrivateComponentContext): {
  req: Readonly<DecisionRequest>
  view: Readonly<PlayerView>
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
} {
  return {
    req: context.request,
    view: context.view,
    identity: context.hostInputs.require(PRIVATE_IDENTITY_INPUT),
    observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
  }
}

function observerContext(context: PrivateComponentContext): {
  req: Readonly<DecisionRequest>
  view: Readonly<PlayerView>
  observer: PublicObserverSnapshot
} {
  return {
    req: context.request,
    view: context.view,
    observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
  }
}

/**
 * The single belief-exactness literal. A belief-derived payload is exact only
 * when it came from a constraints-only belief. Every native component routes
 * its detached and host exactness checks through this so the rule lives once.
 */
export function beliefIsExact(quality: string): boolean {
  return quality === 'constraints-only'
}

function exactQuality(
  objective: PrivateRoleObjectiveSnapshot
    | PrivateEvilRoleObjectiveSnapshot,
): boolean {
  return beliefIsExact(objective.source.beliefQuality)
}

export interface NativeScoreComponentConfiguration {
  readonly goodObjectiveAllDecisionKinds: boolean
}

/**
 * Derived once, like every sibling's `applies: appliesFrom(...)`. The servant
 * predicate is the one that has to be combined with a second condition, so it
 * needs a name rather than sitting inline; building it inside the callback
 * would rebuild the claim's kind set on every applicability evaluation.
 */
const servantClaimApplies = appliesFrom(SERVANT_CLAIM)

export function nativeScoreComponentDefinitions(
  configuration: NativeScoreComponentConfiguration,
): readonly DecisionComponentDefinition<any>[] {
  const goodObjective = roleProjection({
    token: GOOD_ROLE_OBJECTIVE_COMPONENT,
    degradationCode: ROLE_OBJECTIVE_DEGRADATION,
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    applies(context) {
      return (context.view.role === 'merlin' || context.view.role === 'percival')
        && (
          configuration.goodObjectiveAllDecisionKinds
          || context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    join(context) {
      const { req, view, identity, observer } = identityContext(context)
      return {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      }
    },
    build: buildRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateRoleObjectiveSnapshot,
    hostJoin: validateAdmittedPrivateRoleObjectiveHostJoin,
    detachedExact: exactQuality,
  })

  const goodUtility = roleProjection({
    token: GOOD_ROLE_UTILITY_COMPONENT,
    degradationCode: ROLE_UTILITY_DEGRADATION,
    dependencies: [GOOD_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    applies(context) {
      return (context.view.role === 'merlin' || context.view.role === 'percival')
        && (context.request.kind === 'propose' || context.request.kind === 'vote')
    },
    join(context) {
      const { req, view, observer } = observerContext(context)
      return {
        req,
        view,
        objective: context.dependencies.require(GOOD_ROLE_OBJECTIVE_COMPONENT),
        observer,
        candidates: legalCandidates(req, view),
      }
    },
    build: buildAdmittedRoleUtilityProjection,
    decode: decodeCanonicalPrivateRoleUtilityProjection,
    hostJoin: validateAdmittedPrivateRoleUtilityHostJoin,
    hostExact: (_payload, input) => exactQuality(input.objective),
  })

  const evilObjective = roleProjection({
    token: EVIL_ROLE_OBJECTIVE_COMPONENT,
    degradationCode: EVIL_ROLE_OBJECTIVE_DEGRADATION,
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    applies(context) {
      // Deliberately NOT appliesFrom(EVIL_CLAIM): the evil base objective is
      // computed for every evil seat on every decision kind, whereas EVIL_CLAIM
      // (and evilUtility below) narrows to propose/vote. Do not unify these.
      return context.view.alignment === 'evil'
    },
    join(context) {
      const { req, view, identity, observer } = identityContext(context)
      return {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      }
    },
    build: buildEvilRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
    hostJoin: validateAdmittedPrivateEvilRoleObjectiveHostJoin,
    detachedExact: exactQuality,
  })

  const evilUtility = roleProjection({
    token: EVIL_ROLE_UTILITY_COMPONENT,
    degradationCode: EVIL_ROLE_UTILITY_DEGRADATION,
    dependencies: [EVIL_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    applies: appliesFrom(EVIL_CLAIM),
    join(context) {
      const { req, view, identity, observer } = identityContext(context)
      // A vote is scored against the proposals this seat could have made
      // instead, so the alternative objective is part of the build input
      // rather than something each path recomputes for itself.
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
      return {
        req,
        view,
        objective: context.dependencies.require(EVIL_ROLE_OBJECTIVE_COMPONENT),
        candidates: legalCandidates(req, view),
        ...(alternativeObjective ? { alternativeObjective } : {}),
      }
    },
    build: buildAdmittedEvilRoleUtilityProjection,
    decode: decodeCanonicalPrivateEvilRoleUtilityProjection,
    hostJoin: validateAdmittedPrivateEvilRoleUtilityHostJoin,
    hostExact: (_payload, input) => exactQuality(input.objective),
  })

  // No dependencies, no host inputs, no belief. The whole objective is a
  // function of the public record and the acting seat, which is what made a
  // servant cheap to add: the two-axis read it consumes is already shared.
  const servantObjective = roleProjection({
    token: SERVANT_OBJECTIVE_COMPONENT,
    degradationCode: SERVANT_OBJECTIVE_DEGRADATION,
    // Both halves of the read have to exist for the objective to mean
    // anything. The servant half is implied by the role check, but the Merlin
    // half is not: validateRoles accepts a cast with no Merlin at all (it is
    // only required when Percival or Mordred is present), and the Merlin
    // likeness axis is undefined there. Without this clause such a game
    // reports 'degraded' with execution-failed on every servant decision,
    // which claims something broke when nothing did.
    // Only the Merlin half comes from the shared home. There is no servant
    // claim to reuse for the rest: this objective applies on every decision
    // kind, and an Applicability states a kind list, so a claim here would
    // enumerate the kinds rather than declare anything.
    applies(context) {
      return context.view.role === 'servant' && merlinSeated(context)
    },
    join: (context) => ({
      record: projectPublicRecord(context.view),
      seat: context.view.seat,
    }),
    build: buildServantObjective,
    decode: decodeCanonicalServantObjectiveSnapshot,
    hostJoin: validateAdmittedServantObjectiveHostJoin,
  })

  // Propose only, because that is where the measurement found room. Servant
  // VOTES separate (no exact ties) and the seeded band is already exploring
  // there, so displacing it would be a behavioral claim with nothing behind
  // it. Proposals need no such argument: they are tied 75 times in 76.
  const servantUtility = roleProjection({
    token: SERVANT_ROLE_UTILITY_COMPONENT,
    degradationCode: SERVANT_ROLE_UTILITY_DEGRADATION,
    // Through the shared claim, not an inline role check: the servant score
    // layer gates on exactly the same two conditions, and a decision this
    // component declines but that layer accepts reaches a required-component
    // read with nothing to read.
    applies: (context) =>
      servantClaimApplies(context) && merlinSeated(context),
    join: (context) => ({
      view: context.view,
      candidates: legalCandidates(context.request, context.view),
    }),
    build: buildServantRoleUtilityProjection,
    decode: decodeCanonicalServantRoleUtilityProjection,
    hostJoin: validateAdmittedServantRoleUtilityHostJoin,
  })

  const morganaPublicRead = publicRoleProjection({
    token: MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    degradationCode: MORGANA_COUNTERFEIT_DEGRADATION,
    applies(context) {
      return context.decision.kind === 'propose'
        || context.decision.kind === 'vote'
    },
    join: (context) => context.publicRecord,
    build: buildPublicCounterfeitMerlinRead,
    decode: decodeCanonicalPublicCounterfeitMerlinRead,
    hostJoin: validateAdmittedPublicCounterfeitMerlinReadHostJoin,
  })

  const morganaObjective = roleProjection({
    token: MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    degradationCode: MORGANA_COUNTERFEIT_DEGRADATION,
    dependencies: [MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT],
    requiredHostInputs: [
      PRIVATE_BELIEF_INPUT,
    ],
    applies: appliesFrom(MORGANA_CLAIM),
    join(context) {
      return {
        req: context.request,
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
        publicRead: context.dependencies.require(
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        ),
        candidates: legalCandidates(context.request, context.view),
      }
    },
    build: buildAdmittedMorganaCounterfeitObjective,
    decode: decodeCanonicalPrivateMorganaCounterfeitObjective,
    hostJoin: validateAdmittedPrivateMorganaCounterfeitHostJoin,
    detachedExact: (payload) => beliefIsExact(payload.source.beliefQuality),
    hostExact: (_payload, input) => beliefIsExact(input.belief.quality),
  })

  const morganaUtility = (
    token: ComponentToken<PrivateMorganaRoleUtilityProjection>,
    selectionMode: MorganaRoleSelectionMode,
  ): DecisionComponentDefinition<PrivateMorganaRoleUtilityProjection> =>
    roleProjection({
      token,
      degradationCode: MORGANA_ROLE_UTILITY_DEGRADATION,
      dependencies: [
        EVIL_ROLE_UTILITY_COMPONENT,
        MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
      ],
      requiredHostInputs: [
        PRIVATE_FORCED_POLICY_INPUT,
        PRIVATE_DETERMINISTIC_SEED_INPUT,
      ],
      ...(selectionMode === 'seeded-near-equal-vote-within-d2-band'
        ? { deterministicSeedDomain: MORGANA_ROLE_UTILITY_PROJECTION_VERSION }
        : {}),
      applies: appliesFrom(MORGANA_CLAIM),
      join(context) {
        return {
          req: context.request,
          view: context.view,
          candidates: legalCandidates(context.request, context.view),
          forced: context.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT),
          counterfeitObjective: context.dependencies.require(
            MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
          ),
          evilRoleUtility: context.dependencies.require(
            EVIL_ROLE_UTILITY_COMPONENT,
          ),
          selectionMode,
          deterministicSeed: context.hostInputs.require(
            PRIVATE_DETERMINISTIC_SEED_INPUT,
          ),
        }
      },
      build: buildAdmittedMorganaRoleUtilityProjection,
      decode: decodeCanonicalPrivateMorganaRoleUtilityProjection,
      hostJoin: validateAdmittedPrivateMorganaRoleUtilityHostJoin,
      detachedExact: (payload) =>
        beliefIsExact(payload.counterfeitObjective.source.beliefQuality),
      hostExact: (_payload, input) =>
        beliefIsExact(input.counterfeitObjective.source.beliefQuality),
    })

  return Object.freeze([
    goodObjective,
    goodUtility,
    evilObjective,
    evilUtility,
    servantObjective,
    servantUtility,
    morganaPublicRead,
    morganaObjective,
    morganaUtility(
      MORGANA_ROLE_UTILITY_COMPONENT,
      'top-counterfeit-within-d2-band',
    ),
    morganaUtility(
      MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      'seeded-near-equal-vote-within-d2-band',
    ),
  ])
}

function root<Value>(
  token: ComponentHostInputToken<Value>,
  validate: (value: unknown) => value is Value,
  maxPayloadBytes = MAX_ROOT_JSON_BYTES,
): ComponentHostInputDefinition<Value> {
  return {
    token,
    maxPayloadBytes,
    validate(value) {
      return validate(value)
        ? { valid: true, value }
        : { valid: false, degradationCode: 'role-adapter-root-invalid' }
    },
  }
}

export const SCORE_COMPONENT_HOST_INPUTS = Object.freeze([
  root(PRIVATE_IDENTITY_INPUT, validatePrivateIdentitySnapshot),
  root(
    PRIVATE_PUBLIC_OBSERVER_INPUT,
    validatePublicObserverSnapshot,
    MAX_ROOT_JSON_BYTES,
  ),
  root(
    PRIVATE_BELIEF_INPUT,
    (value): value is BeliefSnapshot => {
      try {
        projectJointIdentity(value as BeliefSnapshot, {
          roleQueries: [],
          hiddenTeam: true,
        })
        return true
      } catch {
        return false
      }
    },
    MAX_BELIEF_ROOT_JSON_BYTES,
  ),
  root(
    PRIVATE_SITUATION_INPUT,
    (value): value is SituationAnalysis => {
      const analysis = value as SituationAnalysis | undefined
      return !!analysis
        && typeof analysis === 'object'
        && analysis.modelVersion === SITUATION_ANALYSIS_VERSION
        && (analysis.failsRequired === 1 || analysis.failsRequired === 2)
        && typeof analysis.matchPoint?.good === 'boolean'
        && typeof analysis.matchPoint?.evil === 'boolean'
    },
  ),
  root(
    PRIVATE_FORCED_POLICY_INPUT,
    (value): value is ForcedPolicyResult => {
      const forced = value as ForcedPolicyResult | undefined
      return !!forced
        && typeof forced === 'object'
        && forced.version === FORCED_POLICY_VERSION
        && typeof forced.applied === 'boolean'
        && Array.isArray(forced.reasonCodes)
        && Array.isArray(forced.allowedCandidateIds)
        && forced.reasonCodes.every((code) => typeof code === 'string')
        && forced.allowedCandidateIds.every(
          (candidate) => typeof candidate === 'string',
        )
        && (
          forced.selectedCandidateId === undefined
          || typeof forced.selectedCandidateId === 'string'
        )
    },
  ),
  root(
    PRIVATE_DETERMINISTIC_SEED_INPUT,
    (value): value is string =>
      typeof value === 'string'
      && value.trim().length > 0
      && Buffer.byteLength(value, 'utf8') <= 4_096,
    4_096,
  ),
])

export function createNativeScoreComponentRegistry(
  configuration: NativeScoreComponentConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    nativeScoreComponentDefinitions(configuration),
    { hostInputs: SCORE_COMPONENT_HOST_INPUTS },
  )
}
