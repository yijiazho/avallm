import type { DecisionKind } from '../../engine/types.ts'
import type {
  NativeScoreLayersResolvedDecisionFrame,
  ScoredDecisionFrame,
} from '../policy/decision-frame.ts'
import type { CandidateScorer } from '../policy/score.ts'
import type {
  ScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import {
  createScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import type { ScoreLayerToken } from '../policy/score-layer/types.ts'
import {
  goodScoreLayerDefinitions,
  goodScoreLayerTerminalFor,
  goodScoreLayersApplyToDecision,
} from './good.ts'
import {
  assertGoodScoreLayerLegacyEquality,
} from './legacy-equality.ts'

/**
 * The deliberately small composition seam for concrete score families.
 *
 * A3 extends this file with one evil-family catalog entry. Generic policy and
 * composition code must not learn concrete family identities or equality
 * adapters.
 */
export function configuredScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  return goodScoreLayerTerminalFor(scorer)
}

export function configuredScoreLayersApplyToDecision(
  kind: DecisionKind,
): boolean {
  return goodScoreLayersApplyToDecision(kind)
}

export function createConfiguredScoreLayerRegistry(): ScoreLayerRegistry {
  return createScoreLayerRegistry([
    ...goodScoreLayerDefinitions(),
  ])
}

/**
 * Temporary A0/A2 shadow edge. A4 deletes this dispatch with the legacy
 * scoring writer after every configured family has crossed the equality gate.
 */
export function assertConfiguredScoreLayerLegacyEquality(
  native: NativeScoreLayersResolvedDecisionFrame,
  legacy: ScoredDecisionFrame,
): void {
  assertGoodScoreLayerLegacyEquality(native, legacy)
}
