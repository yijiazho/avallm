// The safety reader for artifacts that carry a current resolved-architecture
// descriptor: the only path that can mint promotion evidence.
//
// This reader is short because it is allowed to be strict. A current descriptor
// names an exact architecture identity, so every trace can be held to the one
// component plan that identity resolves to, and anything less than
// trusted-exact admission counts as an attribution violation rather than
// something to be interpreted. Its counterpart in safety-legacy.ts has to infer
// the same facts from declarations, which is why that file is an order of
// magnitude longer.
//
// Keeping the two readers in separate modules is what keeps the strictness
// asymmetry visible. A clause added here must be justified against an exact
// identity; a clause added there must be justified against a declaration that
// may be absent. Sharing a file made it too easy to move a clause between the
// two without noticing which evidence it was now resting on.

import {
  isDeepStrictEqual,
} from 'node:util'
import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from '../core/artifact.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  type DecisionTrace,
} from '../../agents/trace.ts'
import {
  admitCanonicalDecisionTrace,
  type DecisionTraceAdmissionResult,
  type DecisionTraceSnapshotResult,
} from '../../agents/admission/composed-trace.ts'
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
} from './artifact-admission.ts'
import {
  planOutcomeHostJoin,
} from './host-join.ts'

export function currentArchitectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: Extract<
    ArtifactArchitectureAdmission,
    { provenance: 'descriptor-host-manifest-admitted' }
  >,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = containsPrivateArchitectureTelemetry(
    JSON.stringify(
      artifact.log.filter((event) => event.visibility === 'public'),
    ),
  ) ? 1 : 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
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
  const trustedAdmissions: DecisionTraceAdmissionResult[] = []
  const admittedTraces: Readonly<DecisionTrace>[] = []
  const canonicalArtifact = artifactWithCanonicalDecisionTraces(
    artifact,
    traces,
  )
  let replay: AuthoritativeDecisionReplay | undefined
  try {
    replay = authoritativeDecisionReplay(
      canonicalArtifact,
      meta.targetSeat,
      traces,
    )
    traceAttributionChecks++
    if (!exactTargetTraceCoverage(
      replay.snapshots,
      traces,
      meta.targetSeat,
    )) {
      traceAttributionViolations++
    }
  } catch {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  const planCoherenceEnabled =
    admission.identity.configuredPipeline.planCoherence.memory !== 'off'
    && admission.identity.configuredPipeline.planCoherence.model !== 'off'
  for (const candidate of canonicalCandidates) {
    traceAttributionChecks++
    const pendingTrace = candidate.trace
    const snapshot = replay?.snapshots.get(pendingTrace.decisionId)
    if (!snapshot) {
      traceAttributionViolations++
      continue
    }
    const traceAdmission = admitCanonicalDecisionTrace({
      kind: 'finalized-artifact',
      trace: candidate,
      req: snapshot.req,
      view: snapshot.view,
      authoritativeAction: snapshot.original,
      deterministicSeed: artifact.seed,
      expectComponentTrace: true,
      expectedComponentPlan: admission.plan,
      expectedArchitectureIdentity: admission.identity,
    })
    trustedAdmissions.push(traceAdmission)
    if (traceAdmission.kind !== 'trusted-exact') {
      traceAttributionViolations++
      continue
    }
    const trace = traceAdmission.trace
    admittedTraces.push(trace)
    const planAttributionValid = planCoherenceEnabled
      ? (
          trace.componentVersions?.planMemory
            === admission.identity.configuredPipeline.planCoherence.memory
          && trace.componentVersions?.coherence
            === admission.identity.configuredPipeline.planCoherence.model
          && trace.coherenceIntent
            === admission.identity.configuredPipeline.planCoherence.intent
          && !!snapshot
          && decisionTraceReplayJoin(snapshot, trace)
          && (
            trace.privatePlanOutcome === undefined
              ? trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
              : (
                  !!replay
                  && planOutcomeHostJoin(artifact, replay, trace)
                  && isDeepStrictEqual(
                    trace.privatePlanOutcome.request,
                    trace.request,
                  )
                  && isDeepStrictEqual(
                    trace.privatePlanOutcome.appliedDecision,
                    trace.action,
                  )
                )
          )
        )
      : (
          trace.privatePlanOutcome === undefined
          && trace.componentVersions?.planMemory === undefined
          && trace.componentVersions?.coherence === undefined
          && trace.coherenceIntent === undefined
          && !trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
        )
    if (
      trace.viewerSeat !== meta.targetSeat
      || !planAttributionValid
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
      promotionEvidenceEligible: (
        trustedAdmissions.length === traces.length
        && trustedAdmissions.length > 0
        && trustedAdmissions.every((result) =>
          result.kind === 'trusted-exact'
          && result.promotionEvidenceEligible)
        && hiddenInformationViolations === 0
        && traceAttributionViolations === 0
      ),
    },
  }
}
