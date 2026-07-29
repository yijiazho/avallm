import type {
  ResolvedScoreLayerChain,
  ScoreLayerDefinition,
  ScoreLayerRef,
} from './types.ts'
import { scoreLayerToken } from './types.ts'

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/

export type ScoreLayerRegistryErrorCode =
  | 'invalid-definition'
  | 'duplicate-identity'
  | 'conflicting-version'
  | 'missing-predecessor'
  | 'multiple-roots'
  | 'dependency-cycle'
  | 'unknown-terminal'
  | 'misordered-chain'

export class ScoreLayerRegistryError extends Error {
  readonly code: ScoreLayerRegistryErrorCode

  constructor(code: ScoreLayerRegistryErrorCode, message: string) {
    super(message)
    this.name = 'ScoreLayerRegistryError'
    this.code = code
  }
}

export interface ScoreLayerResolutionRequest {
  readonly terminal: ScoreLayerRef
  /**
   * Optional assertion used by construction codecs and tests. Runtime callers
   * normally request only the terminal and accept the derived canonical chain.
   */
  readonly declaredOrder?: readonly ScoreLayerRef[]
}

export interface ScoreLayerRegistry {
  readonly size: number
  definitions(): readonly ScoreLayerDefinition[]
  definition(ref: ScoreLayerRef): ScoreLayerDefinition | undefined
  resolve(request: ScoreLayerResolutionRequest): ResolvedScoreLayerChain
}

export function scoreLayerIdentityKey(ref: ScoreLayerRef): string {
  return `${ref.id}@${ref.version}`
}

function assertRef(ref: ScoreLayerRef, label: string): void {
  if (
    !ref
    || typeof ref !== 'object'
    || typeof ref.id !== 'string'
    || typeof ref.version !== 'string'
    || !ID_PATTERN.test(ref.id)
    || !VERSION_PATTERN.test(ref.version)
  ) {
    throw new ScoreLayerRegistryError(
      'invalid-definition',
      `${label} must use canonical non-empty id and version strings`,
    )
  }
}

function freezeRef(ref: ScoreLayerRef): ScoreLayerRef {
  assertRef(ref, 'score layer reference')
  return Object.freeze({ id: ref.id, version: ref.version })
}

function freezeDefinition(
  definition: ScoreLayerDefinition,
): ScoreLayerDefinition {
  if (
    !definition
    || typeof definition !== 'object'
    || typeof definition.execute !== 'function'
    || typeof definition.analysisRequirements !== 'function'
    || typeof definition.admitAnalysis !== 'function'
    || !Array.isArray(definition.requiredComponents)
    || !['root', 'transform'].includes(definition.kind)
    || (
      definition.kind === 'transform'
      && (
        typeof definition.applies !== 'function'
        || typeof definition.degradationCode !== 'string'
        || !ID_PATTERN.test(definition.degradationCode)
      )
    )
  ) {
    throw new ScoreLayerRegistryError(
      'invalid-definition',
      'score layer definition has an incomplete contract',
    )
  }
  assertRef(definition.token, 'score layer token')
  const predecessor = definition.kind === 'transform'
    ? freezeRef(definition.predecessor)
    : undefined
  if (
    predecessor
    && scoreLayerIdentityKey(predecessor)
      === scoreLayerIdentityKey(definition.token)
  ) {
    throw new ScoreLayerRegistryError(
      'dependency-cycle',
      `score layer ${scoreLayerIdentityKey(definition.token)} depends on itself`,
    )
  }
  const requiredComponents = definition.requiredComponents.map(
    (component, index) => {
      if (
        !component
        || typeof component !== 'object'
        || typeof component.id !== 'string'
        || typeof component.version !== 'string'
        || !ID_PATTERN.test(component.id)
        || !VERSION_PATTERN.test(component.version)
        || !['observer', 'objective', 'projection', 'decision-rule']
          .includes(component.kind)
        || !['public', 'private'].includes(component.privacy)
      ) {
        throw new ScoreLayerRegistryError(
          'invalid-definition',
          `${scoreLayerIdentityKey(definition.token)} component ${index} is invalid`,
        )
      }
      return Object.freeze({
        id: component.id,
        version: component.version,
        kind: component.kind,
        privacy: component.privacy,
      })
    },
  )
  const componentKeys = requiredComponents.map(scoreLayerIdentityKey)
  if (new Set(componentKeys).size !== componentKeys.length) {
    throw new ScoreLayerRegistryError(
      'invalid-definition',
      `${scoreLayerIdentityKey(definition.token)} repeats a component read`,
    )
  }
  return Object.freeze({
    token: scoreLayerToken(definition.token.id, definition.token.version),
    kind: definition.kind,
    requiredComponents: Object.freeze(requiredComponents),
    analysisRequirements: definition.analysisRequirements.bind(definition),
    admitAnalysis: definition.admitAnalysis.bind(definition),
    execute: definition.execute.bind(definition),
    ...(definition.kind === 'transform'
      ? {
          predecessor: predecessor!,
          degradationCode: definition.degradationCode,
          applies: definition.applies.bind(definition),
        }
      : {}),
  }) as ScoreLayerDefinition
}

function dependencyCycle(
  definitions: readonly ScoreLayerDefinition[],
  byKey: ReadonlyMap<string, ScoreLayerDefinition>,
): readonly string[] | undefined {
  const complete = new Set<string>()
  for (const definition of definitions) {
    const start = scoreLayerIdentityKey(definition.token)
    if (complete.has(start)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: string | undefined = start
    while (current !== undefined && !complete.has(current)) {
      const seen = pathIndex.get(current)
      if (seen !== undefined) return [...path.slice(seen), current]
      pathIndex.set(current, path.length)
      path.push(current)
      const currentDefinition = byKey.get(current)
      current = currentDefinition?.kind === 'transform'
        ? scoreLayerIdentityKey(currentDefinition.predecessor)
        : undefined
    }
    for (const key of path) complete.add(key)
  }
  return undefined
}

export function createScoreLayerRegistry(
  sourceDefinitions: readonly ScoreLayerDefinition[],
): ScoreLayerRegistry {
  if (!Array.isArray(sourceDefinitions)) {
    throw new ScoreLayerRegistryError(
      'invalid-definition',
      'score layer definitions must be an array',
    )
  }
  const definitions = sourceDefinitions.map(freezeDefinition)
  const byKey = new Map<string, ScoreLayerDefinition>()
  const versionById = new Map<string, string>()
  for (const definition of definitions) {
    const key = scoreLayerIdentityKey(definition.token)
    if (byKey.has(key)) {
      throw new ScoreLayerRegistryError(
        'duplicate-identity',
        `duplicate score layer identity ${key}`,
      )
    }
    const version = versionById.get(definition.token.id)
    if (version !== undefined && version !== definition.token.version) {
      throw new ScoreLayerRegistryError(
        'conflicting-version',
        `score layer ${definition.token.id} has conflicting versions`,
      )
    }
    byKey.set(key, definition)
    versionById.set(definition.token.id, definition.token.version)
  }
  for (const definition of definitions) {
    if (definition.kind !== 'transform') continue
    const key = scoreLayerIdentityKey(definition.predecessor)
    if (!byKey.has(key)) {
      throw new ScoreLayerRegistryError(
        'missing-predecessor',
        `${scoreLayerIdentityKey(definition.token)} requires missing ${key}`,
      )
    }
  }
  const roots = definitions.filter((definition) => definition.kind === 'root')
  if (definitions.length > 0 && roots.length !== 1) {
    throw new ScoreLayerRegistryError(
      'multiple-roots',
      `nonempty score layer registry requires exactly one root; found ${roots.length}`,
    )
  }
  const cycle = dependencyCycle(definitions, byKey)
  if (cycle) {
    throw new ScoreLayerRegistryError(
      'dependency-cycle',
      `score layer dependency cycle: ${cycle.join(' -> ')}`,
    )
  }
  const exposed = Object.freeze([...definitions].sort((left, right) =>
    scoreLayerIdentityKey(left.token).localeCompare(
      scoreLayerIdentityKey(right.token),
      'en',
    )))

  return Object.freeze({
    size: exposed.length,
    definitions: () => exposed,
    definition: (ref: ScoreLayerRef) =>
      byKey.get(scoreLayerIdentityKey(ref)),
    resolve(request: ScoreLayerResolutionRequest) {
      if (!request || typeof request !== 'object') {
        throw new ScoreLayerRegistryError(
          'unknown-terminal',
          'score layer resolution requires a terminal',
        )
      }
      assertRef(request.terminal, 'score layer terminal')
      const terminalKey = scoreLayerIdentityKey(request.terminal)
      if (!byKey.has(terminalKey)) {
        throw new ScoreLayerRegistryError(
          'unknown-terminal',
          `unknown score layer terminal ${terminalKey}`,
        )
      }
      const reversed: ScoreLayerDefinition[] = []
      let current = byKey.get(terminalKey)
      while (current) {
        reversed.push(current)
        current = current.kind === 'transform'
          ? byKey.get(scoreLayerIdentityKey(current.predecessor))
          : undefined
      }
      const chain = reversed.reverse()
      const order = Object.freeze(chain.map((entry) => freezeRef(entry.token)))
      if (request.declaredOrder !== undefined) {
        if (!Array.isArray(request.declaredOrder)) {
          throw new ScoreLayerRegistryError(
            'misordered-chain',
            'declared score layer order must be an array',
          )
        }
        const declared = request.declaredOrder.map(freezeRef)
        if (
          declared.length !== order.length
          || declared.some((entry, index) =>
            scoreLayerIdentityKey(entry) !== scoreLayerIdentityKey(order[index]))
        ) {
          throw new ScoreLayerRegistryError(
            'misordered-chain',
            'declared score layer order is not the canonical terminal chain',
          )
        }
      }
      return Object.freeze({
        terminal: freezeRef(request.terminal),
        order,
        definitions: Object.freeze([...chain]),
      })
    },
  })
}

export const EMPTY_SCORE_LAYER_REGISTRY =
  createScoreLayerRegistry([])
