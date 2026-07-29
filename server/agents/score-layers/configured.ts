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
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
  goodScoreLayerDefinitions,
  goodScoreLayerTerminalFor,
  goodScoreLayersApplyToDecision,
} from './good.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
  evilScoreLayerDefinitions,
  evilScoreLayerTerminalFor,
} from './evil.ts'
import {
  assertEvilScoreLayerLegacyEquality,
  assertGoodScoreLayerLegacyEquality,
  assertMorganaScoreLayerLegacyEquality,
} from './legacy-equality.ts'
import {
  morganaScoreLayerDefinitions,
  morganaScoreLayerTerminalFor,
} from './morgana.ts'

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
  return morganaScoreLayerTerminalFor(scorer)
    ?? evilScoreLayerTerminalFor(scorer)
    ?? goodScoreLayerTerminalFor(scorer)
}

export function configuredScoreLayersApplyToDecision(
  kind: DecisionKind,
): boolean {
  return goodScoreLayersApplyToDecision(kind)
}

export function createConfiguredScoreLayerRegistry(): ScoreLayerRegistry {
  return createScoreLayerRegistry([
    ...goodScoreLayerDefinitions(),
    ...evilScoreLayerDefinitions({
      deterministic: GOOD_ROLE_SCORE_LAYER,
      seeded: SEEDED_GOOD_ROLE_SCORE_LAYER,
    }),
    ...morganaScoreLayerDefinitions({
      deterministic: EVIL_ROLE_SCORE_LAYER,
      seeded: SEEDED_EVIL_ROLE_SCORE_LAYER,
    }),
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
  const terminal = native.scoreLayerRun.configured.at(-1)
  if (
    terminal?.id === 'morgana-role-score'
    || terminal?.id === 'seeded-morgana-role-score'
  ) {
    assertMorganaScoreLayerLegacyEquality(native, legacy)
  } else if (
    terminal?.id === 'evil-role-score'
    || terminal?.id === 'seeded-evil-role-score'
  ) {
    assertEvilScoreLayerLegacyEquality(native, legacy)
  } else {
    assertGoodScoreLayerLegacyEquality(native, legacy)
  }
}
