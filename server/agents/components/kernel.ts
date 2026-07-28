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
    const token = exactOwnDataRecord(
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
    const source = canonicalizeJson(
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
    const validated = canonicalizeJson(
      parsed.value,
      definition.maxPayloadBytes,
    )
    if (!validated.ok) {
      invalid.add(key)
      continue
    }
    if (!canonicalJsonEqual(source.payload, validated.payload)) {
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
 * This is deliberately separate from detached parsing: stdio can prove that
 * an envelope is bounded and internally coherent without claiming provenance,
 * while a host that owns request/view reconstruction can additionally prove
 * every reconstructable entry through its registered definition. Dependencies
 * are exposed only after their own detached/host admission succeeds.
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
    const hostInputValues = new Map<string, unknown>()
    for (const binding of hostInputs) {
      const definition = registry.hostInputDefinition(binding.input)
      const key = componentIdentityKey(binding.input)
      if (!definition || hostInputValues.has(key)) return false
      const source = canonicalizeJson(
        binding.value,
        definition.maxPayloadBytes,
      )
      if (!source.ok) return false
      const parsed = parseHostInputValidation(
        definition.validate(source.payload),
      )
      if (!parsed?.valid) return false
      const validated = canonicalizeJson(
        parsed.value,
        definition.maxPayloadBytes,
      )
      if (
        !validated.ok
        || !canonicalJsonEqual(source.payload, validated.payload)
      ) return false
      hostInputValues.set(key, validated.payload)
    }

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
        if (
          !definition.admitSuppressed
          || !definition.dependencies.every(
            (dependency) =>
              admitted.has(componentIdentityKey(dependency)),
          )
          || !definition.requiredHostInputs.every(
            (root) =>
              hostInputValues.has(componentIdentityKey(root)),
          )
        ) return false
        const context = executionContextFor(
          applicability,
          definition,
          admitted,
          definitions,
          hostInputValues,
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
      const rootsAvailable = definition.requiredHostInputs.every(
        (root) => hostInputValues.has(componentIdentityKey(root)),
      )
      if (!rootsAvailable) {
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
        hostInputValues,
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
