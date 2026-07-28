import type {
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentRef,
  DecisionComponentDefinition,
  HostCapability,
  IneligibleComponent,
  ResolvedComponentGraph,
} from './types.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../analysis/observer-types.ts'

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,99}$/

export type ComponentRegistryErrorCode =
  | 'invalid-definition'
  | 'invalid-host-input-definition'
  | 'duplicate-identity'
  | 'duplicate-host-input-identity'
  | 'conflicting-version'
  | 'conflicting-host-input-version'
  | 'missing-dependency'
  | 'missing-host-input'
  | 'privacy-violation'
  | 'dependency-cycle'
  | 'unknown-request'
  | 'duplicate-request'

export class ComponentRegistryError extends Error {
  readonly code: ComponentRegistryErrorCode

  constructor(code: ComponentRegistryErrorCode, message: string) {
    super(message)
    this.name = 'ComponentRegistryError'
    this.code = code
  }
}

type AnyDefinition = DecisionComponentDefinition<any>
type AnyHostInputDefinition = ComponentHostInputDefinition<any>

function identityKey(ref: ComponentRef): string {
  return `${ref.id}@${ref.version}`
}

function compareRefs(left: ComponentRef, right: ComponentRef): number {
  return identityKey(left).localeCompare(identityKey(right), 'en')
}

function frozenRef(ref: ComponentRef): ComponentRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

function frozenHostInputRef(
  ref: ComponentHostInputRef,
): ComponentHostInputRef {
  return Object.freeze({
    id: ref.id,
    version: ref.version,
    privacy: ref.privacy,
  })
}

function assertRef(ref: ComponentRef, label: string): void {
  if (
    !ref
    || typeof ref !== 'object'
    || !ID_PATTERN.test(ref.id)
    || !VERSION_PATTERN.test(ref.version)
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${label} must use canonical non-empty id and version strings`,
    )
  }
}

function assertNonEmptyCanonical(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${label} must be a canonical non-empty string`,
    )
  }
}

function assertHostInputRef(
  ref: ComponentHostInputRef,
  label: string,
): void {
  assertRef(ref, label)
  if (!['public', 'private'].includes(ref.privacy)) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${label} has an invalid privacy class`,
    )
  }
}

function freezeHostInputDefinition(
  definition: AnyHostInputDefinition,
): AnyHostInputDefinition {
  if (!definition || typeof definition !== 'object') {
    throw new ComponentRegistryError(
      'invalid-host-input-definition',
      'host input definition must be an object',
    )
  }
  try {
    assertHostInputRef(definition.token, 'host input token')
  } catch (error) {
    if (error instanceof ComponentRegistryError) {
      throw new ComponentRegistryError(
        'invalid-host-input-definition',
        error.message,
      )
    }
    throw error
  }
  if (definition.token.privacy !== 'private') {
    throw new ComponentRegistryError(
      'privacy-violation',
      `${identityKey(definition.token)} cannot be a public host input; `
        + 'v1 roots have no reconstructable public provenance',
    )
  }
  if (
    !Number.isSafeInteger(definition.maxPayloadBytes)
    || definition.maxPayloadBytes <= 0
    || typeof definition.validate !== 'function'
  ) {
    throw new ComponentRegistryError(
      'invalid-host-input-definition',
      `${identityKey(definition.token)} has an incomplete host input contract`,
    )
  }
  const token = frozenHostInputRef(definition.token)
  const validate = definition.validate.bind(definition)
  return Object.freeze({
    token,
    maxPayloadBytes: definition.maxPayloadBytes,
    validate,
  })
}

function freezeDefinition(definition: AnyDefinition): AnyDefinition {
  if (!definition || typeof definition !== 'object') {
    throw new ComponentRegistryError(
      'invalid-definition',
      'component definition must be an object',
    )
  }
  assertRef(definition.token, 'component token')
  if (
    !['observer', 'objective', 'projection', 'decision-rule']
      .includes(definition.token.kind)
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has an invalid component kind`,
    )
  }
  if (!['public', 'private'].includes(definition.token.privacy)) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has an invalid privacy class`,
    )
  }
  if (!['native', 'legacy-adapter'].includes(definition.source)) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has an invalid component source`,
    )
  }
  const contribution = definition.brainContribution
  if (
    contribution !== undefined
    && (
      !contribution
      || typeof contribution !== 'object'
      || Array.isArray(contribution)
      || Object.getPrototypeOf(contribution) !== Object.prototype
      || Object.keys(contribution).some((key) => key !== 'observerModel')
      || (
        contribution.observerModel !== undefined
        && contribution.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
      )
    )
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has invalid brain contribution`,
    )
  }
  if (
    !Number.isSafeInteger(definition.maxPayloadBytes)
    || definition.maxPayloadBytes <= 0
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} must declare a positive payload bound`,
    )
  }
  assertNonEmptyCanonical(
    definition.degradationCode,
    `${identityKey(definition.token)} degradation code`,
  )
  if (
    definition.deterministicSeedDomain !== undefined
    && (
      typeof definition.deterministicSeedDomain !== 'string'
      || !ID_PATTERN.test(definition.deterministicSeedDomain)
    )
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has an invalid seed domain`,
    )
  }
  if (
    !Array.isArray(definition.dependencies)
    || !Array.isArray(definition.requiredHostInputs)
    || !Array.isArray(definition.hostRequirements)
    || typeof definition.applies !== 'function'
    || typeof definition.execute !== 'function'
    || typeof definition.validateDetached !== 'function'
    || (
      definition.admitSuppressed !== undefined
      && typeof definition.admitSuppressed !== 'function'
    )
    || typeof definition.admitHost !== 'function'
  ) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} has an incomplete component contract`,
    )
  }
  const dependencies = definition.dependencies.map((dependency, index) => {
    assertRef(
      dependency,
      `${identityKey(definition.token)} dependency ${index}`,
    )
    return frozenRef(dependency)
  })
  const dependencyKeys = new Set<string>()
  for (const dependency of dependencies) {
    const key = identityKey(dependency)
    if (dependencyKeys.has(key)) {
      throw new ComponentRegistryError(
        'invalid-definition',
        `${identityKey(definition.token)} repeats dependency ${key}`,
      )
    }
    dependencyKeys.add(key)
  }
  const requiredHostInputs = definition.requiredHostInputs.map(
    (input, index) => {
      assertHostInputRef(
        input,
        `${identityKey(definition.token)} host input ${index}`,
      )
      return frozenHostInputRef(input)
    },
  )
  const hostInputKeys = new Set<string>()
  for (const input of requiredHostInputs) {
    const key = identityKey(input)
    if (hostInputKeys.has(key)) {
      throw new ComponentRegistryError(
        'invalid-definition',
        `${identityKey(definition.token)} repeats host input ${key}`,
      )
    }
    hostInputKeys.add(key)
  }
  const hostRequirements = definition.hostRequirements.map(
    (requirement, index) => {
      assertNonEmptyCanonical(
        requirement,
        `${identityKey(definition.token)} host requirement ${index}`,
      )
      return requirement
    },
  )
  if (new Set(hostRequirements).size !== hostRequirements.length) {
    throw new ComponentRegistryError(
      'invalid-definition',
      `${identityKey(definition.token)} repeats a host requirement`,
    )
  }
  const token = Object.freeze({
    id: definition.token.id,
    version: definition.token.version,
    kind: definition.token.kind,
    privacy: definition.token.privacy,
  })
  const validateDetached = definition.validateDetached.bind(definition)
  const admitSuppressed = definition.admitSuppressed?.bind(definition)
  const admitHost = definition.admitHost.bind(definition)
  const applies = definition.applies.bind(definition)
  const execute = definition.execute.bind(definition)
  return Object.freeze({
    token,
    source: definition.source,
    ...(contribution === undefined
      ? {}
      : {
          brainContribution: Object.freeze({
            ...(contribution.observerModel === undefined
              ? {}
              : { observerModel: contribution.observerModel }),
          }),
        }),
    dependencies: Object.freeze(dependencies),
    requiredHostInputs: Object.freeze(requiredHostInputs),
    hostRequirements: Object.freeze(hostRequirements),
    maxPayloadBytes: definition.maxPayloadBytes,
    degradationCode: definition.degradationCode,
    ...(definition.deterministicSeedDomain === undefined
      ? {}
      : { deterministicSeedDomain: definition.deterministicSeedDomain }),
    applies,
    execute,
    validateDetached,
    ...(admitSuppressed ? { admitSuppressed } : {}),
    admitHost,
  })
}

function stableTopologicalOrder(
  definitions: readonly AnyDefinition[],
  byKey: ReadonlyMap<string, AnyDefinition>,
): readonly AnyDefinition[] {
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const definition of definitions) {
    const key = identityKey(definition.token)
    indegree.set(key, definition.dependencies.length)
    for (const dependency of definition.dependencies) {
      const dependencyKey = identityKey(dependency)
      const entries = dependents.get(dependencyKey) ?? []
      entries.push(key)
      dependents.set(dependencyKey, entries)
    }
  }
  const ready = definitions
    .filter((definition) => definition.dependencies.length === 0)
    .map((definition) => identityKey(definition.token))
    .sort()
  const ordered: AnyDefinition[] = []
  while (ready.length) {
    const key = ready.shift()!
    ordered.push(byKey.get(key)!)
    for (const dependent of (dependents.get(key) ?? []).sort()) {
      const next = indegree.get(dependent)! - 1
      indegree.set(dependent, next)
      if (next === 0) {
        ready.push(dependent)
        ready.sort()
      }
    }
  }
  if (ordered.length !== definitions.length) {
    const cycle = concreteCycle(definitions, byKey)
    throw new ComponentRegistryError(
      'dependency-cycle',
      `component dependency cycle: ${cycle.join(' -> ')}`,
    )
  }
  return Object.freeze(ordered)
}

function concreteCycle(
  definitions: readonly AnyDefinition[],
  byKey: ReadonlyMap<string, AnyDefinition>,
): readonly string[] {
  const state = new Map<string, 'visiting' | 'visited'>()
  const stack: string[] = []
  const visit = (key: string): readonly string[] | undefined => {
    const existing = state.get(key)
    if (existing === 'visited') return undefined
    if (existing === 'visiting') {
      const start = stack.indexOf(key)
      return [...stack.slice(start), key]
    }
    state.set(key, 'visiting')
    stack.push(key)
    const dependencies = [...byKey.get(key)!.dependencies]
      .sort(compareRefs)
    for (const dependency of dependencies) {
      const cycle = visit(identityKey(dependency))
      if (cycle) return cycle
    }
    stack.pop()
    state.set(key, 'visited')
    return undefined
  }
  for (const definition of [...definitions].sort(
    (left, right) => compareRefs(left.token, right.token),
  )) {
    const cycle = visit(identityKey(definition.token))
    if (cycle) return cycle
  }
  return []
}

export interface ComponentResolutionRequest {
  readonly requested: readonly ComponentRef[]
  readonly hostCapabilities?: readonly HostCapability[]
}

export interface DecisionComponentRegistry {
  readonly size: number
  readonly hostInputSize: number
  definitions(): readonly AnyDefinition[]
  definition(ref: ComponentRef): AnyDefinition | undefined
  hostInputDefinitions(): readonly AnyHostInputDefinition[]
  hostInputDefinition(
    ref: ComponentHostInputRef,
  ): AnyHostInputDefinition | undefined
  resolve(request: ComponentResolutionRequest): ResolvedComponentGraph
}

export interface DecisionComponentRegistryOptions {
  readonly hostInputs?: readonly AnyHostInputDefinition[]
}

export function createDecisionComponentRegistry(
  sourceDefinitions: readonly AnyDefinition[],
  options: DecisionComponentRegistryOptions = {},
): DecisionComponentRegistry {
  if (!Array.isArray(sourceDefinitions)) {
    throw new ComponentRegistryError(
      'invalid-definition',
      'component definitions must be an array',
    )
  }
  if (
    !options
    || typeof options !== 'object'
    || !Array.isArray(options.hostInputs ?? [])
  ) {
    throw new ComponentRegistryError(
      'invalid-host-input-definition',
      'host input definitions must be an array',
    )
  }
  const hostInputDefinitions = (options.hostInputs ?? [])
    .map(freezeHostInputDefinition)
  const hostInputByKey = new Map<string, AnyHostInputDefinition>()
  const hostInputVersionById = new Map<string, string>()
  for (const definition of hostInputDefinitions) {
    const key = identityKey(definition.token)
    if (hostInputByKey.has(key)) {
      throw new ComponentRegistryError(
        'duplicate-host-input-identity',
        `duplicate host input identity ${key}`,
      )
    }
    const existingVersion = hostInputVersionById.get(definition.token.id)
    if (
      existingVersion !== undefined
      && existingVersion !== definition.token.version
    ) {
      throw new ComponentRegistryError(
        'conflicting-host-input-version',
        `host input ${definition.token.id} has conflicting versions `
          + `${existingVersion} and ${definition.token.version}`,
      )
    }
    hostInputByKey.set(key, definition)
    hostInputVersionById.set(
      definition.token.id,
      definition.token.version,
    )
  }
  const exposedHostInputDefinitions = Object.freeze(
    [...hostInputDefinitions].sort((left, right) =>
      compareRefs(left.token, right.token)),
  )
  const definitions = sourceDefinitions.map(freezeDefinition)
  const byKey = new Map<string, AnyDefinition>()
  const versionById = new Map<string, string>()
  for (const definition of definitions) {
    const key = identityKey(definition.token)
    if (byKey.has(key)) {
      throw new ComponentRegistryError(
        'duplicate-identity',
        `duplicate component identity ${key}`,
      )
    }
    const existingVersion = versionById.get(definition.token.id)
    if (
      existingVersion !== undefined
      && existingVersion !== definition.token.version
    ) {
      throw new ComponentRegistryError(
        'conflicting-version',
        `component ${definition.token.id} has conflicting versions `
          + `${existingVersion} and ${definition.token.version}`,
      )
    }
    byKey.set(key, definition)
    versionById.set(definition.token.id, definition.token.version)
  }
  for (const definition of definitions) {
    for (const dependency of definition.dependencies) {
      const dependencyKey = identityKey(dependency)
      if (byKey.has(dependencyKey)) continue
      const registeredVersion = versionById.get(dependency.id)
      if (registeredVersion !== undefined) {
        throw new ComponentRegistryError(
          'conflicting-version',
          `${identityKey(definition.token)} requires ${dependencyKey}, `
            + `but ${dependency.id}@${registeredVersion} is registered`,
        )
      }
      throw new ComponentRegistryError(
        'missing-dependency',
        `${identityKey(definition.token)} requires missing ${dependencyKey}`,
      )
    }
    for (const requiredHostInput of definition.requiredHostInputs) {
      const key = identityKey(requiredHostInput)
      const hostInput = hostInputByKey.get(key)
      if (!hostInput) {
        const registeredVersion = hostInputVersionById.get(
          requiredHostInput.id,
        )
        if (registeredVersion !== undefined) {
          throw new ComponentRegistryError(
            'conflicting-host-input-version',
            `${identityKey(definition.token)} requires host input ${key}, `
              + `but ${requiredHostInput.id}@${registeredVersion} `
              + 'is registered',
          )
        }
        throw new ComponentRegistryError(
          'missing-host-input',
          `${identityKey(definition.token)} requires missing host input ${key}`,
        )
      }
      if (hostInput.token.privacy !== requiredHostInput.privacy) {
        throw new ComponentRegistryError(
          'privacy-violation',
          `${identityKey(definition.token)} substitutes privacy for host `
            + `input ${key}`,
        )
      }
      if (
        definition.token.privacy === 'public'
        && hostInput.token.privacy !== 'public'
      ) {
        throw new ComponentRegistryError(
          'privacy-violation',
          `public component ${identityKey(definition.token)} cannot require `
            + `private host input ${key}`,
        )
      }
    }
  }
  for (const definition of definitions) {
    if (definition.token.privacy !== 'public') continue
    for (const dependency of definition.dependencies) {
      const dependencyDefinition = byKey.get(identityKey(dependency))!
      if (dependencyDefinition.token.privacy === 'private') {
        throw new ComponentRegistryError(
          'privacy-violation',
          `public component ${identityKey(definition.token)} cannot depend `
            + `on private component ${identityKey(dependencyDefinition.token)}`,
        )
      }
    }
  }
  const ordered = stableTopologicalOrder(definitions, byKey)
  const exposedDefinitions = Object.freeze([...ordered])

  const registry: DecisionComponentRegistry = {
    size: ordered.length,
    hostInputSize: exposedHostInputDefinitions.length,
    definitions() {
      return exposedDefinitions
    },
    definition(ref) {
      return byKey.get(identityKey(ref))
    },
    hostInputDefinitions() {
      return exposedHostInputDefinitions
    },
    hostInputDefinition(ref) {
      const definition = hostInputByKey.get(identityKey(ref))
      return definition?.token.privacy === ref.privacy
        ? definition
        : undefined
    },
    resolve(request) {
      if (!request || !Array.isArray(request.requested)) {
        throw new ComponentRegistryError(
          'unknown-request',
          'component resolution requires a requested component array',
        )
      }
      const requested = request.requested.map((ref, index) => {
        assertRef(ref, `requested component ${index}`)
        const key = identityKey(ref)
        const definition = byKey.get(key)
        if (!definition) {
          const version = versionById.get(ref.id)
          if (version !== undefined) {
            throw new ComponentRegistryError(
              'conflicting-version',
              `requested ${key}, but ${ref.id}@${version} is registered`,
            )
          }
          throw new ComponentRegistryError(
            'unknown-request',
            `requested component ${key} is not registered`,
          )
        }
        return frozenRef(definition.token)
      })
      const requestedKeys = requested.map(identityKey)
      if (new Set(requestedKeys).size !== requestedKeys.length) {
        throw new ComponentRegistryError(
          'duplicate-request',
          'requested components contain a duplicate identity',
        )
      }

      const configuredKeys = new Set<string>()
      const visit = (key: string): void => {
        if (configuredKeys.has(key)) return
        configuredKeys.add(key)
        for (const dependency of byKey.get(key)!.dependencies) {
          visit(identityKey(dependency))
        }
      }
      requestedKeys.forEach(visit)
      const configuredDefinitions = ordered.filter(
        (definition) => configuredKeys.has(identityKey(definition.token)),
      )
      const capabilitySet = new Set(request.hostCapabilities ?? [])
      const eligibleKeys = new Set<string>()
      const ineligible: IneligibleComponent[] = []
      for (const definition of configuredDefinitions) {
        const missingHostRequirements = definition.hostRequirements
          .filter((requirement) => !capabilitySet.has(requirement))
        const ineligibleDependencies = definition.dependencies
          .filter((dependency) => !eligibleKeys.has(identityKey(dependency)))
          .map(frozenRef)
        if (
          missingHostRequirements.length === 0
          && ineligibleDependencies.length === 0
        ) {
          eligibleKeys.add(identityKey(definition.token))
        } else {
          ineligible.push(Object.freeze({
            component: frozenRef(definition.token),
            missingHostRequirements: Object.freeze(
              [...missingHostRequirements],
            ),
            ineligibleDependencies: Object.freeze(ineligibleDependencies),
          }))
        }
      }
      return Object.freeze({
        requested: Object.freeze(requested),
        configured: Object.freeze(
          configuredDefinitions.map((definition) =>
            frozenRef(definition.token)),
        ),
        eligible: Object.freeze(
          configuredDefinitions
            .filter((definition) =>
              eligibleKeys.has(identityKey(definition.token)))
            .map((definition) => frozenRef(definition.token)),
        ),
        ineligible: Object.freeze(ineligible),
      })
    },
  }
  return Object.freeze(registry)
}

export function componentIdentityKey(ref: ComponentRef): string {
  return identityKey(ref)
}

export function compareComponentRefs(
  left: ComponentRef,
  right: ComponentRef,
): number {
  return compareRefs(left, right)
}
