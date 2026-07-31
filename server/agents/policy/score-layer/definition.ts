import type {
  ScoreLayerToken,
  ScoreLayerTransformDefinition,
} from './types.ts'

/** Sentinel value that drops a candidate below every real score. */
export const REMOVED_VALUE = -Number.MAX_SAFE_INTEGER

/** The deterministic and seeded terminals of a two-layer role stack. */
export interface RoleScoreLayerPredecessors {
  readonly deterministic: ScoreLayerToken
  readonly seeded: ScoreLayerToken
}

/**
 * One built-in scorer identity: the scorer object a family answers to and the
 * score-layer token that owns it. A family states its terminal identities once
 * as a list of these, and both its terminalFor lookup and the configured seam's
 * terminal token set derive from that single list, so a scorer the family knows
 * about cannot be missing from either.
 *
 * The scorer is generic so this stays role-blind: the concrete scorer type
 * lives with the concrete families, not with the generic score-layer skeleton.
 */
export interface ScoreLayerTerminalIdentity<Scorer> {
  readonly scorer: Scorer | undefined
  readonly token: ScoreLayerToken
}

/**
 * Derive a family's exact built-in identity lookup from its terminal list.
 * Matches on scorer object identity, so a same-version custom writer, which is
 * a distinct object, stays legacy and resolves to undefined. An identity whose
 * scorer is undefined (the compatibility root) answers an undefined scorer.
 */
export function terminalForIdentities<Scorer>(
  identities: readonly ScoreLayerTerminalIdentity<Scorer>[],
): (scorer: Scorer | undefined) => ScoreLayerToken | undefined {
  return (scorer) => {
    for (const identity of identities) {
      if (identity.scorer === scorer) return identity.token
    }
    return undefined
  }
}

type NoAnalysisTransformSpec = Pick<
  ScoreLayerTransformDefinition,
  | 'token'
  | 'predecessor'
  | 'requiredComponents'
  | 'diagnosticOwner'
  | 'applies'
  | 'execute'
>

/**
 * Build a frozen transform score layer that requires no situation analysis.
 * Fills the constant fields every role stack repeats: the transform kind, the
 * `${token.id}-failed` degradation code, and the empty-analysis contract. Each
 * role module supplies only its applicability guard and scoring body, so a
 * change to those conventions lands in one place rather than at each site.
 */
export function noAnalysisTransformLayer(
  spec: NoAnalysisTransformSpec,
): ScoreLayerTransformDefinition {
  const definition: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token: spec.token,
    predecessor: spec.predecessor,
    requiredComponents: spec.requiredComponents,
    degradationCode: `${spec.token.id}-failed`,
    analysisRequirements: () => Object.freeze([]),
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    applies: spec.applies,
    execute: spec.execute,
    ...(spec.diagnosticOwner === undefined
      ? {}
      : { diagnosticOwner: spec.diagnosticOwner }),
  }
  return Object.freeze(definition)
}
