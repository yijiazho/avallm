// The historical safety reader, kept whole on purpose.
//
// This module holds exactly one function, and that function is long. It is not
// carved into helpers because every clause in it reads locals derived at the
// top from the same artifact and the same declared component set: what the host
// declared, what the artifact's manifests list, and what each admitted trace
// says. Splitting the clauses would mean threading a large context object
// through a dozen predicates, and the coherence law the function states, that a
// declaration, a manifest, and a trace must agree or the decision is an
// attribution violation, would stop being readable top to bottom. The length is
// intrinsic to the law, not accumulated mess.
//
// What the module boundary buys instead is quarantine. Everything here is the
// compatibility path for schema-1 and absent manifests, and it can never mint
// promotion evidence. Its neighbor safety-current.ts is the path that can.
// Nothing new should be added here: a new component belongs in the current
// descriptor, and this reader only needs to keep telling the truth about
// artifacts that were already written.

import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from '../core/artifact.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
  isComposedTrace,
  type DecisionTrace,
} from '../../agents/trace.ts'
import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
} from '../../agents/belief/language-factor.ts'
import {
  validatePublicObserverSnapshot,
} from '../../agents/analysis/observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../../agents/analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentityHostJoin,
} from '../../agents/belief/identity.ts'
import { PLAN_MEMORY_VERSION } from '../../agents/cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  isCoherenceIntent,
} from '../../agents/cognition/coherence.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../../agents/analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
} from '../../agents/analysis/role-objectives.ts'
import {
  buildEvilRoleObjectiveSnapshot,
} from '../../agents/analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../../agents/analysis/evil-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from '../../agents/analysis/role-objective-router.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../../agents/analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../agents/analysis/evil-role-utility.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../../agents/policy/score.ts'
import {
  legalCandidates,
} from '../../agents/candidate/candidates.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../../agents/policy/evil-quest-card.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
} from '../../agents/analysis/morgana-counterfeit-types.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../../agents/belief/types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../agents/analysis/morgana-role-utility.ts'
import {
  admitCanonicalDecisionTrace,
  type DecisionTraceSnapshotResult,
} from '../../agents/admission/composed-trace.ts'
import type {
  DecisionComponentPlan,
} from '../../agents/components/kernel.ts'
import type {
  DecisionSnapshot,
} from '../replay/replay.ts'
import {
  authoritativeDecisionReplay,
  decisionTraceReplayJoin,
  exactTargetTraceCoverage,
  type AuthoritativeDecisionReplay,
} from '../replay/trace-replay.ts'
import type {
  ArchitectureSafetyAdmission,
  ArtifactArchitectureAdmission,
} from './types.ts'
import {
  canonicalTracePrivacyScan,
  containsPrivateArchitectureTelemetry,
} from './privacy-scan.ts'
import {
  artifactWithCanonicalDecisionTraces,
  hasComponentManifestClaim,
} from './artifact-admission.ts'
import {
  isComposedComponents,
  planOutcomeHostJoin,
} from './host-join.ts'

/**
 * Historical compatibility reader for schema-1 manifests and absent
 * manifests. Current descriptor evidence never enters this role-aware path.
 */
export function legacyArchitectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  architectureAdmission: ArtifactArchitectureAdmission,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const publicLog = JSON.stringify(
    artifact.log.filter((event) => event.visibility === 'public'),
  )
  if (containsPrivateArchitectureTelemetry(publicLog)) {
    hiddenInformationViolations++
  }
  const rejectedSnapshots = traceCandidates.filter(
    (candidate) => candidate.kind === 'rejected',
  )
  const canonicalCandidates = traceCandidates.filter(
    (candidate) =>
      candidate.kind === 'canonical-decision-trace-candidate',
  )
  const traces = canonicalCandidates.map((candidate) => candidate.trace)
  const tracePrivacy = canonicalTracePrivacyScan(traces)
  hiddenInformationChecks += tracePrivacy.checks
  hiddenInformationViolations += tracePrivacy.violations
  traceAttributionChecks += rejectedSnapshots.length
  traceAttributionViolations += rejectedSnapshots.length
  const admittedTraces: Readonly<DecisionTrace>[] = []
  const componentManifestClaim = hasComponentManifestClaim(
    architectureAdmission,
  )
  const hostRequiresComponentEvidence = isComposedComponents(
    meta.components,
  )
  const validComponentManifest =
    architectureAdmission.provenance
      === 'descriptor-host-manifest-admitted'
    || architectureAdmission.provenance
      === 'legacy-host-manifest-admitted'
  const expectedComponentPlan: DecisionComponentPlan | undefined =
    validComponentManifest ? architectureAdmission.plan : undefined
  const genericComponentClaim = traces.some((trace) =>
    trace.version === COMPONENT_DECISION_TRACE_VERSION
    || trace.componentPlan !== undefined
    || trace.components !== undefined
    || trace.componentVersions?.decisionComponents !== undefined)
  if (componentManifestClaim && genericComponentClaim) {
    traceAttributionChecks++
    if (
      !validComponentManifest
      || !expectedComponentPlan
    ) {
      traceAttributionViolations++
    }
  }
  const declaresBoundedLanguage =
    meta.components.languageEvidence === LANGUAGE_FACTOR_BUNDLE_VERSION
  const declaresPublicObserver =
    meta.components.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
  const declaresJointIdentity =
    meta.components.identityModel === JOINT_IDENTITY_MODEL_VERSION
  const declaresRoleObjectiveRouter =
    meta.components.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
  const routedObjective = declaresRoleObjectiveRouter
    ? routedRoleObjectiveModel(meta.targetRole)
    : 'off'
  const declaresRoleObjective =
    meta.components.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
  const roleObjectiveApplicable =
    routedObjective === ROLE_OBJECTIVE_MODEL_VERSION
    || (
      declaresRoleObjective
      && (meta.targetRole === 'merlin' || meta.targetRole === 'percival')
    )
  const evilRoleObjectiveApplicable =
    routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const declaresRoleUtility =
    meta.components.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
  const roleUtilityApplicable = declaresRoleUtility && roleObjectiveApplicable
  const declaresEvilRoleUtility =
    meta.components.evilRoleUtility
      === EVIL_ROLE_UTILITY_PROJECTION_VERSION
  const evilRoleUtilityApplicable =
    declaresEvilRoleUtility && evilRoleObjectiveApplicable
  const declaredEvilQuestCardPolicy =
    meta.components.evilQuestCardPolicy
  const declaresEvilQuestCardPolicy =
    declaredEvilQuestCardPolicy === EVIL_QUEST_ROBUST_POLICY_VERSION
  const invalidEvilQuestCardPolicyDeclaration =
    declaredEvilQuestCardPolicy === undefined
      ? meta.components.populationAssumption !== undefined
      : (
          !declaresEvilQuestCardPolicy
          || meta.components.populationAssumption
            !== 'heterogeneous-independent'
        )
  const declaresMorganaCounterfeit =
    meta.components.morganaCounterfeitObjective
      === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
  const invalidMorganaCounterfeitDeclaration =
    meta.components.morganaCounterfeitObjective !== undefined
    && (
      !declaresMorganaCounterfeit
      || !declaresPublicObserver
      || meta.components.belief !== EXACT_BELIEF_MODEL_VERSION
      || meta.components.factors !== 'off'
      || meta.components.languageEvidence !== 'off'
      || !isComposedComponents(meta.components)
    )
  const declaresMorganaRoleUtility =
    meta.components.morganaRoleUtility
      === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  const invalidMorganaRoleUtilityDeclaration =
    meta.components.morganaRoleUtility !== undefined
    && (
      !declaresMorganaRoleUtility
      || !declaresMorganaCounterfeit
      || !declaresEvilRoleUtility
      || !declaresRoleObjectiveRouter
      || ![
        MORGANA_ROLE_SCORER_VERSION,
        MORGANA_ROLE_SEEDED_SCORER_VERSION,
      ].includes(
        meta.components.scorer as typeof MORGANA_ROLE_SCORER_VERSION,
      )
    )
  const declaredCoherenceIntent = meta.components.coherenceIntent
  const declaresPlanMemory =
    meta.components.planMemory === PLAN_MEMORY_VERSION
    && meta.components.coherence === COHERENCE_MODEL_VERSION
    && isCoherenceIntent(declaredCoherenceIntent)
  const invalidPlanDeclaration =
    (
      meta.components.planMemory !== undefined
      || meta.components.coherence !== undefined
      || meta.components.coherenceIntent !== undefined
    )
    && !declaresPlanMemory
  const invalidIdentityDeclaration =
    meta.components.identityModel !== undefined
    && !declaresJointIdentity
  const invalidRoleObjectiveDeclaration =
    (
      meta.components.roleObjective !== undefined
      && !declaresRoleObjective
    )
    || (
      meta.components.roleObjectiveRouter !== undefined
      && !declaresRoleObjectiveRouter
    )
    || (
      declaresRoleObjectiveRouter
      && (
        meta.components.roleObjective !== undefined
        || !declaresPublicObserver
        || !declaresJointIdentity
      )
    )
  const invalidRoleUtilityDeclaration =
    (
      meta.components.roleUtility !== undefined
      && !declaresRoleUtility
    )
    || (
      declaresRoleUtility
      && (
        (!declaresRoleObjective && !declaresRoleObjectiveRouter)
        || ![
          ROLE_OBJECTIVE_SCORER_VERSION,
          ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          meta.components.scorer as typeof ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    )
    || (
      declaresRoleObjective
      && (
        !declaresJointIdentity
        || !declaresPublicObserver
      )
    )
  const invalidEvilRoleUtilityDeclaration =
    (
      meta.components.evilRoleUtility !== undefined
      && !declaresEvilRoleUtility
    )
    || (
      declaresEvilRoleUtility
      && (
        !declaresRoleObjectiveRouter
        || ![
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          meta.components.scorer as typeof EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    )
  const coverageRequired =
    traces.length > 0
    || hostRequiresComponentEvidence
    || componentManifestClaim
    || declaresBoundedLanguage
    || declaresPublicObserver
    || declaresJointIdentity
    || declaresPlanMemory
    || declaresRoleObjective
    || declaresRoleObjectiveRouter
    || declaresRoleUtility
    || declaresEvilRoleUtility
    || declaresEvilQuestCardPolicy
    || declaresMorganaCounterfeit
    || declaresMorganaRoleUtility
    || invalidIdentityDeclaration
    || invalidPlanDeclaration
    || invalidRoleObjectiveDeclaration
    || invalidRoleUtilityDeclaration
    || invalidEvilRoleUtilityDeclaration
    || invalidEvilQuestCardPolicyDeclaration
    || invalidMorganaCounterfeitDeclaration
    || invalidMorganaRoleUtilityDeclaration
  const componentEvidenceApplicable = (
    hostRequiresComponentEvidence
    || componentManifestClaim
    || genericComponentClaim
    || traces.some((trace) =>
      isComposedTrace(trace))
  )
  const canonicalArtifact = artifactWithCanonicalDecisionTraces(
    artifact,
    traces,
  )
  let targetReplay: AuthoritativeDecisionReplay | undefined
  let targetSnapshots: ReadonlyMap<string, DecisionSnapshot> = new Map()
  let invalidTraceCoverage = false
  if (coverageRequired) {
    try {
      targetReplay = authoritativeDecisionReplay(
        canonicalArtifact,
        meta.targetSeat,
        traces,
      )
      targetSnapshots = targetReplay.snapshots
      invalidTraceCoverage = !exactTargetTraceCoverage(
        targetSnapshots,
        traces,
        meta.targetSeat,
      )
    } catch {
      invalidTraceCoverage = true
    }
  }
  const planSnapshots = declaresPlanMemory
    ? targetSnapshots
    : new Map<string, DecisionSnapshot>()
  const artifactIdentities = artifact.strategyVersions?.identities
  const invalidIdentityManifest = declaresJointIdentity
    ? (
        !artifactIdentities
        || artifactIdentities.length !== 1
        || artifactIdentities[0] !== JOINT_IDENTITY_MODEL_VERSION
      )
    : artifactIdentities !== undefined && artifactIdentities.length > 0
  const artifactPlanMemories = artifact.strategyVersions?.planMemories
  const artifactCoherences = artifact.strategyVersions?.coherences
  const invalidPlanManifest = declaresPlanMemory
    ? (
        artifactPlanMemories?.length !== 1
        || artifactPlanMemories[0] !== PLAN_MEMORY_VERSION
        || artifactCoherences?.length !== 1
        || artifactCoherences[0] !== COHERENCE_MODEL_VERSION
      )
    : (
        (artifactPlanMemories?.length ?? 0) > 0
        || (artifactCoherences?.length ?? 0) > 0
      )
  const artifactRoleObjectives = artifact.strategyVersions?.roleObjectives
  const expectedObjectiveManifest = routedObjective === 'off'
    ? declaresRoleObjective ? [ROLE_OBJECTIVE_MODEL_VERSION] : []
    : [routedObjective]
  const invalidRoleObjectiveManifest = expectedObjectiveManifest.length
    ? (
      artifactRoleObjectives?.length !== 1
        || artifactRoleObjectives[0] !== expectedObjectiveManifest[0]
      )
    : (artifactRoleObjectives?.length ?? 0) > 0
  const artifactRoleObjectiveRouters =
    artifact.strategyVersions?.roleObjectiveRouters
  const invalidRoleObjectiveRouterManifest = declaresRoleObjectiveRouter
    ? (
        artifactRoleObjectiveRouters?.length !== 1
        || artifactRoleObjectiveRouters[0] !== ROLE_OBJECTIVE_ROUTER_VERSION
      )
    : (artifactRoleObjectiveRouters?.length ?? 0) > 0
  const artifactRoleUtilities = artifact.strategyVersions?.roleUtilities
  const invalidRoleUtilityManifest = declaresRoleUtility
    ? (
        artifactRoleUtilities?.length !== 1
        || artifactRoleUtilities[0] !== ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactRoleUtilities?.length ?? 0) > 0
  const artifactEvilRoleUtilities =
    artifact.strategyVersions?.evilRoleUtilities
  const invalidEvilRoleUtilityManifest = declaresEvilRoleUtility
    ? (
        artifactEvilRoleUtilities?.length !== 1
        || artifactEvilRoleUtilities[0]
          !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactEvilRoleUtilities?.length ?? 0) > 0
  const artifactEvilQuestCardPolicies =
    artifact.strategyVersions?.evilQuestCardPolicies
  const invalidEvilQuestCardPolicyManifest = declaresEvilQuestCardPolicy
    ? (
        artifactEvilQuestCardPolicies?.length !== 1
        || artifactEvilQuestCardPolicies[0]
          !== declaredEvilQuestCardPolicy
      )
    : (artifactEvilQuestCardPolicies?.length ?? 0) > 0
  const artifactMorganaCounterfeitObjectives =
    artifact.strategyVersions?.morganaCounterfeitObjectives
  const invalidMorganaCounterfeitManifest = declaresMorganaCounterfeit
    ? (
        artifactMorganaCounterfeitObjectives?.length !== 1
        || artifactMorganaCounterfeitObjectives[0]
          !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      )
    : (artifactMorganaCounterfeitObjectives?.length ?? 0) > 0
  const artifactMorganaRoleUtilities =
    artifact.strategyVersions?.morganaRoleUtilities
  const invalidMorganaRoleUtilityManifest = declaresMorganaRoleUtility
    ? (
        artifactMorganaRoleUtilities?.length !== 1
        || artifactMorganaRoleUtilities[0]
          !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactMorganaRoleUtilities?.length ?? 0) > 0
  if (invalidIdentityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidPlanManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleObjectiveManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleObjectiveRouterManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidEvilRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidEvilQuestCardPolicyManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidMorganaCounterfeitManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidMorganaRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidTraceCoverage) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  for (const candidate of canonicalCandidates) {
    traceAttributionChecks++
    const pendingTrace = candidate.trace
    const hostSnapshot = targetSnapshots.get(pendingTrace.decisionId)
    if (!hostSnapshot) {
      traceAttributionViolations++
      continue
    }
    const pendingStrictComposedTrace = isComposedTrace(pendingTrace)
    const traceAdmission = admitCanonicalDecisionTrace({
      kind: 'finalized-artifact',
      trace: candidate,
      req: hostSnapshot.req,
      view: hostSnapshot.view,
      authoritativeAction: hostSnapshot.original,
      deterministicSeed: artifact.seed,
      ...(expectedComponentPlan
        ? {
            expectComponentTrace: true,
            expectedComponentPlan,
          }
        : {}),
      ...(
        pendingTrace.version !== COMPONENT_DECISION_TRACE_VERSION
        && pendingStrictComposedTrace
          ? { diagnosticVerification: 'exact' as const }
          : {}
      ),
    })
    if (traceAdmission.kind === 'rejected') {
      traceAttributionViolations++
      continue
    }
    const trace = traceAdmission.trace
    admittedTraces.push(trace)
    const strictComposedTrace = isComposedTrace(trace)
    const versions = trace.componentVersions
    const languageEnabled = declaresBoundedLanguage
    const stableKeys = [
      'brain',
      'factors',
      'languageEvidence',
      ...(meta.components.observerModel === undefined
        ? []
        : ['observerModel']),
      ...(declaresJointIdentity ? ['identityModel'] : []),
      ...(declaresPlanMemory ? ['planMemory', 'coherence'] : []),
      ...(
        roleObjectiveApplicable && !declaresRoleObjectiveRouter
          ? ['roleObjective']
          : []
      ),
      ...(declaresRoleObjectiveRouter ? ['roleObjectiveRouter'] : []),
      'policy',
      'planner',
      'voice',
      ...(languageEnabled
        ? ['mechanicalBelief', 'beliefPipeline']
        : ['belief']),
    ]
    const invalidDeclaration = languageEnabled
      ? (
          meta.components.belief !== undefined
          || !meta.components.mechanicalBelief
          || !meta.components.beliefPipeline
        )
      : (
          meta.components.mechanicalBelief !== undefined
          || meta.components.beliefPipeline !== undefined
        )
    const invalidTraceShape = languageEnabled
      ? (
          !versions?.mechanicalBelief
          || !versions.beliefPipeline
        )
      : (
          versions?.mechanicalBelief !== undefined
          || versions?.beliefPipeline !== undefined
        )
    if (
      trace.viewerSeat !== meta.targetSeat
      || !versions
      || (
        expectedComponentPlan !== undefined
        && trace.version !== COMPONENT_DECISION_TRACE_VERSION
      )
      || versions.belief !== trace.beliefModelVersion
      || versions.roleObjective !== (
        roleObjectiveApplicable
          ? ROLE_OBJECTIVE_MODEL_VERSION
          : evilRoleObjectiveApplicable
            ? EVIL_ROLE_OBJECTIVE_MODEL_VERSION
            : undefined
      )
      || invalidDeclaration
      || invalidIdentityDeclaration
      || invalidPlanDeclaration
      || invalidRoleObjectiveDeclaration
      || invalidRoleUtilityDeclaration
      || invalidEvilRoleUtilityDeclaration
      || invalidEvilQuestCardPolicyDeclaration
      || invalidMorganaCounterfeitDeclaration
      || invalidMorganaRoleUtilityDeclaration
      || invalidTraceShape
      || (
        declaresEvilQuestCardPolicy
          ? traceAdmission.facts.evilQuestCardPolicy.state
            === 'not-configured'
          : traceAdmission.facts.evilQuestCardPolicy.state
            !== 'not-configured'
      )
      || versions.configuredMorganaCounterfeitObjective
        !== (
          declaresMorganaCounterfeit
            ? MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
            : undefined
        )
      || versions.configuredMorganaRoleUtility
        !== (
          declaresMorganaRoleUtility
            ? MORGANA_ROLE_UTILITY_PROJECTION_VERSION
            : undefined
        )
      || (
        declaresMorganaRoleUtility
        && meta.targetRole === 'morgana'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // The retired flat E1B payload can no longer be present, so an
          // applicable Morgana decision can only ever declare the degradation.
          ? true
          : (
              versions.morganaRoleUtility !== undefined
              || trace.degradation.includes(
                MORGANA_ROLE_UTILITY_DEGRADATION,
              )
            )
      )
      || (
        declaresPublicObserver
          ? (
              trace.publicObserver === undefined
                ? !strictComposedTrace
                : !validatePublicObserverSnapshot(trace.publicObserver)
            )
          : trace.publicObserver !== undefined
      )
      || (() => {
        // A retired flat utility payload can never be present, so no historical
        // decision reports an applied flat role, evil, or Morgana utility. The
        // expected scorer is therefore always the base scorer its declared role
        // family falls back to.
        const seeded =
          meta.components.scorer
            === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === MORGANA_ROLE_SEEDED_SCORER_VERSION
        const expectedScorer = seeded
          ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
          : (
              meta.components.scorer === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
              || meta.components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
              || meta.components.scorer === MORGANA_ROLE_SCORER_VERSION
            )
            ? GOOD_PROPOSAL_VOTE_SCORER_VERSION
            : meta.components.scorer
        return versions.scorer !== expectedScorer
          || versions.configuredScorer !== (
            expectedScorer === meta.components.scorer
              ? undefined
              : meta.components.scorer
          )
      })()
      || (
        declaresPlanMemory
          ? (
              !isCoherenceIntent(trace.coherenceIntent)
          || trace.coherenceIntent !== declaredCoherenceIntent
          || !decisionTraceReplayJoin(
                planSnapshots.get(trace.decisionId),
                trace,
              )
              || (
                trace.privatePlanOutcome === undefined
                  ? !trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
                  : (
                      !targetReplay
                      || !planOutcomeHostJoin(
                        artifact,
                        targetReplay,
                        trace,
                      )
                    )
              )
              || JSON.stringify(trace.privatePlanOutcome?.request)
                !== (
                  trace.privatePlanOutcome === undefined
                    ? undefined
                    : JSON.stringify(trace.request)
                )
              || JSON.stringify(trace.privatePlanOutcome?.appliedDecision)
                !== (
                  trace.privatePlanOutcome === undefined
                    ? undefined
                    : JSON.stringify(trace.action)
                )
            )
          : (
              trace.privatePlanOutcome !== undefined
              || versions.planMemory !== undefined
              || versions.coherence !== undefined
              || trace.coherenceIntent !== undefined
              || trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
            )
      )
      || (
        roleUtilityApplicable
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // The retired flat C2 payload can no longer be present, so an
          // applicable decision must declare the degradation and nothing else.
          ? (
              versions.roleUtility !== undefined
              || !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
            )
          : (
              versions.roleUtility !== undefined
              || trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
            )
      )
      || (
        evilRoleUtilityApplicable
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // With the retired flat D2 payload gone, the only remaining check is
          // that an atomic weighted dependency failure is declared coherently.
          ? (() => {
              const dependencyDegradation = [
                'identity-projection-failed',
                EVIL_ROLE_OBJECTIVE_DEGRADATION,
                EVIL_ROLE_UTILITY_DEGRADATION,
              ]
              const expectedBaseScorer =
                meta.components.scorer
                  === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                  ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
                  : GOOD_PROPOSAL_VOTE_SCORER_VERSION
              return !(
                trace.quality === 'weighted'
                && trace.privateIdentity === undefined
                && versions.evilRoleUtility === undefined
                && versions.scorer === expectedBaseScorer
                && versions.configuredScorer === meta.components.scorer
                && trace.degradation.length
                  === dependencyDegradation.length
                && dependencyDegradation.every((code) =>
                  trace.degradation.includes(code))
              )
            })()
          : (
              versions.evilRoleUtility !== undefined
              || trace.degradation.includes(
                EVIL_ROLE_UTILITY_DEGRADATION,
              )
            )
      )
      || (
        declaresJointIdentity
          ? (
              trace.privateIdentity === undefined
                ? !trace.degradation.includes('identity-projection-failed')
                : (
                    trace.degradation.includes(
                      'identity-projection-failed',
                    )
                    || !validatePrivateIdentityHostJoin(
                      trace.privateIdentity,
                      artifact.roles,
                      trace.beliefPlayerMarginals,
                    )
                    || trace.privateIdentity.sourceBelief.modelVersion
                      !== trace.beliefModelVersion
                    || trace.privateIdentity.sourceBelief.throughSeq
                      !== trace.beliefThroughSeq
                    || trace.privateIdentity.sourceBelief.quality !== trace.quality
                    || (
                      evilRoleObjectiveApplicable
                      && (
                        !trace.privateIdentity.scope.hiddenTeam
                        || trace.privateIdentity.hiddenTeamPosterior
                          === undefined
                      )
                    )
                  )
            )
          : (
              trace.privateIdentity !== undefined
              || versions.identityModel !== undefined
            )
      )
      || (
        roleObjectiveApplicable
          // The retired flat C1 payload can no longer be present, so only the
          // absent-objective path survives.
          ? (
              !trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
              || (
                trace.privateIdentity === undefined
                  ? !trace.degradation.includes(
                      'identity-projection-failed',
                    )
                  : (() => {
                      const snapshot = targetSnapshots.get(
                        trace.decisionId,
                      )
                      if (!snapshot || !trace.publicObserver) return true
                      try {
                        buildRoleObjectiveSnapshot({
                          req: snapshot.req,
                          view: snapshot.view,
                          identity: trace.privateIdentity,
                          observer: trace.publicObserver,
                          candidates: legalCandidates(
                            snapshot.req,
                            snapshot.view,
                          ),
                        })
                        return true
                      } catch {
                        return false
                      }
                    })()
              )
            )
          : trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      )
      || (
        evilRoleObjectiveApplicable
          // The retired flat D1 payload can no longer be present, so only the
          // absent-objective path survives.
          ? (() => {
              const snapshot = targetSnapshots.get(trace.decisionId)
              if (
                !trace.degradation.includes(
                  EVIL_ROLE_OBJECTIVE_DEGRADATION,
                )
                || !snapshot
                || !trace.publicObserver
              ) return true
              if (!trace.privateIdentity) {
                return !trace.degradation.includes(
                  'identity-projection-failed',
                )
              }
              try {
                buildEvilRoleObjectiveSnapshot({
                  req: snapshot.req,
                  view: snapshot.view,
                  identity: trace.privateIdentity,
                  observer: trace.publicObserver,
                  candidates: legalCandidates(snapshot.req, snapshot.view),
                })
                return true
              } catch {
                return false
              }
            })()
          : trace.degradation.includes(
              EVIL_ROLE_OBJECTIVE_DEGRADATION,
            )
      )
      || stableKeys.some(
        (key) =>
          versions[key as keyof typeof versions]
          !== meta.components[key],
      )
    ) {
      traceAttributionViolations++
    }
  }
  return {
    traces: Object.freeze(admittedTraces),
    safety: {
      hiddenInformationChecks,
      hiddenInformationViolations,
      traceAttributionChecks,
      traceAttributionViolations,
      ...(componentEvidenceApplicable
        ? {
            // This path has no current out-of-band architecture identity.
            // Canonical diagnostic fields cannot mint promotion evidence.
            promotionEvidenceEligible: false,
          }
        : {}),
    },
  }
}
