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
