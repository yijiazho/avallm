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
import { canonicalCode } from './canonical-code.ts'
import {
  admittedHostInputValues,
  prepareHostInputSources,
  resolveHostInput,
} from './host-inputs.ts'
import { admittedPayload } from './run-access.ts'
import {
  canonicalizeJson,
  canonicalJsonEqual,
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
  ComponentRef,
  ComponentToken,
  ComponentVerification,
  DecisionComponentApplicabilityContext,
  DecisionComponentContext,
  DecisionComponentDefinition,
} from './types.ts'
import {
  DECISION_COMPONENT_RUN_VERSION,
  DECISION_COMPONENT_PLAN_VERSION,
} from './run-types.ts'
import type {
  DecisionComponentEntry,
  DecisionComponentEntryBase,
  DecisionComponentPlan,
  DecisionComponentRun,
} from './run-types.ts'

// The run and plan result shapes live in run-types.ts so the policy layers can
// name them without importing this module back; they are re-exported here
// because callers have always read them from `./kernel.ts`.
export {
  DECISION_COMPONENT_RUN_VERSION,
  DECISION_COMPONENT_PLAN_VERSION,
} from './run-types.ts'
export type {
  DecisionComponentEntry,
  DecisionComponentPlan,
  DecisionComponentPolicyUse,
  DecisionComponentRun,
  DecisionComponentStatus,
  PublicDecisionComponentEntry,
  PublicDecisionComponentRun,
} from './run-types.ts'

// The host-input resolution subsystem and the run read/projection helpers were
// split into sibling modules; they are re-exported here because callers have
// always read them from `./kernel.ts`.
export {
  DecisionComponentInvocationError,
} from './host-inputs.ts'
export type {
  DecisionComponentInvocationErrorCode,
} from './host-inputs.ts'
export {
  advanceDecisionComponentRun,
  attributeComponentPolicyUse,
  attributeComponentPolicyUseBatch,
  componentEnvelope,
  componentPayload,
  indexDecisionComponentPayloads,
  publicDecisionComponentRun,
} from './run-access.ts'
export type {
  DecisionComponentPayloadIndex,
  DecisionComponentPolicyAttributionBatch,
  DecisionComponentPolicyAttributionWork,
} from './run-access.ts'

export const MAX_DECISION_COMPONENT_RUN_JSON_BYTES = 2_097_152
export const MAX_DECISION_COMPONENT_PLAN_JSON_BYTES = 65_536

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

/**
 * The verification and promotion verdict for one admitted component: exact only
 * when both the detached and host stages are exact, and promotion-eligible only
 * when both stages allow it and the result is exact. The forward admission
 * engine and the reverse re-admission engine must reach the same verdict from
 * the same two stages, so it is derived here once rather than at each.
 */
function admissionVerdict(
  detached: { verification: ComponentVerification; promotionEligible: boolean },
  host: { verification: ComponentVerification; promotionEligible: boolean },
): { verification: ComponentVerification; promotionEligible: boolean } {
  const verification: ComponentVerification =
    detached.verification === 'exact' && host.verification === 'exact'
      ? 'exact'
      : 'structural'
  return {
    verification,
    promotionEligible:
      detached.promotionEligible
      && host.promotionEligible
      && verification === 'exact',
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
    return admittedPayload(admitted.get(key), token)
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
  if (applicability.privacy === 'public') {
    // The public arm carries no host-input reader: V1 forbids public
    // components from declaring host inputs, so none is built for them.
    return Object.freeze({
      ...applicability,
      dependencies,
    })
  }
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
      const { verification, promotionEligible } =
        admissionVerdict(detached, host)
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
    const { verification, promotionEligible } =
      admissionVerdict(detachedAdmission, hostAdmission)
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
      promotionEligible,
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
