import type {
  DecisionLayerDefinition,
  DecisionLayerRef,
  ResolvedDecisionLayerOrder,
} from './types.ts'
import { decisionLayerToken } from './types.ts'
import {
  LAYER_ID_PATTERN as ID_PATTERN,
  assertLayerRef,
  freezeRequiredComponents,
} from '../layer-registry-common.ts'

export type DecisionLayerRegistryErrorCode =
  | 'invalid-definition'
  | 'duplicate-identity'
  | 'conflicting-version'
  | 'unknown-layer'
  | 'duplicate-layer'

export class DecisionLayerRegistryError extends Error {
  readonly code: DecisionLayerRegistryErrorCode

  constructor(code: DecisionLayerRegistryErrorCode, message: string) {
    super(message)
    this.name = 'DecisionLayerRegistryError'
    this.code = code
  }
}

export interface DecisionLayerRegistry {
  readonly size: number
  definitions(): readonly DecisionLayerDefinition[]
  definition(ref: DecisionLayerRef): DecisionLayerDefinition | undefined
  resolve(order: readonly DecisionLayerRef[]): ResolvedDecisionLayerOrder
}

export function decisionLayerIdentityKey(ref: DecisionLayerRef): string {
  return `${ref.id}@${ref.version}`
}

function raiseInvalidDefinition(message: string): never {
  throw new DecisionLayerRegistryError('invalid-definition', message)
}

function assertRef(ref: DecisionLayerRef, label: string): void {
  assertLayerRef(ref, label, raiseInvalidDefinition)
}

function frozenRef(ref: DecisionLayerRef): DecisionLayerRef {
  assertRef(ref, 'decision layer reference')
  return Object.freeze({ id: ref.id, version: ref.version })
}

function freezeDefinition(
  definition: DecisionLayerDefinition,
): DecisionLayerDefinition {
  if (
    !definition
    || typeof definition !== 'object'
    || typeof definition.applies !== 'function'
    || typeof definition.execute !== 'function'
    || !Array.isArray(definition.requiredComponents)
    || typeof definition.degradationCode !== 'string'
    || !ID_PATTERN.test(definition.degradationCode)
  ) {
    throw new DecisionLayerRegistryError(
      'invalid-definition',
      'decision layer definition has an incomplete contract',
    )
  }
  assertRef(definition.token, 'decision layer token')
  const requiredComponents = freezeRequiredComponents(
    definition.token,
    definition.requiredComponents,
    raiseInvalidDefinition,
  )
  return Object.freeze({
    token: decisionLayerToken(
      definition.token.id,
      definition.token.version,
    ),
    requiredComponents: Object.freeze(requiredComponents),
    degradationCode: definition.degradationCode,
    applies: definition.applies.bind(definition),
    execute: definition.execute.bind(definition),
  })
}

export function createDecisionLayerRegistry(
  sourceDefinitions: readonly DecisionLayerDefinition[],
): DecisionLayerRegistry {
  if (!Array.isArray(sourceDefinitions)) {
    throw new DecisionLayerRegistryError(
      'invalid-definition',
      'decision layer definitions must be an array',
    )
  }
  const definitions = sourceDefinitions.map(freezeDefinition)
  const byKey = new Map<string, DecisionLayerDefinition>()
  const versionById = new Map<string, string>()
  for (const definition of definitions) {
    const key = decisionLayerIdentityKey(definition.token)
    if (byKey.has(key)) {
      throw new DecisionLayerRegistryError(
        'duplicate-identity',
        `duplicate decision layer identity ${key}`,
      )
    }
    const prior = versionById.get(definition.token.id)
    if (prior !== undefined && prior !== definition.token.version) {
      throw new DecisionLayerRegistryError(
        'conflicting-version',
        `decision layer ${definition.token.id} has conflicting versions`,
      )
    }
    byKey.set(key, definition)
    versionById.set(definition.token.id, definition.token.version)
  }
  const exposed = Object.freeze([...definitions].sort((left, right) =>
    decisionLayerIdentityKey(left.token).localeCompare(
      decisionLayerIdentityKey(right.token),
      'en',
    )))
  return Object.freeze({
    size: exposed.length,
    definitions: () => exposed,
    definition: (ref: DecisionLayerRef) =>
      byKey.get(decisionLayerIdentityKey(ref)),
    resolve(sourceOrder: readonly DecisionLayerRef[]) {
      if (!Array.isArray(sourceOrder)) {
        throw new DecisionLayerRegistryError(
          'invalid-definition',
          'decision layer order must be an array',
        )
      }
      const order = sourceOrder.map(frozenRef)
      const keys = new Set<string>()
      const resolved: DecisionLayerDefinition[] = []
      for (const ref of order) {
        const key = decisionLayerIdentityKey(ref)
        if (keys.has(key)) {
          throw new DecisionLayerRegistryError(
            'duplicate-layer',
            `decision layer order repeats ${key}`,
          )
        }
        keys.add(key)
        const definition = byKey.get(key)
        if (!definition) {
          throw new DecisionLayerRegistryError(
            'unknown-layer',
            `unknown decision layer ${key}`,
          )
        }
        resolved.push(definition)
      }
      return Object.freeze({
        order: Object.freeze(order),
        definitions: Object.freeze(resolved),
      })
    },
  })
}

export const EMPTY_DECISION_LAYER_REGISTRY =
  createDecisionLayerRegistry([])
