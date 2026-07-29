import type { DecisionKind } from '../../engine/types.ts'
import type { CandidateScorer } from '../policy/score.ts'
import type {
  ScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import {
  createScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import type { ScoreLayerToken } from '../policy/score-layer/types.ts'
import type { ResolvedScoreLayerChain } from '../policy/score-layer/types.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
  goodScoreLayerDefinitions,
  goodScoreLayerTerminalFor,
  goodScoreLayersApplyToDecision,
  calculateDeterministicGoodBase,
} from './good.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
  evilScoreLayerDefinitions,
  evilScoreLayerTerminalFor,
} from './evil.ts'
import {
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
  morganaScoreLayerDefinitions,
  morganaScoreLayerTerminalFor,
} from './morgana.ts'
import {
  MORDRED_ROLE_SCORE_LAYER,
  SEEDED_MORDRED_ROLE_SCORE_LAYER,
  mordredScoreLayerDefinitions,
  mordredScoreLayerTerminalFor,
} from './mordred.ts'

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
  return mordredScoreLayerTerminalFor(scorer)
    ?? morganaScoreLayerTerminalFor(scorer)
    ?? evilScoreLayerTerminalFor(scorer)
    ?? goodScoreLayerTerminalFor(scorer)
}

/**
 * Custom sources always carry a canonical native failure path. The first
 * registered descriptor in their declared base chain wins; otherwise the
 * total compatibility root is the fallback.
 */
export function configuredNativeFallbackTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken {
  const seen = new Set<CandidateScorer>()
  let current = scorer?.baseScorer
  while (current && !seen.has(current)) {
    seen.add(current)
    const terminal = configuredScoreLayerTerminalFor(current)
    if (terminal) return terminal
    current = current.baseScorer
  }
  return COMPATIBILITY_SCORE_LAYER
}

const CONFIGURED_TERMINAL_BY_VERSION = new Map<string, ScoreLayerToken>([
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
  MORGANA_ROLE_SCORE_LAYER,
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
  MORDRED_ROLE_SCORE_LAYER,
  SEEDED_MORDRED_ROLE_SCORE_LAYER,
].map((token) => [token.version, token]))

export function configuredScoreLayerTerminalForVersion(
  version: string,
): ScoreLayerToken {
  const terminal = CONFIGURED_TERMINAL_BY_VERSION.get(version)
  if (!terminal) throw new Error(`unsupported configured scorer ${version}`)
  return terminal
}

export function configuredScoreLayerChainForVersion(
  version: string,
): ResolvedScoreLayerChain {
  return createConfiguredScoreLayerRegistry().resolve({
    terminal: configuredScoreLayerTerminalForVersion(version),
  })
}

export const calculateConfiguredDeterministicGoodBase =
  calculateDeterministicGoodBase

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
    ...mordredScoreLayerDefinitions({
      deterministic: EVIL_ROLE_SCORE_LAYER,
      seeded: SEEDED_EVIL_ROLE_SCORE_LAYER,
    }),
  ])
}
