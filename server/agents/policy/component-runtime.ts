import {
  attributeComponentPolicyUseBatch,
  indexDecisionComponentPayloads,
  type DecisionComponentRun,
} from '../components/kernel.ts'
import { componentIdentityKey } from '../components/registry.ts'
import type {
  ComponentRef,
  ComponentToken,
  DecisionComponentDefinition,
} from '../components/types.ts'
import type { Immutable } from './trusted-data.ts'

export interface PolicyComponentWork {
  componentLookupAttempts: number
  componentPayloadIndexEntriesVisited: number
  componentPayloadReads: number
  componentPayloadsMaterialized: number
  componentDefinitionIndexEntriesVisited: number
  componentClosureRootsVisited: number
  componentDependencyEdgesVisited: number
  componentClosureComponentsEmitted: number
  componentAttributionUnionTokensVisited: number
  componentAttributionTokensVisited: number
  componentAttributionEntriesVisited: number
  componentAttributionPolicyUseEntriesVisited: number
}

export interface PolicyComponentReader {
  get<Payload>(
    token: ComponentToken<Payload>,
  ): Immutable<Payload> | undefined
  require<Payload>(token: ComponentToken<Payload>): Immutable<Payload>
}

export interface PolicyComponentReadJournal {
  readonly lookups: Map<string, ComponentRef>
  readonly reads: Map<string, ComponentRef>
}

export function policyComponentReadJournal(): PolicyComponentReadJournal {
  return {
    lookups: new Map(),
    reads: new Map(),
  }
}

function frozenComponentRef(ref: ComponentRef): ComponentRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

export function frozenPolicyComponentRefs(
  values: ReadonlyMap<string, ComponentRef>,
): readonly ComponentRef[] {
  return Object.freeze([...values.values()])
}

interface PolicyLayerDefinition {
  readonly token: ComponentRef
  readonly requiredComponents: readonly ComponentToken[]
}

interface CachedPayload {
  readonly payload: unknown
}

interface ComponentClosure {
  readonly tokens: readonly ComponentToken[]
  readonly refs: readonly ComponentRef[]
}

export interface PolicyComponentRuntime<
  Layer extends PolicyLayerDefinition,
> {
  reader(
    definition: Layer,
    journal: PolicyComponentReadJournal,
  ): PolicyComponentReader
  attribute(
    reads: ReadonlyMap<string, ComponentRef>,
  ): readonly ComponentRef[]
  finalize(
    run: Immutable<DecisionComponentRun>,
  ): Immutable<DecisionComponentRun>
}

export interface PolicyComponentRuntimeInput<
  Layer extends PolicyLayerDefinition,
  RequirementCounter extends string,
  Work extends PolicyComponentWork & Record<RequirementCounter, number>,
> {
  readonly owner: string
  readonly stage: string
  readonly componentDefinitions:
    readonly DecisionComponentDefinition<any>[]
  readonly componentRun: Immutable<DecisionComponentRun>
  readonly layerDefinitions: readonly Layer[]
  readonly requirementCounter: RequirementCounter
  readonly operations: Work
}

/**
 * Shared component reader, dependency closure, and causal-attribution owner
 * for generic policy layers. Direct reads remain separate from the exact
 * stack-safe transitive closure attributed after an accepted layer result.
 */
export function createPolicyComponentRuntime<
  Layer extends PolicyLayerDefinition,
  RequirementCounter extends string,
  Work extends PolicyComponentWork & Record<RequirementCounter, number>,
>(
  input: PolicyComponentRuntimeInput<Layer, RequirementCounter, Work>,
): PolicyComponentRuntime<Layer> {
  const {
    owner,
    stage,
    componentDefinitions,
    componentRun,
    layerDefinitions,
    requirementCounter,
    operations,
  } = input
  const payloadIndex = indexDecisionComponentPayloads(componentRun)
  operations.componentPayloadIndexEntriesVisited =
    payloadIndex.entriesVisited

  const definitions = new Map<
    string,
    DecisionComponentDefinition<any>
  >()
  for (const definition of componentDefinitions) {
    operations.componentDefinitionIndexEntriesVisited++
    const key = componentIdentityKey(definition.token)
    if (definitions.has(key)) {
      throw new Error(`${owner} component graph repeats ${key}`)
    }
    definitions.set(key, definition)
  }

  const declaredByLayer = new Map<
    string,
    ReadonlyMap<string, ComponentToken>
  >()
  for (const layer of layerDefinitions) {
    const declared = new Map<string, ComponentToken>()
    for (const token of layer.requiredComponents) {
      operations[requirementCounter]++
      declared.set(componentIdentityKey(token), token)
    }
    declaredByLayer.set(componentIdentityKey(layer.token), declared)
  }

  const cache = new Map<string, CachedPayload>()
  const acceptedAttributionTokens = new Map<string, ComponentToken>()
  const acceptedAttributionTokenList: ComponentToken[] = []

  const closureFor = (
    reads: ReadonlyMap<string, ComponentRef>,
  ): ComponentClosure => {
    const closure = new Set<string>()
    const visiting = new Set<string>()
    const tokens: ComponentToken[] = []
    const refs: ComponentRef[] = []
    interface ClosureFrame {
      readonly key: string
      readonly definition: DecisionComponentDefinition<any>
      dependencyIndex: number
    }
    const visit = (rootKey: string): void => {
      if (closure.has(rootKey)) return
      const rootDefinition = definitions.get(rootKey)
      if (!rootDefinition) {
        throw new Error(`${owner} read unknown component ${rootKey}`)
      }
      const stack: ClosureFrame[] = [{
        key: rootKey,
        definition: rootDefinition,
        dependencyIndex: 0,
      }]
      visiting.add(rootKey)
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!
        if (frame.dependencyIndex < frame.definition.dependencies.length) {
          const dependency =
            frame.definition.dependencies[frame.dependencyIndex]!
          frame.dependencyIndex++
          operations.componentDependencyEdgesVisited++
          const dependencyKey = componentIdentityKey(dependency)
          if (closure.has(dependencyKey)) continue
          if (visiting.has(dependencyKey)) {
            throw new Error(
              `${owner} component graph contains cycle at ${dependencyKey}`,
            )
          }
          const dependencyDefinition = definitions.get(dependencyKey)
          if (!dependencyDefinition) {
            throw new Error(
              `${owner} read unknown component ${dependencyKey}`,
            )
          }
          visiting.add(dependencyKey)
          stack.push({
            key: dependencyKey,
            definition: dependencyDefinition,
            dependencyIndex: 0,
          })
          continue
        }
        stack.pop()
        visiting.delete(frame.key)
        if (payloadIndex.payload(frame.definition.token) === undefined) {
          throw new Error(
            `${owner} requires unavailable component ${frame.key}`,
          )
        }
        closure.add(frame.key)
        operations.componentClosureComponentsEmitted++
        tokens.push(frame.definition.token)
        refs.push(frozenComponentRef(frame.definition.token))
      }
    }
    for (const key of reads.keys()) {
      operations.componentClosureRootsVisited++
      visit(key)
    }
    return Object.freeze({
      tokens: Object.freeze(tokens),
      refs: Object.freeze(refs),
    })
  }

  return Object.freeze({
    reader(
      definition: Layer,
      journal: PolicyComponentReadJournal,
    ): PolicyComponentReader {
      const declared = declaredByLayer.get(
        componentIdentityKey(definition.token),
      )
      if (!declared) {
        throw new Error(`${owner} definition was not indexed`)
      }
      const read = <Payload>(
        token: ComponentToken<Payload>,
      ): Immutable<Payload> | undefined => {
        operations.componentLookupAttempts++
        const key = componentIdentityKey(token)
        journal.lookups.set(key, frozenComponentRef(token))
        const exact = declared.get(key)
        if (
          !exact
          || exact.kind !== token.kind
          || exact.privacy !== token.privacy
        ) {
          throw new Error(
            `${owner} attempted undeclared component read ${key}`,
          )
        }
        let cached = cache.get(key)
        if (!cached) {
          operations.componentPayloadReads++
          const payload = payloadIndex.payload(exact)
          cached = Object.freeze({ payload })
          cache.set(key, cached)
          if (payload !== undefined) {
            operations.componentPayloadsMaterialized++
          }
        }
        if (cached.payload !== undefined) {
          journal.reads.set(key, frozenComponentRef(exact))
        }
        return cached.payload as Immutable<Payload> | undefined
      }
      return Object.freeze({
        get: read,
        require<Payload>(
          token: ComponentToken<Payload>,
        ): Immutable<Payload> {
          const payload = read(token)
          if (payload === undefined) {
            throw new Error(
              `${owner} requires unavailable component ${
                componentIdentityKey(token)
              }`,
            )
          }
          return payload
        },
      })
    },
    attribute(reads: ReadonlyMap<string, ComponentRef>) {
      const closure = closureFor(reads)
      for (const token of closure.tokens) {
        operations.componentAttributionUnionTokensVisited++
        const key = componentIdentityKey(token)
        if (!acceptedAttributionTokens.has(key)) {
          acceptedAttributionTokens.set(key, token)
          acceptedAttributionTokenList.push(token)
        }
      }
      return closure.refs
    },
    finalize(run: Immutable<DecisionComponentRun>) {
      const attribution = attributeComponentPolicyUseBatch(
        run,
        acceptedAttributionTokenList,
        stage,
      )
      operations.componentAttributionTokensVisited +=
        attribution.work.tokensVisited
      operations.componentAttributionEntriesVisited +=
        attribution.work.entriesVisited
      operations.componentAttributionPolicyUseEntriesVisited +=
        attribution.work.policyUseEntriesVisited
      return attribution.run as Immutable<DecisionComponentRun>
    },
  })
}
