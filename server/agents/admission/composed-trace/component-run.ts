// Admission for the component run: provenance, the guards that keep retired flat
// payloads and migrated flat state out of a current trace, the expected-stage
// derivation, and the generic run and host-join validators. This is the
// kernel-facing half of admission. Its retirement guards are the standing record
// of which payload shapes may never come back, and a record nobody can find is a
// record that gets re-litigated.

import type {
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
} from '../../analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
} from '../../analysis/evil-role-utility.ts'
import {
  MORGANA_COUNTERFEIT_DEGRADATION,
} from '../../analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_UTILITY_DEGRADATION,
} from '../../analysis/morgana-role-utility.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
} from '../../analysis/role-objective-types.ts'
import {
  ROLE_UTILITY_DEGRADATION,
} from '../../analysis/role-utility.ts'
import {
  canonicalJsonEqual,
  canonicalizeJson,
} from '../../canonical/canonical-json.ts'
import {
  DECISION_COMPONENT_PLAN_VERSION,
  DECISION_COMPONENT_RUN_VERSION,
  MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
  validateDecisionComponentRunHostJoin,
} from '../../components/kernel.ts'
import type {
  DecisionComponentPlan,
} from '../../components/kernel.ts'
import type {
  ComponentToken,
} from '../../components/types.ts'
import {
  configuredScoreLayerChainForVersion,
} from '../../role-score-layers/configured.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
} from '../../trace.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import {
  reconstructScoreComponentHostInputs,
} from '../component-host-inputs.ts'
import {
  NATIVE_SCORE_COMPONENT_IDS,
  PRODUCTION_COMPONENT_REGISTRY,
  componentKey,
} from './production-registries.ts'
import {
  COMPONENT_FAILURE_CODES,
  exactGenericArray,
  exactGenericRecord,
  nativeScoreSelectionSurvived,
} from './trace-shape.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validDecisionTraceProvenance(trace: DecisionTrace): boolean {
  const marked =
    trace.componentVersions?.decisionComponents
      === DECISION_COMPONENT_RUN_VERSION
  if (trace.version === DECISION_TRACE_VERSION) {
    return (
      trace.componentPlan === undefined
      && trace.components === undefined
      && !marked
    )
  }
  if (trace.version === COMPONENT_DECISION_TRACE_VERSION) {
    return (
      trace.componentPlan !== undefined
      && trace.components !== undefined
      && marked
    )
  }
  return false
}

const MIGRATED_FLAT_DEGRADATIONS = new Set([
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_UTILITY_DEGRADATION,
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
])

/**
 * Retired flat role projections. No trace of any version may carry one.
 *
 * These payloads have no writer. The composed v2 builder never emitted them and
 * the v1 builder shared with the raw-LLM baseline never did either, so only an
 * external or stored trace can present one. Rejecting the keys uniformly at
 * canonical ingress is the treatment MD-003 applied to its own retired flat
 * keys: it replaces per-role payload reconstruction with one rule.
 *
 * `componentVersions` role identities are deliberately NOT rejected here. A v1
 * trace may still name a role objective it produced, and that naming stays
 * diagnostically readable without ever being promotion evidence.
 */
const RETIRED_FLAT_ROLE_PAYLOAD_KEYS = Object.freeze([
  'privateRoleObjective',
  'privateEvilRoleObjective',
  'privateRoleUtility',
  'privateEvilRoleUtility',
  'publicMorganaCounterfeitRead',
  'privateMorganaCounterfeitObjective',
  'privateMorganaRoleUtility',
] as const)

function traceOmitsRetiredFlatRolePayloads(
  trace: DecisionTrace | Record<string, unknown>,
): boolean {
  const record = trace as unknown as Record<string, unknown>
  return RETIRED_FLAT_ROLE_PAYLOAD_KEYS.every(
    (key) => record[key] === undefined,
  )
}

function currentTraceOmitsMigratedFlatState(
  trace: DecisionTrace,
): boolean {
  if (!traceOmitsRetiredFlatRolePayloads(trace)) return false
  if (trace.version === DECISION_TRACE_VERSION) return true
  const versions = trace.componentVersions
  return (
    versions?.roleObjective === undefined
    && versions?.roleUtility === undefined
    && versions?.evilRoleUtility === undefined
    && versions?.morganaCounterfeitPublicRead === undefined
    && versions?.morganaCounterfeitObjective === undefined
    && versions?.configuredMorganaCounterfeitObjective === undefined
    && versions?.morganaRoleUtility === undefined
    && versions?.configuredMorganaRoleUtility === undefined
    && !trace.degradation.some((code) =>
      MIGRATED_FLAT_DEGRADATIONS.has(code))
  )
}

function expectedNativeTraceStages(
  componentId: string,
  trace: DecisionTrace,
): readonly string[] | undefined {
  const strategic = trace.decisionLayerRun?.journal.some(
    (entry) =>
      entry.status === 'applied'
      && entry.attributedComponents.some(
        (component) => component.id === componentId,
      ),
  )
  if (strategic) return ['strategic-decision']
  if (NATIVE_SCORE_COMPONENT_IDS.has(componentId)) {
    try {
      const scorer = trace.componentVersions?.scorer
      if (!scorer) return undefined
      const chain = configuredScoreLayerChainForVersion(scorer)
      const terminal = chain.definitions.at(-1)
      if (!terminal) return undefined
      const terminalRequested = new Map<string, ComponentToken>()
      for (const component of terminal.requiredComponents) {
        terminalRequested.set(componentKey(component), component)
      }
      const chainRequested = new Map<string, ComponentToken>()
      for (const definition of chain.definitions) {
        for (const component of definition.requiredComponents) {
          chainRequested.set(componentKey(component), component)
        }
      }
      const resolvedIds = (
        requested: ReadonlyMap<string, ComponentToken>,
      ): Set<string> => requested.size === 0
        ? new Set<string>()
        : new Set(PRODUCTION_COMPONENT_REGISTRY.resolve({
            requested: [...requested.values()],
          }).configured.map((component) => component.id))
      const terminalIds = resolvedIds(terminalRequested)
      if (terminalIds.has(componentId)) {
        return nativeScoreSelectionSurvived(trace)
          ? ['candidate-score', 'action-selection']
          : ['candidate-score']
      }
      const chainIds = resolvedIds(chainRequested)
      return chainIds.has(componentId)
        ? undefined
        : []
    } catch {
      return undefined
    }
  }
  return undefined
}

export function validGenericComponentRun(
  trace: DecisionTrace,
  hostView?: PlayerView,
): boolean {
  if (
    !validDecisionTraceProvenance(trace)
    || !currentTraceOmitsMigratedFlatState(trace)
  ) return false
  if (trace.version === DECISION_TRACE_VERSION) return true
  const safePlan = canonicalizeJson(
    trace.componentPlan,
    MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  )
  const safeRun = canonicalizeJson(
    trace.components,
    MAX_DECISION_COMPONENT_RUN_JSON_BYTES,
  )
  if (!safePlan.ok || !safeRun.ok) return false
  const planRecord: unknown = safePlan.payload
  const runRecord: unknown = safeRun.payload
  if (
    !exactGenericRecord(planRecord, ['version', 'configured'])
    || planRecord.version !== DECISION_COMPONENT_PLAN_VERSION
    || !exactGenericArray(planRecord.configured)
    || !exactGenericRecord(
      runRecord,
      ['version', 'configured', 'entries', 'policyUse'],
    )
    || runRecord.version !== DECISION_COMPONENT_RUN_VERSION
    || !exactGenericArray(runRecord.configured)
    || !exactGenericArray(runRecord.entries)
    || !exactGenericArray(runRecord.policyUse)
    || planRecord.configured.length !== runRecord.configured.length
  ) return false
  // The strict canonical boundary and exact top-level shape checks above make
  // these the typed structural views consumed by the remaining semantic join.
  const plan = planRecord as unknown as DecisionComponentPlan
  const run =
    runRecord as unknown as NonNullable<DecisionTrace['components']>
  const configuredKeys: string[] = []
  for (let index = 0; index < plan.configured.length; index++) {
    const ref = plan.configured[index]
    const runRef = run.configured[index]
    if (
      !exactGenericRecord(ref, ['id', 'version'])
      || !exactGenericRecord(runRef, ['id', 'version'])
      || typeof ref.id !== 'string'
      || typeof ref.version !== 'string'
      || !isDeepStrictEqual(ref, runRef)
      || !PRODUCTION_COMPONENT_REGISTRY.definition(ref)
    ) return false
    configuredKeys.push(componentKey(ref))
  }
  if (new Set(configuredKeys).size !== configuredKeys.length) return false
  const dependencyKeys = new Set(
    plan.configured.flatMap((ref) =>
      PRODUCTION_COMPONENT_REGISTRY.definition(ref)!.dependencies
        .map(componentKey)),
  )
  const leaves = plan.configured.filter(
    (ref) => !dependencyKeys.has(componentKey(ref)),
  )
  const expectedGraph = PRODUCTION_COMPONENT_REGISTRY.resolve({
    requested: leaves,
  })
  if (!isDeepStrictEqual(expectedGraph.configured, plan.configured)) {
    return false
  }
  if (
    run.entries.length !== run.configured.length
    || run.policyUse.length !== run.configured.length
  ) return false

  const nativeDegradationCodes = new Set(
    PRODUCTION_COMPONENT_REGISTRY.definitions()
      .filter((definition) => definition.source === 'native')
      .map((definition) => definition.degradationCode),
  )
  // Native failures live only on their generic run entry.
  if (
    trace.degradation.some((code) => nativeDegradationCodes.has(code))
  ) return false
  for (let index = 0; index < run.configured.length; index++) {
    const ref = run.configured[index]
    const entry = run.entries[index]
    const use = run.policyUse[index]
    const definition = PRODUCTION_COMPONENT_REGISTRY.definition(ref)!
    if (
      !exactGenericRecord(entry.component, ['id', 'version'])
      || !isDeepStrictEqual(entry.component, ref)
      || entry.kind !== definition.token.kind
      || entry.privacy !== definition.token.privacy
      || !exactGenericRecord(use, ['component', 'used', 'stages'])
      || !exactGenericRecord(use.component, ['id', 'version'])
      || !isDeepStrictEqual(use.component, ref)
    ) return false

    if (entry.status === 'admitted') {
      if (
        !exactGenericRecord(entry, [
          'component', 'kind', 'privacy', 'status', 'envelope',
          'verification', 'promotionEligible', 'payloadBytes',
        ])
        || !exactGenericRecord(entry.envelope, [
          'component', 'kind', 'privacy', 'payload',
        ])
        || !exactGenericRecord(entry.envelope.component, ['id', 'version'])
        || !isDeepStrictEqual(entry.envelope.component, ref)
        || entry.envelope.kind !== definition.token.kind
        || entry.envelope.privacy !== definition.token.privacy
        || !Number.isSafeInteger(entry.payloadBytes)
        || entry.payloadBytes < 0
        || entry.payloadBytes > definition.maxPayloadBytes
      ) return false
      const canonicalPayload = canonicalizeJson(
        entry.envelope.payload,
        definition.maxPayloadBytes,
      )
      if (
        !canonicalPayload.ok
        || entry.payloadBytes !== canonicalPayload.bytes
      ) return false
      let detached: unknown
      try {
        detached = definition.validateDetached(canonicalPayload.payload)
      } catch {
        return false
      }
      if (
        !exactGenericRecord(detached, [
          'admitted', 'payload', 'promotionEligible', 'verification',
        ])
        || detached.admitted !== true
      ) return false
      const canonicalDetached = canonicalizeJson(
        detached.payload,
        definition.maxPayloadBytes,
      )
      if (
        !canonicalDetached.ok
        || !canonicalJsonEqual(
          canonicalDetached.payload,
          canonicalPayload.payload,
        )
      ) return false
      if (
        entry.verification === 'exact'
          ? (
              detached.verification !== 'exact'
              || entry.promotionEligible !== detached.promotionEligible
            )
          : (
              entry.verification !== 'structural'
              || entry.promotionEligible
            )
      ) return false
    } else if (entry.status === 'degraded') {
      if (
        !exactGenericRecord(entry, [
          'component', 'kind', 'privacy', 'status',
          'degradationCode', 'failureCode',
        ])
        || entry.degradationCode !== definition.degradationCode
        || !COMPONENT_FAILURE_CODES.has(entry.failureCode)
      ) return false
    } else if (entry.status === 'inapplicable') {
      if (
        !exactGenericRecord(
          entry,
          ['component', 'kind', 'privacy', 'status'],
        )
      ) return false
    } else if (entry.status === 'suppressed') {
      if (
        !exactGenericRecord(
          entry,
          ['component', 'kind', 'privacy', 'status', 'reasonCode'],
        )
        || typeof entry.reasonCode !== 'string'
      ) return false
    } else {
      return false
    }

    const expectedStages = entry.status === 'admitted'
      ? expectedNativeTraceStages(ref.id, trace)
      : []
    const nativeScoreStagesValid =
      expectedStages !== undefined
      || !NATIVE_SCORE_COMPONENT_IDS.has(ref.id)
      || isDeepStrictEqual(use.stages, [])
      || isDeepStrictEqual(use.stages, ['candidate-score'])
      || isDeepStrictEqual(
        use.stages,
        ['candidate-score', 'action-selection'],
      )
    if (
      typeof use.used !== 'boolean'
      || !exactGenericArray(use.stages)
      || !use.stages.every(
        (stage) =>
          stage === 'candidate-score'
          || stage === 'action-selection'
          || stage === 'strategic-decision',
      )
      || new Set(use.stages).size !== use.stages.length
      || (
        expectedStages !== undefined
        && !isDeepStrictEqual(use.stages, expectedStages)
      )
      || !nativeScoreStagesValid
      || use.used !== (use.stages.length > 0)
    ) return false
  }

  return true
}

export function validGenericComponentRunHostJoin(
  trace: DecisionTrace,
  req: DecisionRequest,
  view: PlayerView,
  deterministicSeed: string,
): boolean {
  if (trace.version === DECISION_TRACE_VERSION) return true
  const plan = trace.componentPlan!
  return validateDecisionComponentRunHostJoin({
    registry: PRODUCTION_COMPONENT_REGISTRY,
    run: trace.components!,
    request: req,
    view,
    hostInputs: reconstructScoreComponentHostInputs({
      trace,
      plan,
      req,
      view,
      deterministicSeed,
      registry: PRODUCTION_COMPONENT_REGISTRY,
    }),
  })
}
