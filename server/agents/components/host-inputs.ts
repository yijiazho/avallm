// The host-input resolution subsystem: the source/state machine that turns
// caller-supplied invocation bindings and trusted in-process providers into
// validated, admitted host-input values for the kernel to read.
//
// It lives beside kernel.ts rather than inside it so the admission engine stays
// focused on component admission. The kernel owns the trusted-provider types
// (they are confined to the composition boundary by architecture fitness), so
// this module accepts the invocation and provider containers by their
// structural shape and never names those confined types.

import { canonicalCode } from './canonical-code.ts'
import { componentIdentityKey } from './registry.ts'
import {
  canonicalizeJson,
  canonicalJsonEqual,
  denseOwnDataArrayValues,
  exactOwnDataRecord,
} from './canonical-json.ts'
import type {
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentHostInputValidationResult,
} from './types.ts'

type AnyHostInputDefinition = ComponentHostInputDefinition<any>

export type DecisionComponentInvocationErrorCode =
  | 'malformed-invocation'
  | 'malformed-host-input-binding'
  | 'duplicate-host-input-binding'
  | 'unknown-host-input-binding'
  | 'host-input-tag-substitution'

export class DecisionComponentInvocationError extends Error {
  readonly code: DecisionComponentInvocationErrorCode

  constructor(
    code: DecisionComponentInvocationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DecisionComponentInvocationError'
    this.code = code
  }
}

/**
 * The invocation and trusted-provider containers, by structural shape only.
 * The kernel passes its confined DecisionComponentInvocation and trusted
 * provider types here; both are assignable to these readers, and the contents
 * are parsed as untyped data below.
 */
interface HostInputBindingContainer {
  readonly hostInputs?: readonly unknown[]
}

interface HostInputProviderContainer {
  readonly providers?: readonly unknown[]
}

export function parseHostInputValidation<Value>(
  value: unknown,
): ComponentHostInputValidationResult<Value> | undefined {
  const rejected = exactOwnDataRecord(
    value,
    ['degradationCode', 'valid'],
  )
  if (rejected?.valid === false) {
    if (!canonicalCode(rejected.degradationCode)) return undefined
    return {
      valid: false,
      degradationCode: rejected.degradationCode,
    }
  }
  const admitted = exactOwnDataRecord(value, ['valid', 'value'])
  if (admitted?.valid !== true) return undefined
  return {
    valid: true,
    value: admitted.value as Value,
  }
}

type HostInputSource =
  | Readonly<{ kind: 'value'; value: unknown }>
  | Readonly<{ kind: 'provider'; provide: () => unknown }>

type HostInputState =
  | Readonly<{ status: 'unresolved'; source?: HostInputSource }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'admitted'; value: unknown }>

export interface PreparedHostInputSources {
  readonly states: Map<string, HostInputState>
  readonly definitions: ReadonlyMap<string, AnyHostInputDefinition>
}

function registerHostInputSource(
  input: unknown,
  source: HostInputSource,
  label: string,
  requiredByKey: ReadonlyMap<string, ComponentHostInputRef>,
  requiredById: ReadonlyMap<string, ComponentHostInputRef>,
  sources: Map<string, HostInputSource>,
): void {
  const token = exactOwnDataRecord(
    input,
    ['id', 'privacy', 'version'],
  )
  if (
    !token
    || typeof token.id !== 'string'
    || typeof token.version !== 'string'
    || !['public', 'private'].includes(token.privacy as string)
  ) {
    throw new DecisionComponentInvocationError(
      'malformed-host-input-binding',
      `${label} has a malformed token`,
    )
  }
  const key = componentIdentityKey({
    id: token.id,
    version: token.version,
  })
  const required = requiredByKey.get(key)
  if (!required) {
    if (requiredById.has(token.id)) {
      throw new DecisionComponentInvocationError(
        'host-input-tag-substitution',
        `${label} substitutes the version for ${token.id}`,
      )
    }
    throw new DecisionComponentInvocationError(
      'unknown-host-input-binding',
      `${label} is not required by the resolved brain`,
    )
  }
  if (required.privacy !== token.privacy) {
    throw new DecisionComponentInvocationError(
      'host-input-tag-substitution',
      `${label} substitutes privacy for ${key}`,
    )
  }
  if (sources.has(key)) {
    throw new DecisionComponentInvocationError(
      'duplicate-host-input-binding',
      `host input ${key} is bound more than once`,
    )
  }
  sources.set(key, source)
}

export function prepareHostInputSources(
  requiredHostInputs: readonly ComponentHostInputRef[],
  hostInputDefinitions: readonly AnyHostInputDefinition[],
  invocation: HostInputBindingContainer | undefined,
  trusted: HostInputProviderContainer | undefined,
): PreparedHostInputSources {
  let bindingValues: readonly unknown[] = []
  if (invocation !== undefined) {
    const empty = exactOwnDataRecord(invocation, [])
    const record = empty
      ? undefined
      : exactOwnDataRecord(invocation, ['hostInputs'])
    if (!empty && !record) {
      throw new DecisionComponentInvocationError(
        'malformed-invocation',
        'component invocation must contain only hostInputs',
      )
    }
    if (record && record.hostInputs !== undefined) {
      const entries = denseOwnDataArrayValues(record.hostInputs)
      if (!entries) {
        throw new DecisionComponentInvocationError(
          'malformed-invocation',
          'component invocation hostInputs must be a plain dense array',
        )
      }
      bindingValues = entries
    }
  }

  let providerValues: readonly unknown[] = []
  if (trusted !== undefined) {
    const empty = exactOwnDataRecord(trusted, [])
    const record = empty
      ? undefined
      : exactOwnDataRecord(trusted, ['providers'])
    if (!empty && !record) {
      throw new DecisionComponentInvocationError(
        'malformed-invocation',
        'trusted host input providers must contain only providers',
      )
    }
    if (record && record.providers !== undefined) {
      const entries = denseOwnDataArrayValues(record.providers)
      if (!entries) {
        throw new DecisionComponentInvocationError(
          'malformed-invocation',
          'trusted host input providers must be a plain dense array',
        )
      }
      providerValues = entries
    }
  }

  const requiredByKey = new Map(
    requiredHostInputs.map((input) => [
      componentIdentityKey(input),
      input,
    ]),
  )
  const requiredById = new Map(
    requiredHostInputs.map((input) => [
      input.id,
      input,
    ]),
  )
  const definitions = new Map(
    hostInputDefinitions.map((definition) => [
      componentIdentityKey(definition.token),
      definition,
    ]),
  )
  const sources = new Map<string, HostInputSource>()

  for (let index = 0; index < bindingValues.length; index++) {
    const binding = exactOwnDataRecord(
      bindingValues[index],
      ['input', 'value'],
    )
    if (!binding) {
      throw new DecisionComponentInvocationError(
        'malformed-host-input-binding',
        `host input binding ${index} must be a plain tagged data record`,
      )
    }
    registerHostInputSource(
      binding.input,
      { kind: 'value', value: binding.value },
      `host input binding ${index}`,
      requiredByKey,
      requiredById,
      sources,
    )
  }

  for (let index = 0; index < providerValues.length; index++) {
    const binding = exactOwnDataRecord(
      providerValues[index],
      ['input', 'provide'],
    )
    if (!binding || typeof binding.provide !== 'function') {
      throw new DecisionComponentInvocationError(
        'malformed-host-input-binding',
        `trusted host input provider ${index} must be a tagged callback`,
      )
    }
    registerHostInputSource(
      binding.input,
      {
        kind: 'provider',
        provide: binding.provide as () => unknown,
      },
      `trusted host input provider ${index}`,
      requiredByKey,
      requiredById,
      sources,
    )
  }

  const states = new Map<string, HostInputState>()
  for (const input of requiredHostInputs) {
    const key = componentIdentityKey(input)
    const source = sources.get(key)
    states.set(
      key,
      source
        ? { status: 'unresolved', source }
        : { status: 'unresolved' },
    )
  }
  return {
    states,
    definitions,
  }
}

export function resolveHostInput(
  prepared: PreparedHostInputSources,
  input: ComponentHostInputRef,
): HostInputState {
  const key = componentIdentityKey(input)
  const prior = prepared.states.get(key)
  if (!prior || prior.status !== 'unresolved') {
    return prior ?? { status: 'invalid' }
  }
  if (!prior.source) {
    const missing: HostInputState = { status: 'missing' }
    prepared.states.set(key, missing)
    return missing
  }

  let value: unknown
  if (prior.source.kind === 'provider') {
    try {
      value = prior.source.provide()
    } catch {
      const invalid: HostInputState = { status: 'invalid' }
      prepared.states.set(key, invalid)
      return invalid
    }
  } else {
    value = prior.source.value
  }
  if (value === undefined) {
    const missing: HostInputState = { status: 'missing' }
    prepared.states.set(key, missing)
    return missing
  }

  const definition = prepared.definitions.get(key)
  if (!definition) {
    const invalid: HostInputState = { status: 'invalid' }
    prepared.states.set(key, invalid)
    return invalid
  }
  const source = canonicalizeJson(value, definition.maxPayloadBytes)
  if (!source.ok) {
    const invalid: HostInputState = { status: 'invalid' }
    prepared.states.set(key, invalid)
    return invalid
  }
  let validation: unknown
  try {
    validation = definition.validate(source.payload)
  } catch {
    const invalid: HostInputState = { status: 'invalid' }
    prepared.states.set(key, invalid)
    return invalid
  }
  const parsed = parseHostInputValidation(validation)
  if (!parsed?.valid) {
    const invalid: HostInputState = { status: 'invalid' }
    prepared.states.set(key, invalid)
    return invalid
  }
  const validated = canonicalizeJson(
    parsed.value,
    definition.maxPayloadBytes,
  )
  if (
    !validated.ok
    || !canonicalJsonEqual(source.payload, validated.payload)
  ) {
    const invalid: HostInputState = { status: 'invalid' }
    prepared.states.set(key, invalid)
    return invalid
  }
  const admitted: HostInputState = {
    status: 'admitted',
    value: validated.payload,
  }
  prepared.states.set(key, admitted)
  return admitted
}

export function admittedHostInputValues(
  prepared: PreparedHostInputSources,
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>()
  for (const [key, state] of prepared.states) {
    if (state.status === 'admitted') values.set(key, state.value)
  }
  return values
}
