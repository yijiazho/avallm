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
import {
  canonicalizeJson,
  canonicalJsonEqual,
  denseOwnDataArrayValues,
  exactOwnDataRecord,
  freezeComponentInput,
} from './canonical-json.ts'
import type {
  DecisionComponentRegistry,
} from './registry.ts'
import type {
  ComponentAdmissionResult,
  ComponentDependencyReader,
  ComponentHostInputBinding,
  ComponentHostInputDefinition,
  ComponentHostInputRef,
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

/**
 * In-process-only root supplier. Unlike DecisionComponentInvocation this
 * binding is trusted executable state and must never be serialized into a
 * descriptor, trace, artifact, or external message.
 */
export interface DecisionComponentTrustedHostInputProvider<Value = unknown> {
  readonly input: ComponentHostInputToken<Value>
  readonly provide: () => Value | undefined
}

export interface DecisionComponentTrustedHostInputProviders {
  readonly providers?:
    readonly DecisionComponentTrustedHostInputProvider<unknown>[]
}

export interface DecisionComponentRunHostJoinInput {
  readonly registry: DecisionComponentRegistry
  readonly run: DecisionComponentRun
  readonly request: DecisionRequest
  readonly view: PlayerView
  /**
   * Only independently reconstructed values belong here. Missing roots leave
   * structural entries readable but can never preserve exact verification or
   * promotion eligibility.
   */
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

/** Admit only monotonic causal-use changes to one exact component run. */
export function advanceDecisionComponentRun(
  prior: DecisionComponentRun,
  next: DecisionComponentRun,
): DecisionComponentRun {
  if (
    prior.version !== next.version
    || prior.configured !== next.configured
    || prior.entries !== next.entries
    || prior.policyUse.length !== next.policyUse.length
  ) {
    throw new Error('component run advancement changed resolved graph state')
  }
  for (let index = 0; index < prior.policyUse.length; index++) {
    const before = prior.policyUse[index]
    const after = next.policyUse[index]
    const prefix = before.stages.every(
      (stage, stageIndex) => after.stages[stageIndex] === stage,
    )
    if (
      componentIdentityKey(before.component) !==
        componentIdentityKey(after.component)
      || (before.used && !after.used)
      || after.used !== (after.stages.length > 0)
      || after.stages.length < before.stages.length
      || !prefix
      || new Set(after.stages).size !== after.stages.length
      || after.stages.some((stage) => !canonicalCode(stage))
    ) {
      throw new Error('component run policy use did not advance monotonically')
    }
  }
  return next
}

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

/**
 * Validate the data-only plan shape used by traces and trusted artifact
 * manifests. Registry completeness and dependency order are checked when the
 * plan is joined to a component run; this helper owns the transport bounds and
 * canonical token shape.
 */
export function validateDecisionComponentPlan(
  value: unknown,
): value is DecisionComponentPlan {
  const safe = canonicalizeJson(
    value,
    MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  )
  if (!safe.ok) return false
  const plan = exactOwnDataRecord(safe.payload, ['version', 'configured'])
  if (
    !plan
    || plan.version !== DECISION_COMPONENT_PLAN_VERSION
    || !Array.isArray(plan.configured)
  ) {
    return false
  }
  const keys = new Set<string>()
  for (const candidate of plan.configured) {
    const ref = exactOwnDataRecord(candidate, ['id', 'version'])
    if (
      !ref
      || !canonicalCode(ref.id)
      || !canonicalCode(ref.version)
    ) {
      return false
    }
    const key = `${ref.id}@${ref.version}`
    if (keys.has(key)) return false
    keys.add(key)
  }
  return true
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

function parseHostInputValidation<Value>(
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

interface PreparedHostInputSources {
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

function prepareHostInputSources(
  requiredHostInputs: readonly ComponentHostInputRef[],
  hostInputDefinitions: readonly AnyHostInputDefinition[],
  invocation: DecisionComponentInvocation | undefined,
  trusted: DecisionComponentTrustedHostInputProviders | undefined,
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

function resolveHostInput(
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

function admittedHostInputValues(
  prepared: PreparedHostInputSources,
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>()
  for (const [key, state] of prepared.states) {
    if (state.status === 'admitted') values.set(key, state.value)
  }
  return values
}

function parseAdmission<Payload>(
  value: unknown,
): ComponentAdmissionResult<Payload> | undefined {
  try {
    const rejectedRecord = exactOwnDataRecord(
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
    const record = exactOwnDataRecord(value, [
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
    const envelope = exactOwnDataRecord(
      value,
      ['component', 'kind', 'payload', 'privacy'],
    )
    if (!envelope) return undefined
    const component = exactOwnDataRecord(
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
    const suppressed = exactOwnDataRecord(
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
    const record = exactOwnDataRecord(value, ['envelope', 'status'])
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
    const simple = exactOwnDataRecord(value, ['status'])
    if (
      simple?.status === 'applicable'
      || simple?.status === 'inapplicable'
    ) {
      return { status: simple.status }
    }
    const record = exactOwnDataRecord(value, ['reasonCode', 'status'])
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

/**
 * Re-admit a detached run against canonical host state.
 *
 * This is deliberately separate from detached parsing: external ingress can
 * prove that an envelope is bounded and internally coherent without claiming
 * provenance, while a host that owns request/view reconstruction can
 * additionally prove every reconstructable entry through its registered
 * definition. Dependencies are exposed only after their own detached/host
 * admission succeeds.
 */
export function validateDecisionComponentRunHostJoin(
  input: DecisionComponentRunHostJoinInput,
): boolean {
  try {
    const {
      registry,
      run,
      request,
      view,
      hostInputs = [],
    } = input
    if (
      request.seat !== view.seat
      || run.configured.length !== run.entries.length
    ) return false

    const definitions = new Map(
      registry.definitions().map((definition) => [
        componentIdentityKey(definition.token),
        definition,
      ]),
    )
    const hostInputDefinitions = new Map(
      registry.hostInputDefinitions().map((definition) => [
        componentIdentityKey(definition.token),
        definition,
      ]),
    )
    const requiredHostInputs = new Map<string, ComponentHostInputRef>()
    for (const ref of run.configured) {
      const definition = definitions.get(componentIdentityKey(ref))
      if (!definition) return false
      for (const root of definition.requiredHostInputs) {
        requiredHostInputs.set(componentIdentityKey(root), root)
      }
    }
    const preparedHostInputs = prepareHostInputSources(
      [...requiredHostInputs.values()],
      [...hostInputDefinitions.values()],
      { hostInputs },
      undefined,
    )

    const admitted = new Map<string, DecisionComponentEntry>()
    const publicDecision = frozenInput({ kind: request.kind })
    const publicRecord = frozenInput(projectPublicRecord(view))
    const frozenRequest = frozenInput(request)
    const frozenView = frozenInput(view)
    for (let index = 0; index < run.configured.length; index++) {
      const ref = run.configured[index]
      const entry = run.entries[index]
      const key = componentIdentityKey(ref)
      const definition = definitions.get(key)
      if (
        !definition
        || componentIdentityKey(entry.component) !== key
        || entry.kind !== definition.token.kind
        || entry.privacy !== definition.token.privacy
      ) return false
      const applicability:
      DecisionComponentApplicabilityContext =
        definition.token.privacy === 'public'
          ? Object.freeze({
              privacy: 'public' as const,
              decision: publicDecision,
              publicRecord,
            })
          : Object.freeze({
              privacy: 'private' as const,
              request: frozenRequest,
              view: frozenView,
            })
      const reconstructedApplicability = applicabilityKind(
        definition.applies(applicability),
      )
      if (!reconstructedApplicability) return false
      if (reconstructedApplicability.status === 'inapplicable') {
        if (entry.status !== 'inapplicable') return false
        continue
      }
      if (reconstructedApplicability.status === 'suppressed') {
        if (
          entry.status !== 'suppressed'
          || entry.reasonCode !== reconstructedApplicability.reasonCode
        ) return false
        continue
      }
      if (entry.status === 'inapplicable') return false
      if (entry.status === 'suppressed') {
        const rootStates = definition.requiredHostInputs.map((root) =>
          resolveHostInput(preparedHostInputs, root))
        if (
          !definition.admitSuppressed
          || !definition.dependencies.every(
            (dependency) =>
              admitted.has(componentIdentityKey(dependency)),
          )
          || rootStates.some((root) => root.status !== 'admitted')
        ) return false
        const context = executionContextFor(
          applicability,
          definition,
          admitted,
          definitions,
          admittedHostInputValues(preparedHostInputs),
          hostInputDefinitions,
        )
        if (!definition.admitSuppressed({
          reasonCode: entry.reasonCode,
          host: context,
        })) return false
        continue
      }
      if (entry.status !== 'admitted') continue
      if (
        componentIdentityKey(entry.envelope.component) !== key
        || entry.envelope.kind !== definition.token.kind
        || entry.envelope.privacy !== definition.token.privacy
      ) return false

      const entryPayload = canonicalizeJson(
        entry.envelope.payload,
        definition.maxPayloadBytes,
      )
      if (!entryPayload.ok) return false
      const detached = parseAdmission(
        definition.validateDetached(entryPayload.payload),
      )
      if (!detached?.admitted) return false
      const detachedPayload = canonicalizeJson(
        detached.payload,
        definition.maxPayloadBytes,
      )
      if (
        !detachedPayload.ok
        || !canonicalJsonEqual(
          detachedPayload.payload,
          entryPayload.payload,
        )
      ) return false

      if (!definition.dependencies.every(
        (dependency) =>
          admitted.has(componentIdentityKey(dependency)),
      )) return false
      const rootStates = definition.requiredHostInputs.map((root) =>
        resolveHostInput(preparedHostInputs, root))
      if (rootStates.some((root) => root.status === 'invalid')) return false
      if (rootStates.some((root) => root.status === 'missing')) {
        if (
          entry.verification !== 'structural'
          || entry.promotionEligible
        ) return false
        admitted.set(key, entry)
        continue
      }

      const context = executionContextFor(
        applicability,
        definition,
        admitted,
        definitions,
        admittedHostInputValues(preparedHostInputs),
        hostInputDefinitions,
      )
      const host = parseAdmission(definition.admitHost({
        payload: detachedPayload.payload,
        host: context,
      }))
      if (!host?.admitted) return false
      const hostPayload = canonicalizeJson(
        host.payload,
        definition.maxPayloadBytes,
      )
      if (
        !hostPayload.ok
        || !canonicalJsonEqual(
          hostPayload.payload,
          entryPayload.payload,
        )
      ) return false
      const verification: ComponentVerification =
        detached.verification === 'exact'
        && host.verification === 'exact'
          ? 'exact'
          : 'structural'
      const promotionEligible =
        detached.promotionEligible
        && host.promotionEligible
        && verification === 'exact'
      if (
        entry.verification !== verification
        || entry.promotionEligible !== promotionEligible
      ) return false
      admitted.set(key, entry)
    }
    return true
  } catch {
    return false
  }
}

function frozenInput<T>(value: T): Readonly<T> {
  // PlayerView deliberately carries some optional properties as undefined
  // before it crosses a JSON boundary. Preserve that engine-native shape while
  // still cloning and freezing it. Component payloads remain strict JSON.
  return freezeComponentInput(value)
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
  trusted?: DecisionComponentTrustedHostInputProviders,
): Promise<DecisionComponentRun> {
  const preparedHostInputs = prepareHostInputSources(
    brain.description.requiredHostInputs,
    brain.hostInputDefinitions,
    invocation,
    trusted,
  )
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
        definition.applies(applicabilityContext),
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
    const roots = definition.requiredHostInputs.map((input) =>
      resolveHostInput(preparedHostInputs, input))
    if (roots.some((root) => root.status === 'missing')) {
      entries.push(degradation(
        definition,
        'host-input-unavailable',
      ))
      continue
    }
    if (roots.some((root) => root.status === 'invalid')) {
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
      admittedHostInputValues(preparedHostInputs),
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
    const producedPayload = canonicalizeJson(
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
    const detachedPayload = canonicalizeJson(
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
      && !canonicalJsonEqual(
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
    const hostPayload = canonicalizeJson(
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
      && !canonicalJsonEqual(
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

export interface DecisionComponentPayloadIndex {
  readonly entriesVisited: number
  payload<Payload>(token: ComponentToken<Payload>): Payload | undefined
}

/** Build one invocation-local exact-tag index for repeated policy reads. */
export function indexDecisionComponentPayloads(
  run: DecisionComponentRun,
): DecisionComponentPayloadIndex {
  const entries = new Map<string, DecisionComponentEntry>()
  let entriesVisited = 0
  for (const entry of run.entries) {
    entriesVisited++
    const key = componentIdentityKey(entry.component)
    if (entries.has(key)) {
      throw new Error(`component run repeats entry ${key}`)
    }
    entries.set(key, entry)
  }
  return Object.freeze({
    entriesVisited,
    payload<Payload>(
      token: ComponentToken<Payload>,
    ): Payload | undefined {
      const entry = entries.get(componentIdentityKey(token))
      return entry?.kind === token.kind
        && entry.privacy === token.privacy
        && entry.status === 'admitted'
        ? entry.envelope.payload as Payload
        : undefined
    },
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

export interface DecisionComponentPolicyAttributionWork {
  readonly tokensVisited: number
  readonly entriesVisited: number
  readonly policyUseEntriesVisited: number
}

export interface DecisionComponentPolicyAttributionBatch {
  readonly run: DecisionComponentRun
  readonly work: DecisionComponentPolicyAttributionWork
}

/**
 * Attribute one accepted policy layer in one entry-validation pass and one
 * policy-use projection pass, independent of the number of component tokens.
 */
export function attributeComponentPolicyUseBatch(
  run: DecisionComponentRun,
  tokens: readonly ComponentToken[],
  stage: string,
): DecisionComponentPolicyAttributionBatch {
  if (!canonicalCode(stage)) {
    throw new Error('component policy-use stage must be canonical')
  }
  if (tokens.length === 0) {
    return Object.freeze({
      run,
      work: Object.freeze({
        tokensVisited: 0,
        entriesVisited: 0,
        policyUseEntriesVisited: 0,
      }),
    })
  }
  const requested = new Map<string, ComponentToken>()
  let tokensVisited = 0
  for (const token of tokens) {
    tokensVisited++
    const key = componentIdentityKey(token)
    const prior = requested.get(key)
    if (
      prior
      && (prior.kind !== token.kind || prior.privacy !== token.privacy)
    ) {
      throw new Error(`component policy attribution substitutes tag ${key}`)
    }
    if (!prior) requested.set(key, token)
  }

  const admitted = new Set<string>()
  let entriesVisited = 0
  for (const entry of run.entries) {
    entriesVisited++
    const key = componentIdentityKey(entry.component)
    const token = requested.get(key)
    if (!token) continue
    if (
      entry.kind !== token.kind
      || entry.privacy !== token.privacy
      || entry.status !== 'admitted'
    ) {
      throw new Error(
        `cannot attribute policy use to unadmitted component ${key}`,
      )
    }
    admitted.add(key)
  }
  if (admitted.size !== requested.size) {
    const missing = [...requested.keys()].find((key) => !admitted.has(key))!
    throw new Error(
      `cannot attribute policy use to unadmitted component ${missing}`,
    )
  }

  const projected = new Set<string>()
  let policyUseEntriesVisited = 0
  const policyUse = run.policyUse.map((attribution) => {
    policyUseEntriesVisited++
    const key = componentIdentityKey(attribution.component)
    if (!requested.has(key)) return attribution
    projected.add(key)
    return Object.freeze({
      component: frozenRef(attribution.component),
      used: true,
      stages: attribution.stages.includes(stage)
        ? attribution.stages
        : Object.freeze([...attribution.stages, stage]),
    })
  })
  if (projected.size !== requested.size) {
    throw new Error('component run policy-use projection is incomplete')
  }
  return Object.freeze({
    run: Object.freeze({
      ...run,
      policyUse: Object.freeze(policyUse),
    }),
    work: Object.freeze({
      tokensVisited,
      entriesVisited,
      policyUseEntriesVisited,
    }),
  })
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
