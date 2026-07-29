import type { DecisionComponentRun } from '../../components/kernel.ts'
import type { DecisionComponentDefinition } from '../../components/types.ts'
import type { Immutable } from '../trusted-data.ts'
import {
  createPolicyComponentRuntime,
  frozenPolicyComponentRefs,
  policyComponentReadJournal,
  type PolicyComponentReadJournal,
  type PolicyComponentRuntime,
  type PolicyComponentWork,
} from '../component-runtime.ts'
import type { ScoreLayerDefinition } from './types.ts'

export const SCORE_LAYER_POLICY_USE_STAGE = 'candidate-score'

export interface ScoreLayerComponentWork extends PolicyComponentWork {
  scoreLayerComponentRequirementsIndexed: number
}

export type ScoreLayerReadJournal = PolicyComponentReadJournal

export const scoreLayerReadJournal = policyComponentReadJournal

export const frozenScoreLayerReadRefs = frozenPolicyComponentRefs

export type ScoreLayerComponentRuntime =
  PolicyComponentRuntime<ScoreLayerDefinition>

export function createScoreLayerComponentRuntime(
  componentDefinitions: readonly DecisionComponentDefinition<any>[],
  componentRun: Immutable<DecisionComponentRun>,
  scoreLayerDefinitions: readonly ScoreLayerDefinition[],
  operations: ScoreLayerComponentWork,
): ScoreLayerComponentRuntime {
  return createPolicyComponentRuntime({
    owner: 'score layer',
    stage: SCORE_LAYER_POLICY_USE_STAGE,
    componentDefinitions,
    componentRun,
    layerDefinitions: scoreLayerDefinitions,
    requirementCounter: 'scoreLayerComponentRequirementsIndexed',
    operations,
  })
}
