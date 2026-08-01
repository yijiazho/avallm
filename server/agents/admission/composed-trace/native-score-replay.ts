// The native-score half of host-join admission: which diagnostics a trace is
// expected to carry, who is permitted to have produced them, and the exact
// surface comparison that refuses anything else. Split from the policy host
// surface because it replays a different authority. It reads that surface as a
// type only, so the dependency between the two runs one way and stays that way.

import type {
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import {
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
} from '../../analysis/morgana-role-utility.ts'
import {
  candidateIdForDecision,
} from '../../candidate/candidates.ts'
import {
  componentPayload,
} from '../../components/kernel.ts'
import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../../components/native-score-components.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../components/resolved-brain.ts'
import type {
  DecisionComponentDefinition,
} from '../../components/types.ts'
import {
  heuristicDecide,
} from '../../policy/heuristic-fallback.ts'
import {
  replayNativeScoresForAdmission,
} from '../../policy/score-layer/admission-replay.ts'
import type {
  ResolvedScoreLayerChain,
  ScoreLayerTrace,
} from '../../policy/score-layer/types.ts'
import {
  selectTopViableScore,
} from '../../policy/score.ts'
import type {
  CandidateScore,
  CandidateScoringContext,
} from '../../policy/score.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../../score-diagnostics/project-score-diagnostics.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import type {
  ExactPolicyHostSurface,
} from './policy-host-surface.ts'
import {
  NATIVE_SCORE_COMPONENT_IDS,
  PRODUCTION_COMPONENT_REGISTRY,
  PRODUCTION_DECISION_LAYER_REGISTRY,
  configuredNativeScorerVersion,
  trustedNativeScoreChain,
} from './production-registries.ts'
import {
  nativeScoreSelectionSurvived,
} from './trace-shape.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

interface ExpectedNativeDiagnostics {
  readonly scores: readonly CandidateScore[]
  readonly componentRun: DecisionComponentRun
  readonly resolvedScorerVersion: string
  readonly scoreLayerRun: ScoreLayerTrace
}

export function validTrustedPassiveComponentAttribution(
  trace: DecisionTrace,
): boolean {
  if (!trace.components) return false
  const strategicIds = new Set(
    PRODUCTION_DECISION_LAYER_REGISTRY.definitions()
      .flatMap((definition) =>
        definition.requiredComponents.map((component) => component.id)),
  )
  return trace.components.policyUse.every(
    (use) =>
      NATIVE_SCORE_COMPONENT_IDS.has(use.component.id)
      || strategicIds.has(use.component.id)
      || (!use.used && use.stages.length === 0),
  )
}

function validNativeScoreAttribution(
  trace: DecisionTrace,
  replay: DecisionComponentRun,
): boolean {
  if (!trace.components) return false
  const selected = nativeScoreSelectionSurvived(trace)
  for (const expected of replay.policyUse) {
    if (!NATIVE_SCORE_COMPONENT_IDS.has(expected.component.id)) continue
    const actual = trace.components.policyUse.find(
      (use) => isDeepStrictEqual(use.component, expected.component),
    )
    if (!actual) return false
    const consumed = expected.stages.includes('candidate-score')
    const stages = [
      ...(consumed ? ['candidate-score'] : []),
      ...(consumed && selected ? ['action-selection'] : []),
    ]
    if (
      actual.used !== (stages.length > 0)
      || !isDeepStrictEqual(actual.stages, stages)
    ) return false
  }
  return true
}

function expectedNativeDiagnostics(
  context: CandidateScoringContext,
  trace: DecisionTrace,
  chain: ResolvedScoreLayerChain,
  componentDefinitions:
    readonly DecisionComponentDefinition<any>[],
): ExpectedNativeDiagnostics {
  if (!trace.components) {
    throw new Error('native score replay requires the component run')
  }
  const compatibilityCandidateId = candidateIdForDecision(
    heuristicDecide(
      context.request,
      context.view,
      context.deterministicSeed,
    ),
  )
  const replay = replayNativeScoresForAdmission({
    chain,
    request: context.request,
    view: context.view,
    analysis: context.analysis,
    candidates: context.candidates,
    ...(context.hypotheticalTeamCandidates
      ? {
          hypotheticalTeamCandidates:
            context.hypotheticalTeamCandidates,
        }
      : {}),
    forced: context.forced,
    candidateBoundary: context.candidateBoundary,
    deterministicSeed: context.deterministicSeed,
    compatibilityCandidateId,
    componentDefinitions,
    componentRun: trace.components,
  })
  const scorerVersion = replay.resolvedScorerVersion
  const diagnosticOwnerVersion = replay.diagnosticOwnerVersion
  const morganaToken =
    diagnosticOwnerVersion === MORGANA_ROLE_SEEDED_SCORER_VERSION
      ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
      : MORGANA_ROLE_UTILITY_COMPONENT
  const diagnosticContext: CandidateScoringContext = {
    ...context,
    ...(componentPayload(trace.components, GOOD_ROLE_UTILITY_COMPONENT)
      ? {
          roleUtility: componentPayload(
            trace.components,
            GOOD_ROLE_UTILITY_COMPONENT,
          ),
        }
      : {}),
    ...(componentPayload(trace.components, EVIL_ROLE_UTILITY_COMPONENT)
      ? {
          evilRoleUtility: componentPayload(
            trace.components,
            EVIL_ROLE_UTILITY_COMPONENT,
          ),
        }
      : {}),
    ...(componentPayload(trace.components, morganaToken)
      ? {
          morganaRoleUtility: componentPayload(
            trace.components,
            morganaToken,
          ),
        }
      : {}),
  }
  return Object.freeze({
    scores: projectConfiguredScoreDiagnostics(
      diagnosticContext,
      replay.rows,
      scorerVersion,
      chain.order.map((layer) => layer.version),
      diagnosticOwnerVersion,
    ),
    componentRun: replay.componentRun,
    resolvedScorerVersion: scorerVersion,
    scoreLayerRun: replay.trace,
  })
}

/**
 * For the exact, API-free role architecture, dependency failures are
 * host-recomputable from the authoritative PlayerView. Do not admit a trace
 * that hides a recoverable identity/objective/utility chain behind forged
 * degradation labels. Language-weighted variants are deliberately excluded:
 * their bounded external evidence must be validated by its own attribution
 * path rather than reconstructed as exact cognition.
 *
 * Exact routed D1 dependencies are wholly reconstructable from PlayerView.
 * Rebuild the mandatory hidden-team scope and reject coordinated deletion or
 * scope substitution hidden behind degradation labels. Weighted dependencies
 * remain externally attributable through their narrowly typed paired
 * degradation because the host does not own their private world weights.
 */
export function validateExactNativeScoreSurface(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
  deterministicSeed: string,
  d3HostSurface: ExactPolicyHostSurface,
  expectedArchitectureIdentity: ResolvedArchitectureIdentity,
): boolean {
  try {
    const {
      candidates,
      analysis,
      hypotheticalTeamCandidates,
      effectiveForced: forced,
      candidateBoundary,
    } = d3HostSurface
    const scorerVersion = trace.componentVersions?.scorer
    const configuredScorer =
      expectedArchitectureIdentity.configuredPipeline.scoring
        .configuredScorer
    const chain = trustedNativeScoreChain(expectedArchitectureIdentity)
    if (
      !scorerVersion
      || !configuredNativeScorerVersion(scorerVersion)
      || !chain
    ) {
      return false
    }
    const expected = expectedNativeDiagnostics({
      deterministicSeed,
      request: req,
      view,
      analysis,
      candidates,
      ...(hypotheticalTeamCandidates
        ? { hypotheticalTeamCandidates }
        : {}),
      forced,
      candidateBoundary,
    }, trace, chain, expectedArchitectureIdentity.components.eligible.map(
      (ref) => {
        const definition = PRODUCTION_COMPONENT_REGISTRY.definition(ref)
        if (!definition) {
          throw new Error('native score replay component is unavailable')
        }
        return definition
      },
    ))
    const expectedConfiguredAttribution =
      expected.resolvedScorerVersion === configuredScorer
        ? undefined
        : configuredScorer
    return isDeepStrictEqual(trace.forcedPolicyResult, forced)
      && isDeepStrictEqual(trace.candidateScores, expected.scores)
      && isDeepStrictEqual(trace.scoreLayerRun, expected.scoreLayerRun)
      && scorerVersion === expected.resolvedScorerVersion
      && trace.componentVersions?.configuredScorer
        === expectedConfiguredAttribution
      && trace.structuredCandidateId === (
        candidateBoundary.selectedCandidateId
        ?? selectTopViableScore(expected.scores).candidateId
      )
      && validNativeScoreAttribution(trace, expected.componentRun)
  } catch {
    return false
  }
}
