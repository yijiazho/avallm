import assert from 'node:assert/strict'
import type {
  ScoreLayerRun,
  ScoreLayerRunCompletion,
  ScoreLayerRunPreparation,
  ScoreLayerSurface,
} from '../../server/agents/policy/score-layer/types.ts'

export interface ScoreLayerContractInput
extends ScoreLayerRunPreparation, ScoreLayerRunCompletion {}

/** Shared structural and operation-budget laws for native score-layer families. */
export function assertScoreLayerRunContract(
  input: ScoreLayerContractInput,
  run: ScoreLayerRun,
  constructedSurfaces: readonly ScoreLayerSurface[],
): void {
  assert.deepEqual(run.configured, input.chain.order)
  assert.equal(run.journal.length, input.chain.order.length)
  assert.equal(
    run.operations.analysisRequirementEvaluations,
    input.chain.order.length,
  )
  assert.equal(
    run.operations.analysisAdmissionEvaluations
      + run.operations.analysisRequirementFailures,
    input.chain.order.length,
  )
  assert.ok(
    run.operations.analysisAdmissionFailures
      <= run.operations.analysisAdmissionEvaluations,
  )
  assert.ok(
    run.operations.analysisRefsVisited
      <= input.chain.order.length * 64 * 2,
  )
  assert.equal(
    run.operations.forcedCandidateIdsVisited,
    input.forced.allowedCandidateIds.length,
  )
  assert.equal(
    run.operations.legalCandidatesVisited,
    input.candidates.length,
  )
  assert.ok(
    run.operations.applicabilityEvaluations
      <= input.chain.order.length - 1,
  )
  assert.ok(run.operations.layersExecuted <= input.chain.order.length)
  assert.ok(
    run.operations.componentPayloadsMaterialized
      <= run.operations.componentPayloadReads,
  )
  assert.ok(
    run.operations.componentPayloadReads
      <= run.operations.componentLookupAttempts,
  )
  assert.equal(
    run.operations.componentPayloadIndexEntriesVisited,
    input.componentRun.entries.length,
  )
  assert.equal(
    run.operations.componentDefinitionIndexEntriesVisited,
    input.componentDefinitions.length,
  )
  assert.ok(
    run.operations.componentClosureRootsVisited
      <= run.operations.componentLookupAttempts,
  )
  assert.equal(
    run.operations.scoreLayerComponentRequirementsIndexed,
    input.chain.definitions.reduce(
      (total, definition) =>
        total + definition.requiredComponents.length,
      0,
    ),
  )
  assert.equal(
    run.operations.componentClosureComponentsEmitted,
    run.operations.componentAttributionUnionTokensVisited,
  )
  assert.ok(
    run.operations.componentAttributionTokensVisited
      <= run.operations.componentAttributionUnionTokensVisited,
  )
  assert.equal(
    run.operations.componentAttributionEntriesVisited,
    run.operations.componentAttributionPolicyUseEntriesVisited,
  )
  assert.equal(
    run.operations.componentAttributionEntriesVisited,
    run.operations.componentAttributionTokensVisited === 0
      ? 0
      : input.componentRun.entries.length,
  )
  assert.ok(
    run.operations.surfaceRowsVisited
      <= input.candidates.length * run.operations.surfaceBuildAttempts,
  )
  assert.ok(
    run.operations.surfacePriorSurvivorsVisited
      <= input.candidates.length * run.operations.surfaceBuildAttempts,
  )
  assert.ok(
    run.operations.surfaceDraftSurvivorsVisited
      <= input.candidates.length * run.operations.surfaceBuildAttempts,
  )
  assert.ok(run.operations.surfaceBuildAttempts >= constructedSurfaces.length)
  assert.ok(
    run.operations.surfaceReasonsVisited
      <= run.operations.surfaceRowsVisited * 32,
  )
  assert.equal(
    run.operations.surfaceBytesConstructed,
    constructedSurfaces.reduce(
      (total, surface) =>
        total + Buffer.byteLength(JSON.stringify(surface), 'utf8'),
      0,
    ),
  )
  assert.ok(Object.isFrozen(run))
  assert.ok(Object.isFrozen(run.configured))
  assert.ok(Object.isFrozen(run.journal))
  assert.ok(Object.isFrozen(run.surface))
  assert.equal(run.surface.version, 'score-layer-surface-v1')
  assert.ok(Object.isFrozen(run.surface.scores))
  assert.ok(Object.isFrozen(run.surface.survivorCandidateIds))
  assert.ok(Object.isFrozen(run.componentRun))
  assert.ok(Object.isFrozen(run.operations))
  assert.deepEqual(
    run.surface.scores.map((score) => score.candidateId),
    input.candidates.map((candidate) => candidate.id),
  )
}
