// Reconstruction of the exact policy host surface, and the decision-layer host
// join replayed against it. This is the module that re-runs the policy from the
// host's own inputs and refuses a trace that fails to match it, which is why it
// is the one file in admission licensed to build a scorer situation surface
// directly. Keeping that license attached to a single small module is what keeps
// the license meaningful.

import type {
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import {
  buildScorerSituationSurface,
} from '../../analysis/scorer-situation-surface.ts'
import {
  combineSituationAnalysisRequirements,
} from '../../analysis/situation-plan.ts'
import type {
  SituationAnalysis,
} from '../../analysis/situation-types.ts'
import {
  exactBelief,
} from '../../belief/exact.ts'
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../../candidate/candidates.ts'
import type {
  ForcedPolicyResult,
} from '../../candidate/types.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../components/resolved-brain.ts'
import type {
  AdmittedDecisionLayerTrace,
} from './production-registries.ts'
import type {
  DecisionCandidateBoundary,
  DecisionLayerRun,
} from '../../policy/decision-layer/types.ts'
import {
  applyForcedPolicy,
} from '../../policy/forced.ts'
import {
  prepareScoreLayerRequirements,
} from '../../policy/score-layer/preparation.ts'
import {
  CANDIDATE_SCORER_VERSION,
} from '../../policy/score.ts'
import {
  configuredScoreLayerChainForVersion,
} from '../../role-score-layers/configured.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
} from '../../trace.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import {
  DECISION_LAYER_ADMISSION,
  PRODUCTION_COMPONENT_REGISTRY,
  PRODUCTION_DECISION_LAYER_REGISTRY,
  trustedNativeScoreChain,
} from './production-registries.ts'

export interface ExactPolicyHostSurface {
  readonly candidates: ReturnType<typeof legalCandidates>
  readonly analysis: SituationAnalysis
  readonly hypotheticalTeamCandidates?:
    ReturnType<typeof hypotheticalProposalCandidates>
  readonly universalForced: ForcedPolicyResult
  readonly effectiveForced: ForcedPolicyResult
  readonly candidateBoundary: DecisionCandidateBoundary
}

/**
 * Construct the one exact host-owned policy/scoring input surface. The
 * configured score chain comes only from an out-of-band resolved identity;
 * witnessless protocol traces receive the compatibility analysis shape and
 * remain diagnostic.
 */
export function exactPolicyHostSurface(
  req: DecisionRequest,
  view: PlayerView,
  expectedArchitectureIdentity?: ResolvedArchitectureIdentity,
): ExactPolicyHostSurface | undefined {
  try {
    const candidates = legalCandidates(req, view)
    const chain = expectedArchitectureIdentity
      ? trustedNativeScoreChain(expectedArchitectureIdentity)
      : configuredScoreLayerChainForVersion(CANDIDATE_SCORER_VERSION)
    if (!chain) return undefined
    const analysisPlan = combineSituationAnalysisRequirements(
      prepareScoreLayerRequirements(chain, {
        request: Object.freeze(structuredClone(req)),
        view: Object.freeze(structuredClone(view)),
      }).requirements,
    )
    const {
      analysis,
      hypotheticalTeamCandidates,
    } = buildScorerSituationSurface({
      view,
      belief: exactBelief(view),
      legalCandidates: candidates,
      plan: analysisPlan,
    })
    const universalForced = applyForcedPolicy(
      req,
      view,
      analysis,
      candidates,
    )
    return {
      candidates,
      analysis,
      ...(hypotheticalTeamCandidates !== null
        ? { hypotheticalTeamCandidates }
        : {}),
      universalForced,
      effectiveForced: universalForced,
      candidateBoundary: {
        survivorCandidateIds: universalForced.allowedCandidateIds,
        ...(universalForced.selectedCandidateId === undefined
          ? {}
          : {
              selectedCandidateId:
                universalForced.selectedCandidateId,
            }),
        reasonCodes: universalForced.reasonCodes,
      },
    }
  } catch {
    return undefined
  }
}

/**
 * Replay the configured strategic seam from out-of-band architecture
 * identity. Detached traces can remain diagnostic, but cannot invent exact
 * order, journal, operation accounting, or causal component use.
 */
export function replayExactDecisionLayerHostJoin(
  trace: DecisionTrace,
  admission: AdmittedDecisionLayerTrace | undefined,
  req: DecisionRequest,
  view: PlayerView,
  surface: ExactPolicyHostSurface,
  identity: ResolvedArchitectureIdentity,
): DecisionLayerRun | undefined {
  try {
    if (
      trace.version !== COMPONENT_DECISION_TRACE_VERSION
      || !trace.components
      || !trace.decisionLayerRun
      || !admission
    ) return undefined
    const componentDefinitions = identity.components.eligible.map(
      (ref) => PRODUCTION_COMPONENT_REGISTRY.definition(ref),
    )
    if (componentDefinitions.some(
      (definition) => definition === undefined,
    )) return undefined
    return DECISION_LAYER_ADMISSION.replay({
      registry: PRODUCTION_DECISION_LAYER_REGISTRY,
      configured: identity.decisionLayerOrder,
      request: req,
      view,
      analysis: surface.analysis,
      candidates: surface.candidates,
      universalForced: surface.universalForced,
      componentDefinitions: componentDefinitions.filter(
        (definition) => definition !== undefined,
      ),
      componentRun: trace.components,
      claimed: admission,
    })
  } catch {
    return undefined
  }
}
