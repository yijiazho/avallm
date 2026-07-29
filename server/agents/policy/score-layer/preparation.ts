import type {
  ResolvedScoreLayerChain,
  ScoreLayerAnalysisRef,
  ScoreLayerAnalysisRequirementContext,
} from './types.ts'

export const MAX_SCORE_LAYER_ANALYSIS_REFS = 64
export const MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH = 256

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/

export type ScoreLayerPreparationEntry =
  | Readonly<{
      status: 'ready'
      requirements: readonly ScoreLayerAnalysisRef[]
    }>
  | Readonly<{
      status: 'disabled'
      requirements: readonly ScoreLayerAnalysisRef[]
    }>

export interface PreparedScoreLayerRequirements {
  readonly entries: readonly ScoreLayerPreparationEntry[]
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly evaluations: number
  readonly failures: number
  readonly refsVisited: number
}

function canonicalAnalysisRefs(
  value: readonly ScoreLayerAnalysisRef[],
): Readonly<{
  refs: readonly ScoreLayerAnalysisRef[] | undefined
  visited: number
}> {
  if (value.length > MAX_SCORE_LAYER_ANALYSIS_REFS) {
    return Object.freeze({ refs: undefined, visited: 0 })
  }
  const result: ScoreLayerAnalysisRef[] = []
  const seen = new Set<string>()
  let visited = 0
  for (const ref of value) {
    visited++
    if (
      typeof ref.id !== 'string'
      || typeof ref.version !== 'string'
      || ref.id.length > MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH
      || ref.version.length > MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH
      || !ID_PATTERN.test(ref.id)
      || !VERSION_PATTERN.test(ref.version)
      || Buffer.byteLength(ref.id, 'utf8')
        > MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH
      || Buffer.byteLength(ref.version, 'utf8')
        > MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH
    ) return Object.freeze({ refs: undefined, visited })
    const key = `${ref.id}@${ref.version}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(Object.freeze({ id: ref.id, version: ref.version }))
  }
  return Object.freeze({
    refs: Object.freeze(result),
    visited,
  })
}

export function prepareScoreLayerRequirements(
  chain: ResolvedScoreLayerChain,
  context: ScoreLayerAnalysisRequirementContext,
): PreparedScoreLayerRequirements {
  if (
    chain.definitions.length === 0
    || !context
    || typeof context !== 'object'
    || !Object.isFrozen(context.request)
    || !Object.isFrozen(context.view)
  ) throw new Error('score layer preparation requires one immutable frame')
  const entries: ScoreLayerPreparationEntry[] = []
  const requirements = new Map<string, ScoreLayerAnalysisRef>()
  const requirementList: ScoreLayerAnalysisRef[] = []
  let evaluations = 0
  let failures = 0
  let refsVisited = 0
  for (const definition of chain.definitions) {
    evaluations++
    let candidate:
      | Readonly<{
          refs: readonly ScoreLayerAnalysisRef[] | undefined
          visited: number
        }>
      | undefined
    try {
      candidate = canonicalAnalysisRefs(
        definition.analysisRequirements(context),
      )
    } catch {
      candidate = undefined
    }
    refsVisited += candidate?.visited ?? 0
    const admitted = candidate?.refs
    if (!admitted) {
      failures++
      if (definition.kind === 'root') {
        throw new Error('total score layer root analysis preparation failed')
      }
      entries.push(Object.freeze({
        status: 'disabled',
        requirements: Object.freeze([]),
      }))
      continue
    }
    for (const requirement of admitted) {
      refsVisited++
      const key = `${requirement.id}@${requirement.version}`
      if (!requirements.has(key)) {
        requirements.set(key, requirement)
        requirementList.push(requirement)
      }
    }
    entries.push(Object.freeze({
      status: 'ready',
      requirements: admitted,
    }))
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    requirements: Object.freeze(requirementList),
    evaluations,
    failures,
    refsVisited,
  })
}
