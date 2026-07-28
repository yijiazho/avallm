import {
  isProxy,
} from 'node:util/types'
import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  projectPublicRecord,
} from '../communication/public-record.ts'
import type { ResolvedComposedBrain } from './resolved-brain.ts'
import {
  componentIdentityKey,
} from './registry.ts'
import type {
  ComponentAdmissionResult,
  ComponentDependencyReader,
  ComponentHostInputBinding,
  ComponentHostInputDefinition,
  ComponentHostInputReader,
  ComponentHostInputToken,
  ComponentHostInputValidationResult,
  ComponentPayloadEnvelope,
  ComponentRef,
  ComponentToken,
  ComponentVerification,
  DecisionComponentApplicabilityContext,
  DecisionComponentContext,
  DecisionComponentDefinition,
  DecisionComponentKind,
  DecisionComponentPrivacy,
} from './types.ts'

const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/

export const DECISION_COMPONENT_RUN_VERSION =
  'decision-component-run-v1'
export const MAX_DECISION_COMPONENT_RUN_JSON_BYTES = 2_097_152
export const DECISION_COMPONENT_PLAN_VERSION =
  'decision-component-plan-v1'
export const MAX_DECISION_COMPONENT_PLAN_JSON_BYTES = 65_536

export interface DecisionComponentPlan {
  readonly version: typeof DECISION_COMPONENT_PLAN_VERSION
  readonly configured: readonly ComponentRef[]
}

export type DecisionComponentStatus =
  | 'inapplicable'
  | 'suppressed'
  | 'degraded'
  | 'admitted'

interface DecisionComponentEntryBase {
  readonly component: ComponentRef
  readonly kind: DecisionComponentKind
  readonly privacy: DecisionComponentPrivacy
}

export type DecisionComponentEntry =
  | Readonly<DecisionComponentEntryBase & {
      status: 'inapplicable'
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'suppressed'
      reasonCode: string
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'degraded'
      degradationCode: string
      failureCode:
        | 'construction-ineligible'
        | 'applicability-failed'
        | 'dependency-unavailable'
        | 'host-input-unavailable'
        | 'host-input-invalid'
        | 'execution-failed'
        | 'malformed-result'
        | 'tag-mismatch'
        | 'payload-json-unsafe'
        | 'payload-too-large'
        | 'detached-validation-failed'
        | 'host-admission-failed'
    }>
  | Readonly<DecisionComponentEntryBase & {
      status: 'admitted'
      envelope: ComponentPayloadEnvelope
      verification: ComponentVerification
      promotionEligible: boolean
      payloadBytes: number
    }>

export interface DecisionComponentPolicyUse {
  readonly component: ComponentRef
  readonly used: boolean
  /**
   * Generic policy-stage identifiers in causal application order. The array
   * stays empty until later scorer or decision layers explicitly attribute
   * use, and can retain more than one distinct causal stage.
   */
  readonly stages: readonly string[]
}

export interface DecisionComponentRun {
  readonly version: typeof DECISION_COMPONENT_RUN_VERSION
  readonly configured: readonly ComponentRef[]
  readonly entries: readonly DecisionComponentEntry[]
  readonly policyUse: readonly DecisionComponentPolicyUse[]
}

export type PublicDecisionComponentEntry =
  DecisionComponentEntry

export interface PublicDecisionComponentRun {
  readonly version: typeof DECISION_COMPONENT_RUN_VERSION
  readonly configured: readonly ComponentRef[]
  readonly entries: readonly PublicDecisionComponentEntry[]
  /**
   * Causal policy use is always private. A public component may still feed a
   * private role policy, so even its stage name or used bit cannot be
   * projected into speech or public logs.
   */
  readonly policyUse: readonly DecisionComponentPolicyUse[]
}

type AnyDefinition = DecisionComponentDefinition<any>
type AnyHostInputDefinition = ComponentHostInputDefinition<any>

export interface DecisionComponentInvocation {
  readonly hostInputs?:
    readonly ComponentHostInputBinding<unknown>[]
}

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

const EMPTY_COMPONENT_RUN: DecisionComponentRun = Object.freeze({
  version: DECISION_COMPONENT_RUN_VERSION,
  configured: Object.freeze([]),
  entries: Object.freeze([]),
  policyUse: Object.freeze([]),
})

export function decisionComponentPlan(
  brain: ResolvedComposedBrain,
): DecisionComponentPlan {
  return Object.freeze({
    version: DECISION_COMPONENT_PLAN_VERSION,
    configured: Object.freeze(
      brain.description.components.configured.map(frozenRef),
    ),
  })
}

function frozenRef(ref: ComponentRef): ComponentRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

function entryBase(definition: AnyDefinition): DecisionComponentEntryBase {
  return {
    component: frozenRef(definition.token),
    kind: definition.token.kind,
    privacy: definition.token.privacy,
  }
}

function degradation(
  definition: AnyDefinition,
  failureCode: Extract<
    DecisionComponentEntry,
    { status: 'degraded' }
  >['failureCode'],
  degradationCode = definition.degradationCode,
): DecisionComponentEntry {
  return Object.freeze({
    ...entryBase(definition),
    status: 'degraded',
    degradationCode: canonicalCode(degradationCode)
      ? degradationCode
      : definition.degradationCode,
    failureCode,
  })
}

function canonicalCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value)
}

function exactDataRecord(
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || isProxy(value)
    ) {
      return undefined
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined
    }
    const keys = Reflect.ownKeys(value)
    const sortedExpected = [...expected].sort()
    if (
      !keys.every((key) => typeof key === 'string')
      || keys.length !== expected.length
      || ![...keys].sort().every(
          (key, index) => key === sortedExpected[index],
        )
    ) {
      return undefined
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const record = Object.create(null) as Record<string, unknown>
    for (const key of expected) {
      const descriptor = descriptors[key]
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined
      }
      Object.defineProperty(record, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    return Object.freeze(record)
  } catch {
    return undefined
  }
}

function freezeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  allowUndefined = false,
): unknown {
  if (value === undefined && allowUndefined) {
    return value
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('non-finite number')
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new Error('non-JSON value')
  }
  if (isProxy(value)) {
    throw new Error('proxy value')
  }
  if (ancestors.has(value)) {
    throw new Error('cyclic value')
  }
  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (
    isArray
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new Error('non-plain object')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== 'string')
    || Object.values(descriptors).some(
      (descriptor) =>
        descriptor.get !== undefined || descriptor.set !== undefined,
    )
  ) {
    throw new Error('unsafe property')
  }
  ancestors.add(value)
  try {
    if (isArray) {
      const ownKeys = Reflect.ownKeys(value)
      const indexKeys = Array.from(
        { length: value.length },
        (_, index) => `${index}`,
      )
      if (
        ownKeys.length !== value.length + 1
        || !ownKeys.includes('length')
        || indexKeys.some((key) => !ownKeys.includes(key))
        || indexKeys.some((key) =>
          descriptors[key]?.enumerable !== true
          || !Object.hasOwn(descriptors[key] ?? {}, 'value'))
      ) {
        throw new Error('non-JSON array shape')
      }
      const clone = value.map((entry) =>
        freezeJsonValue(entry, ancestors, allowUndefined))
      return Object.freeze(clone)
    }
    if (Object.values(descriptors).some(
      (descriptor) => descriptor.enumerable !== true,
    )) {
      throw new Error('non-JSON property')
    }
    const clone: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(clone, key, {
        value: freezeJsonValue(
          descriptors[key].value,
          ancestors,
          allowUndefined,
        ),
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    return Object.freeze(clone)
  } finally {
    ancestors.delete(value)
  }
}

function safePayload(
  value: unknown,
  maxBytes: number,
):
  | Readonly<{ ok: true; payload: unknown; bytes: number }>
  | Readonly<{
      ok: false
      failureCode: 'payload-json-unsafe' | 'payload-too-large'
    }> {
  try {
    const payload = freezeJsonValue(value, new Set())
    // Exercise the platform clone boundary on the sanitized value. Running the
    // strict pass first prevents hostile getters from executing during clone.
    structuredClone(payload)
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    if (bytes > maxBytes) {
      return { ok: false, failureCode: 'payload-too-large' }
    }
    return { ok: true, payload, bytes }
  } catch {
    return { ok: false, failureCode: 'payload-json-unsafe' }
  }
}

function sameCanonicalPayload(left: unknown, right: unknown): boolean {
  // safePayload has already rebuilt both values with sorted object keys and
  // strict JSON leaves, so serialized equality is canonical equality here.
  return JSON.stringify(left) === JSON.stringify(right)
}

function arrayDataValues(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || isProxy(value)) return undefined
    const keys = Reflect.ownKeys(value)
    const expected = Array.from(
      { length: value.length },
      (_, index) => `${index}`,
    )
    if (
      keys.length !== expected.length + 1
      || !keys.includes('length')
      || expected.some((key) => !keys.includes(key))
    ) {
      return undefined
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const result: unknown[] = []
    for (const key of expected) {
      const descriptor = descriptors[key]
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined
      }
      result.push(descriptor.value)
    }
    return result
  } catch {
    return undefined
  }
}

function parseHostInputValidation<Value>(
  value: unknown,
): ComponentHostInputValidationResult<Value> | undefined {
  const rejected = exactDataRecord(
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
  const admitted = exactDataRecord(value, ['valid', 'value'])
  if (admitted?.valid !== true) return undefined
  return {
    valid: true,
    value: admitted.value as Value,
  }
}

interface PreparedHostInputs {
  readonly values: ReadonlyMap<string, unknown>
  readonly missing: ReadonlySet<string>
  readonly invalid: ReadonlySet<string>
}

function prepareHostInputs(
  brain: ResolvedComposedBrain,
  invocation: DecisionComponentInvocation | undefined,
): PreparedHostInputs {
  let bindingValues: readonly unknown[] = []
  if (invocation !== undefined) {
    const empty = exactDataRecord(invocation, [])
    const record = empty
      ? undefined
      : exactDataRecord(invocation, ['hostInputs'])
    if (!empty && !record) {
      throw new DecisionComponentInvocationError(
        'malformed-invocation',
        'component invocation must contain only hostInputs',
      )
    }
    if (record && record.hostInputs !== undefined) {
      const entries = arrayDataValues(record.hostInputs)
      if (!entries) {
        throw new DecisionComponentInvocationError(
          'malformed-invocation',
          'component invocation hostInputs must be a plain dense array',
        )
      }
      bindingValues = entries
    }
  }

  const requiredByKey = new Map(
    brain.description.requiredHostInputs.map((input) => [
      componentIdentityKey(input),
      input,
    ]),
  )
  const requiredById = new Map(
    brain.description.requiredHostInputs.map((input) => [
      input.id,
      input,
    ]),
  )
  const definitions = new Map(
    brain.hostInputDefinitions.map((definition) => [
      componentIdentityKey(definition.token),
      definition,
    ]),
  )
  const boundByKey = new Map<string, unknown>()

  for (let index = 0; index < bindingValues.length; index++) {
    const binding = exactDataRecord(
      bindingValues[index],
      ['input', 'value'],
    )
    if (!binding) {
      throw new DecisionComponentInvocationError(
        'malformed-host-input-binding',
        `host input binding ${index} must be a plain tagged data record`,
      )
    }
    const token = exactDataRecord(
      binding.input,
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
        `host input binding ${index} has a malformed token`,
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
          `host input binding ${index} substitutes the version for ${token.id}`,
        )
      }
      throw new DecisionComponentInvocationError(
        'unknown-host-input-binding',
        `host input binding ${index} is not required by the resolved brain`,
      )
    }
    if (required.privacy !== token.privacy) {
      throw new DecisionComponentInvocationError(
        'host-input-tag-substitution',
        `host input binding ${index} substitutes privacy for ${key}`,
      )
    }
    if (boundByKey.has(key)) {
      throw new DecisionComponentInvocationError(
        'duplicate-host-input-binding',
        `host input ${key} is bound more than once`,
      )
    }
    boundByKey.set(key, binding.value)
  }

  const values = new Map<string, unknown>()
  const missing = new Set<string>()
  const invalid = new Set<string>()
  for (const input of brain.description.requiredHostInputs) {
    const key = componentIdentityKey(input)
    if (!boundByKey.has(key)) {
      missing.add(key)
      continue
    }
    const definition = definitions.get(key)
    if (!definition) {
      invalid.add(key)
      continue
    }
    const source = safePayload(
      boundByKey.get(key),
      definition.maxPayloadBytes,
    )
    if (!source.ok) {
      invalid.add(key)
      continue
    }
    let validation: unknown
    try {
      validation = definition.validate(source.payload)
    } catch {
      invalid.add(key)
      continue
    }
    const parsed = parseHostInputValidation(validation)
    if (!parsed?.valid) {
      invalid.add(key)
      continue
    }
    const validated = safePayload(
      parsed.value,
      definition.maxPayloadBytes,
    )
    if (!validated.ok) {
      invalid.add(key)
      continue
    }
    if (!sameCanonicalPayload(source.payload, validated.payload)) {
      invalid.add(key)
      continue
    }
    values.set(key, validated.payload)
  }
  return {
    values,
    missing,
    invalid,
  }
}

function parseAdmission<Payload>(
  value: unknown,
): ComponentAdmissionResult<Payload> | undefined {
  try {
    const rejectedRecord = exactDataRecord(
      value,
      ['admitted', 'degradationCode'],
    )
    if (rejectedRecord?.admitted === false) {
      if (!canonicalCode(rejectedRecord.degradationCode)) {
        return undefined
      }
      return {
        admitted: false,
        degradationCode: rejectedRecord.degradationCode,
      }
    }
    const record = exactDataRecord(value, [
      'admitted',
      'payload',
      'promotionEligible',
      'verification',
    ])
    if (!record) return undefined
    const admitted = record.admitted
    if (
      admitted !== true
    ) {
      return undefined
    }
    const verification = record.verification
    const promotionEligible = record.promotionEligible
    if (
      !['exact', 'structural'].includes(verification as string)
      || typeof promotionEligible !== 'boolean'
    ) {
      return undefined
    }
    return {
      admitted: true,
      payload: record.payload as Payload,
      verification: verification as ComponentVerification,
      promotionEligible,
    }
  } catch {
    return undefined
  }
}

function parseEnvelope(
  value: unknown,
  definition: AnyDefinition,
): Readonly<{ payload: unknown }> | undefined {
  try {
    const envelope = exactDataRecord(
      value,
      ['component', 'kind', 'payload', 'privacy'],
    )
    if (!envelope) return undefined
    const component = exactDataRecord(
      envelope.component,
      ['id', 'version'],
    )
    if (
      !component
      || component.id !== definition.token.id
      || component.version !== definition.token.version
      || envelope.kind !== definition.token.kind
      || envelope.privacy !== definition.token.privacy
    ) {
      return undefined
    }
    return { payload: envelope.payload }
  } catch {
    return undefined
  }
}

function parseExecutionResult(
  value: unknown,
):
  | Readonly<{ status: 'produced'; envelope: unknown }>
  | Readonly<{ status: 'suppressed'; reasonCode: string }>
  | undefined {
  try {
    const suppressed = exactDataRecord(
      value,
      ['reasonCode', 'status'],
    )
    if (
      suppressed?.status === 'suppressed'
      && canonicalCode(suppressed.reasonCode)
    ) {
      return {
        status: 'suppressed',
        reasonCode: suppressed.reasonCode,
      }
    }
    const record = exactDataRecord(value, ['envelope', 'status'])
    if (
      record?.status === 'produced'
    ) {
      return {
        status: 'produced',
        envelope: record.envelope,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function applicabilityKind(
  value: unknown,
):
  | Readonly<{ status: 'applicable' | 'inapplicable' }>
  | Readonly<{ status: 'suppressed'; reasonCode: string }>
  | undefined {
  try {
    if (value === true) return { status: 'applicable' }
    if (value === false) return { status: 'inapplicable' }
    const simple = exactDataRecord(value, ['status'])
    if (
      simple?.status === 'applicable'
      || simple?.status === 'inapplicable'
    ) {
      return { status: simple.status }
    }
    const record = exactDataRecord(value, ['reasonCode', 'status'])
    if (
      record?.status === 'suppressed'
      && canonicalCode(record.reasonCode)
    ) {
      return {
        status: 'suppressed',
        reasonCode: record.reasonCode,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function executionContextFor(
  applicability: DecisionComponentApplicabilityContext,
  definition: AnyDefinition,
  admitted: ReadonlyMap<string, DecisionComponentEntry>,
  definitions: ReadonlyMap<string, AnyDefinition>,
  hostInputValues: ReadonlyMap<string, unknown>,
  hostInputDefinitions: ReadonlyMap<string, AnyHostInputDefinition>,
): DecisionComponentContext {
  const declared = new Set(
    definition.dependencies.map(componentIdentityKey),
  )
  const get = <Payload>(
    token: ComponentToken<Payload>,
  ): Payload | undefined => {
    const key = componentIdentityKey(token)
    if (!declared.has(key)) {
      throw new Error(
        `${componentIdentityKey(definition.token)} requested undeclared ${key}`,
      )
    }
    const dependencyDefinition = definitions.get(key)
    if (
      !dependencyDefinition
      || dependencyDefinition.token.kind !== token.kind
      || dependencyDefinition.token.privacy !== token.privacy
    ) {
      return undefined
    }
    const entry = admitted.get(key)
    return entry?.status === 'admitted'
      ? entry.envelope.payload as Payload
      : undefined
  }
  const dependencies: ComponentDependencyReader = Object.freeze({
    get,
    require<Payload>(token: ComponentToken<Payload>): Payload {
      const payload = get(token)
      if (payload === undefined) {
        throw new Error(
          `required dependency ${componentIdentityKey(token)} unavailable`,
        )
      }
      return payload
    },
  })
  const declaredHostInputs = new Map(
    definition.requiredHostInputs.map((input) => [
      componentIdentityKey(input),
      input,
    ]),
  )
  const getHostInput = <Value>(
    token: ComponentHostInputToken<Value>,
  ): Value | undefined => {
    const key = componentIdentityKey(token)
    const declared = declaredHostInputs.get(key)
    if (!declared) {
      throw new Error(
        `${componentIdentityKey(definition.token)} requested undeclared `
          + `host input ${key}`,
      )
    }
    const hostDefinition = hostInputDefinitions.get(key)
    if (
      declared.privacy !== token.privacy
      || !hostDefinition
      || hostDefinition.token.privacy !== token.privacy
    ) {
      return undefined
    }
    return hostInputValues.get(key) as Value | undefined
  }
  const hostInputs: ComponentHostInputReader = Object.freeze({
    get: getHostInput,
    require<Value>(token: ComponentHostInputToken<Value>): Value {
      const value = getHostInput(token)
      if (value === undefined) {
        throw new Error(
          `required host input ${componentIdentityKey(token)} unavailable`,
        )
      }
      return value
    },
  })
  return Object.freeze({
    ...applicability,
    dependencies,
    hostInputs,
  })
}

function frozenInput<T>(value: T): Readonly<T> {
  // PlayerView deliberately carries some optional properties as undefined
  // before it crosses a JSON boundary. Preserve that engine-native shape while
  // still cloning and freezing it. Component payloads remain strict JSON.
  const frozen = freezeJsonValue(value, new Set(), true) as Readonly<T>
  structuredClone(frozen)
  return frozen
}

/**
 * Execute one construction-resolved graph for a seat-filtered decision.
 *
 * Components cannot see raw Game state, unrelated component outputs, runtime
 * clients, or policy layers. Every failure is represented as deterministic
 * degradation and no rejected payload survives in the result.
 */
export async function runDecisionComponents(
  brain: ResolvedComposedBrain,
  request: DecisionRequest,
  view: PlayerView,
  invocation?: DecisionComponentInvocation,
): Promise<DecisionComponentRun> {
  const preparedHostInputs = prepareHostInputs(brain, invocation)
  if (brain.configuredDefinitions.length === 0) {
    return EMPTY_COMPONENT_RUN
  }
  const hasPrivate = brain.configuredDefinitions.some(
    (definition) => definition.token.privacy === 'private',
  )
  const frozenRequest = hasPrivate ? frozenInput(request) : undefined
  const frozenView = hasPrivate ? frozenInput(view) : undefined
  const publicDecision = frozenInput({ kind: request.kind })
  const publicRecord = frozenInput(projectPublicRecord(view))
  const eligible = new Set(
    brain.description.components.eligible.map(componentIdentityKey),
  )
  const definitions = new Map(
    brain.configuredDefinitions.map(
      (definition) => [
        componentIdentityKey(definition.token),
        definition,
      ],
    ),
  )
  const hostInputDefinitions = new Map(
    brain.hostInputDefinitions.map(
      (definition) => [
        componentIdentityKey(definition.token),
        definition,
      ],
    ),
  )
  const entries: DecisionComponentEntry[] = []
  const admitted = new Map<string, DecisionComponentEntry>()

  for (const definition of brain.configuredDefinitions) {
    const key = componentIdentityKey(definition.token)
    const applicabilityContext: DecisionComponentApplicabilityContext =
      definition.token.privacy === 'public'
        ? Object.freeze({
            privacy: 'public',
            decision: publicDecision,
            publicRecord,
          })
        : Object.freeze({
            privacy: 'private',
            request: frozenRequest!,
            view: frozenView!,
          })
    let applicability
    try {
      applicability = applicabilityKind(
        await definition.applies(applicabilityContext),
      )
    } catch {
      entries.push(degradation(
        definition,
        'applicability-failed',
      ))
      continue
    }
    if (!applicability) {
      entries.push(degradation(
        definition,
        'applicability-failed',
      ))
      continue
    }
    if (applicability.status === 'inapplicable') {
      entries.push(Object.freeze({
        ...entryBase(definition),
        status: 'inapplicable',
      }))
      continue
    }
    if (applicability.status === 'suppressed') {
      entries.push(Object.freeze({
        ...entryBase(definition),
        status: 'suppressed',
        reasonCode: applicability.reasonCode,
      }))
      continue
    }
    if (!eligible.has(key)) {
      entries.push(degradation(
        definition,
        'construction-ineligible',
      ))
      continue
    }
    if (
      definition.dependencies.some(
        (dependency) =>
          admitted.get(componentIdentityKey(dependency))?.status
            !== 'admitted',
      )
    ) {
      entries.push(degradation(
        definition,
        'dependency-unavailable',
      ))
      continue
    }
    if (
      definition.requiredHostInputs.some((input) =>
        preparedHostInputs.missing.has(
          componentIdentityKey(input),
        ))
    ) {
      entries.push(degradation(
        definition,
        'host-input-unavailable',
      ))
      continue
    }
    if (
      definition.requiredHostInputs.some((input) =>
        preparedHostInputs.invalid.has(
          componentIdentityKey(input),
        ))
    ) {
      entries.push(degradation(
        definition,
        'host-input-invalid',
      ))
      continue
    }
    const context = executionContextFor(
      applicabilityContext,
      definition,
      admitted,
      definitions,
      preparedHostInputs.values,
      hostInputDefinitions,
    )
    let result: unknown
    try {
      result = await definition.execute(context)
    } catch {
      entries.push(degradation(
        definition,
        'execution-failed',
      ))
      continue
    }
    const parsedResult = parseExecutionResult(result)
    if (!parsedResult) {
      entries.push(degradation(
        definition,
        'malformed-result',
      ))
      continue
    }
    if (parsedResult.status === 'suppressed') {
      entries.push(Object.freeze({
        ...entryBase(definition),
        status: 'suppressed',
        reasonCode: parsedResult.reasonCode,
      }))
      continue
    }
    const envelope = parseEnvelope(parsedResult.envelope, definition)
    if (!envelope) {
      entries.push(degradation(definition, 'tag-mismatch'))
      continue
    }
    const producedPayload = safePayload(
      envelope.payload,
      definition.maxPayloadBytes,
    )
    if (!producedPayload.ok) {
      entries.push(degradation(
        definition,
        producedPayload.failureCode,
      ))
      continue
    }
    let detached: unknown
    try {
      detached = definition.validateDetached(
        producedPayload.payload,
      )
    } catch {
      entries.push(degradation(
        definition,
        'detached-validation-failed',
      ))
      continue
    }
    const detachedAdmission = parseAdmission(detached)
    if (!detachedAdmission) {
      entries.push(degradation(
        definition,
        'detached-validation-failed',
      ))
      continue
    }
    if (!detachedAdmission.admitted) {
      entries.push(degradation(
        definition,
        'detached-validation-failed',
        detachedAdmission.degradationCode,
      ))
      continue
    }
    const detachedPayload = safePayload(
      detachedAdmission.payload,
      definition.maxPayloadBytes,
    )
    if (!detachedPayload.ok) {
      entries.push(degradation(
        definition,
        detachedPayload.failureCode,
      ))
      continue
    }
    if (
      detachedAdmission.verification === 'exact'
      && !sameCanonicalPayload(
        producedPayload.payload,
        detachedPayload.payload,
      )
    ) {
      entries.push(degradation(
        definition,
        'detached-validation-failed',
      ))
      continue
    }
    let host: unknown
    try {
      host = definition.admitHost({
        payload: detachedPayload.payload,
        host: context,
      })
    } catch {
      entries.push(degradation(
        definition,
        'host-admission-failed',
      ))
      continue
    }
    const hostAdmission = parseAdmission(host)
    if (!hostAdmission) {
      entries.push(degradation(
        definition,
        'host-admission-failed',
      ))
      continue
    }
    if (!hostAdmission.admitted) {
      entries.push(degradation(
        definition,
        'host-admission-failed',
        hostAdmission.degradationCode,
      ))
      continue
    }
    const hostPayload = safePayload(
      hostAdmission.payload,
      definition.maxPayloadBytes,
    )
    if (!hostPayload.ok) {
      entries.push(degradation(
        definition,
        hostPayload.failureCode,
      ))
      continue
    }
    if (
      hostAdmission.verification === 'exact'
      && !sameCanonicalPayload(
        detachedPayload.payload,
        hostPayload.payload,
      )
    ) {
      entries.push(degradation(
        definition,
        'host-admission-failed',
      ))
      continue
    }
    const verification: ComponentVerification =
      detachedAdmission.verification === 'exact'
        && hostAdmission.verification === 'exact'
        ? 'exact'
        : 'structural'
    const entry: DecisionComponentEntry = Object.freeze({
      ...entryBase(definition),
      status: 'admitted',
      envelope: Object.freeze({
        component: frozenRef(definition.token),
        kind: definition.token.kind,
        privacy: definition.token.privacy,
        payload: hostPayload.payload,
      }),
      verification,
      promotionEligible:
        detachedAdmission.promotionEligible
        && hostAdmission.promotionEligible
        && verification === 'exact',
      payloadBytes: hostPayload.bytes,
    })
    entries.push(entry)
    admitted.set(key, entry)
  }

  const configured = Object.freeze(
    brain.description.components.configured.map(frozenRef),
  )
  return Object.freeze({
    version: DECISION_COMPONENT_RUN_VERSION,
    configured,
    entries: Object.freeze(entries),
    policyUse: Object.freeze(configured.map((component) =>
      Object.freeze({
        component: frozenRef(component),
        used: false,
        stages: Object.freeze([]),
      }))),
  })
}

export function componentPayload<Payload>(
  run: DecisionComponentRun,
  token: ComponentToken<Payload>,
): Payload | undefined {
  const entry = run.entries.find(
    (candidate) =>
      componentIdentityKey(candidate.component)
        === componentIdentityKey(token)
      && candidate.kind === token.kind
      && candidate.privacy === token.privacy,
  )
  return entry?.status === 'admitted'
    ? entry.envelope.payload as Payload
    : undefined
}

export function attributeComponentPolicyUse(
  run: DecisionComponentRun,
  token: ComponentToken,
  stage: string,
): DecisionComponentRun {
  if (!canonicalCode(stage)) {
    throw new Error('component policy-use stage must be canonical')
  }
  const key = componentIdentityKey(token)
  const entry = run.entries.find(
    (candidate) =>
      componentIdentityKey(candidate.component) === key
      && candidate.kind === token.kind
      && candidate.privacy === token.privacy,
  )
  if (!entry || entry.status !== 'admitted') {
    throw new Error(
      `cannot attribute policy use to unadmitted component ${key}`,
    )
  }
  return Object.freeze({
    ...run,
    policyUse: Object.freeze(run.policyUse.map((attribution) =>
      componentIdentityKey(attribution.component) === key
        ? Object.freeze({
            component: frozenRef(attribution.component),
            used: true,
            stages: attribution.stages.includes(stage)
              ? attribution.stages
              : Object.freeze([...attribution.stages, stage]),
          })
        : attribution)),
  })
}

/**
 * Projection safe for speech and public logs. Private components are omitted
 * wholesale so role metadata cannot leak through identity, status, or use.
 */
export function publicDecisionComponentRun(
  run: DecisionComponentRun,
): PublicDecisionComponentRun {
  const entries = run.entries.filter(
    (entry): entry is PublicDecisionComponentEntry =>
      entry.privacy === 'public',
  )
  const publicIdentities = new Set(
    entries.map((entry) => componentIdentityKey(entry.component)),
  )
  return Object.freeze({
    version: run.version,
    configured: Object.freeze(run.configured.filter(
      (component) => publicIdentities.has(componentIdentityKey(component)),
    )),
    entries: Object.freeze(entries),
    policyUse: Object.freeze([]),
  })
}

export function componentEnvelope<Payload>(
  token: ComponentToken<Payload>,
  payload: Payload,
): ComponentPayloadEnvelope<Payload> {
  return {
    component: { id: token.id, version: token.version },
    kind: token.kind,
    privacy: token.privacy,
    payload,
  }
}
