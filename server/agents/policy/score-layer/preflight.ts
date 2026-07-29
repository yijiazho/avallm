import type {
  ResolvedScoreLayerChain,
  ScoreLayerAnalysisRef,
  ScoreLayerAnalysisRequirementContext,
  ScoreLayerPreflight,
  ScoreLayerRunInput,
} from './types.ts'

export const SCORE_LAYER_PREFLIGHT_VERSION = 'score-layer-preflight-v1'
export const MAX_SCORE_LAYER_ANALYSIS_REFS = 64
export const MAX_SCORE_LAYER_ANALYSIS_STRING_LENGTH = 256

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/

export type ScoreLayerPreflightEntry =
  | Readonly<{
      status: 'ready'
      requirements: readonly ScoreLayerAnalysisRef[]
    }>
  | Readonly<{
      status: 'disabled'
      requirements: readonly ScoreLayerAnalysisRef[]
    }>

export interface ScoreLayerPreflightProvenance {
  readonly chain: ResolvedScoreLayerChain
  readonly request: ScoreLayerRunInput['request']
  readonly view: ScoreLayerRunInput['view']
  readonly entries: readonly ScoreLayerPreflightEntry[]
  readonly evaluations: number
  readonly failures: number
  readonly refsVisited: number
}

const PROVENANCE = new WeakMap<object, ScoreLayerPreflightProvenance>()
const CONSUMED = new WeakSet<object>()

export function canonicalScoreLayerChain(
  chain: ResolvedScoreLayerChain,
): boolean {
  if (
    chain.order.length === 0
    || chain.order.length !== chain.definitions.length
    || chain.order.some((entry, index) =>
      entry.id !== chain.definitions[index].token.id
      || entry.version !== chain.definitions[index].token.version)
    || chain.terminal.id !== chain.order.at(-1)?.id
    || chain.terminal.version !== chain.order.at(-1)?.version
    || chain.definitions[0].kind !== 'root'
  ) return false
  for (let index = 1; index < chain.definitions.length; index++) {
    const definition = chain.definitions[index]
    const predecessor = chain.order[index - 1]
    if (
      definition.kind !== 'transform'
      || definition.predecessor.id !== predecessor.id
      || definition.predecessor.version !== predecessor.version
    ) return false
  }
  return true
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

export function preflightScoreLayers(
  chain: ResolvedScoreLayerChain,
  context: ScoreLayerAnalysisRequirementContext,
): ScoreLayerPreflight {
  if (
    !canonicalScoreLayerChain(chain)
    || !context
    || typeof context !== 'object'
    || !Object.isFrozen(context.request)
    || !Object.isFrozen(context.view)
  ) throw new Error('score layer preflight requires one immutable frame')
  const entries: ScoreLayerPreflightEntry[] = []
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
        throw new Error('total score layer root analysis preflight failed')
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
  const preflight: ScoreLayerPreflight = Object.freeze({
    version: SCORE_LAYER_PREFLIGHT_VERSION,
    requirements: Object.freeze(requirementList),
  })
  PROVENANCE.set(preflight, Object.freeze({
    chain,
    request: context.request,
    view: context.view,
    entries: Object.freeze(entries),
    evaluations,
    failures,
    refsVisited,
  }))
  return preflight
}

export function consumeScoreLayerPreflight(
  input: ScoreLayerRunInput,
): ScoreLayerPreflightProvenance {
  const provenance = PROVENANCE.get(input.preflight)
  if (
    !provenance
    || provenance.chain !== input.chain
    || provenance.request !== input.request
    || provenance.view !== input.view
    || provenance.entries.length !== input.chain.definitions.length
  ) throw new Error('score layer preflight does not belong to this frame')
  if (CONSUMED.has(input.preflight)) {
    throw new Error('score layer preflight was already consumed')
  }
  CONSUMED.add(input.preflight)
  return provenance
}
