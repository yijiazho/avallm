import { isDeepStrictEqual } from 'node:util'
import {
  denseOwnDataArrayValues,
  exactOwnDataRecord,
  type CanonicalJsonValue,
} from '../../components/canonical-json.ts'
import type { DecisionComponentRun } from '../../components/kernel.ts'
import { componentIdentityKey } from '../../components/registry.ts'
import type {
  ComponentRef,
  DecisionComponentDefinition,
} from '../../components/types.ts'
import type { DecisionLayerRegistry } from './registry.ts'
import {
  DECISION_LAYER_POLICY_USE_STAGE,
  DECISION_LAYER_RUN_VERSION,
  DECISION_LAYER_SURFACE_VERSION,
  MAX_DECISION_LAYER_REASON_CODES,
  MAX_DECISION_LAYER_STRING_BYTES,
  runDecisionLayers,
} from './runner.ts'
import { projectLayerRun } from '../layer-registry-common.ts'
import type {
  DecisionLayerJournalEntry,
  DecisionLayerOperationCounts,
  DecisionLayerRef,
  DecisionLayerRun,
  DecisionLayerTrace,
  DecisionLayerRunInput,
} from './types.ts'

const OPERATION_KEYS: readonly (keyof DecisionLayerOperationCounts)[] = [
  'universalCandidateIdsVisited',
  'legalCandidatesVisited',
  'layersVisited',
  'layersSuppressed',
  'applicabilityEvaluations',
  'layersExecuted',
  'componentLookupAttempts',
  'componentPayloadIndexEntriesVisited',
  'componentPayloadReads',
  'componentPayloadsMaterialized',
  'componentDefinitionIndexEntriesVisited',
  'decisionLayerComponentRequirementsIndexed',
  'componentClosureRootsVisited',
  'componentDependencyEdgesVisited',
  'componentClosureComponentsEmitted',
  'componentAttributionUnionTokensVisited',
  'componentAttributionTokensVisited',
  'componentAttributionEntriesVisited',
  'componentAttributionPolicyUseEntriesVisited',
  'surfaceBuildAttempts',
  'surfacePriorSurvivorsVisited',
  'surfaceDraftSurvivorsVisited',
  'surfaceReasonsVisited',
  'surfaceBytesConstructed',
]

function frozenRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    const record = exactOwnDataRecord(value, keys)
    return record && Object.isFrozen(value)
      ? record
      : undefined
  } catch {
    return undefined
  }
}

function frozenArray(
  value: unknown,
  maxLength = 65_536,
): readonly unknown[] | undefined {
  try {
    const values = denseOwnDataArrayValues(value, maxLength)
    return values && Object.isFrozen(value)
      ? values
      : undefined
  } catch {
    return undefined
  }
}

function ref(value: unknown): value is DecisionLayerRef {
  const record = frozenRecord(value, ['id', 'version'])
  return !!record
    && typeof record.id === 'string'
    && typeof record.version === 'string'
    && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(record.id)
    && /^[a-z0-9][a-z0-9._+-]{0,99}$/.test(record.version)
}

function refArray(value: unknown): readonly DecisionLayerRef[] | undefined {
  const values = frozenArray(value)
  return values?.every(ref)
    ? values as readonly DecisionLayerRef[]
    : undefined
}

function stringArray(
  value: unknown,
  canonical = false,
): readonly string[] | undefined {
  const values = frozenArray(value)
  return values?.every((entry) =>
    typeof entry === 'string'
    && (!canonical || (
      Buffer.byteLength(entry, 'utf8') <=
        MAX_DECISION_LAYER_STRING_BYTES
      && /^[A-Z0-9][A-Z0-9_-]*$/.test(entry)
    )))
    ? values as readonly string[]
    : undefined
}

function journalRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const bases = [
    [
      'componentLookups',
      'componentReads',
      'layer',
      'priorSurvivorCandidateIds',
    ],
    [
      'componentLookups',
      'componentReads',
      'layer',
      'priorSelectedCandidateId',
      'priorSurvivorCandidateIds',
    ],
  ] as const
  for (const base of bases) {
    for (const suffix of [
      ['status'],
      ['status', 'suppressionCode'],
      ['degradationCode', 'failureCode', 'status'],
      [
        'attributedComponents',
        'reasonCodes',
        'status',
        'survivorCandidateIds',
      ],
      [
        'attributedComponents',
        'reasonCodes',
        'selectedCandidateId',
        'status',
        'survivorCandidateIds',
      ],
    ]) {
      const record = frozenRecord(value, [...base, ...suffix])
      if (record) return record
    }
  }
  return undefined
}

function validJournalEntry(
  value: unknown,
  configured: DecisionLayerRef,
): value is DecisionLayerJournalEntry {
  const loose = journalRecord(value)
  if (!loose) return false
  const layer = ref(loose.layer) ? loose.layer : undefined
  const priorSurvivors = stringArray(loose.priorSurvivorCandidateIds)
  const lookups = refArray(loose.componentLookups)
  const reads = refArray(loose.componentReads)
  if (
    !layer
    || !isDeepStrictEqual(layer, configured)
    || !priorSurvivors
    || new Set(priorSurvivors).size !== priorSurvivors.length
    || (
      loose.priorSelectedCandidateId !== undefined
      && typeof loose.priorSelectedCandidateId !== 'string'
    )
    || !lookups
    || !reads
  ) return false
  if (loose.status === 'inapplicable') {
    return !Object.hasOwn(loose, 'suppressionCode')
      && !Object.hasOwn(loose, 'degradationCode')
      && !Object.hasOwn(loose, 'attributedComponents')
  }
  if (loose.status === 'suppressed') {
    return [
        'universal-policy-selected',
        'prior-strategic-selection',
      ].includes(String(loose.suppressionCode))
  }
  if (loose.status === 'degraded') {
    return typeof loose.degradationCode === 'string'
      && [
        'applicability-failed',
        'execution-failed',
        'layer-degraded',
        'malformed-result',
        'invalid-surface',
        'dependency-unavailable',
      ].includes(String(loose.failureCode))
  }
  if (loose.status !== 'applied') return false
  const selectedKey = loose.selectedCandidateId === undefined
    ? []
    : ['selectedCandidateId']
  const survivors = stringArray(loose.survivorCandidateIds)
  const reasons = stringArray(loose.reasonCodes, true)
  const attributed = refArray(loose.attributedComponents)
  return (selectedKey.length === 1)
      === Object.hasOwn(loose, 'selectedCandidateId')
    && !!survivors
    && survivors.length > 0
    && new Set(survivors).size === survivors.length
    && (
      loose.selectedCandidateId === undefined
      || (
        typeof loose.selectedCandidateId === 'string'
        && survivors.includes(loose.selectedCandidateId)
      )
    )
    && !!reasons
    && reasons.length <= MAX_DECISION_LAYER_REASON_CODES
    && new Set(reasons).size === reasons.length
    && !!attributed
}

function decodeCanonicalDecisionLayerTrace(
  value: CanonicalJsonValue,
): DecisionLayerTrace | undefined {
  const run = frozenRecord(value, [
    'configured',
    'journal',
    'operations',
    'surface',
    'version',
  ])
  const configured = refArray(run?.configured)
  const journal = frozenArray(run?.journal)
  if (
    !run
    || run.version !== DECISION_LAYER_RUN_VERSION
    || !configured
    || new Set(configured.map(
      (entry) => `${entry.id}@${entry.version}`,
    )).size !== configured.length
    || !journal
    || journal.length !== configured.length
    || !journal.every((entry, index) =>
      validJournalEntry(entry, configured[index]))
  ) return undefined
  const surface = frozenRecord(run.surface, [
    'reasonCodes',
    'selectedCandidateId',
    'survivorCandidateIds',
    'version',
  ]) ?? frozenRecord(run.surface, [
    'reasonCodes',
    'survivorCandidateIds',
    'version',
  ])
  const survivors = stringArray(surface?.survivorCandidateIds)
  const reasons = stringArray(surface?.reasonCodes, true)
  const operations = frozenRecord(run.operations, OPERATION_KEYS)
  return surface
    && surface.version === DECISION_LAYER_SURFACE_VERSION
    && survivors
    && survivors.length > 0
    && new Set(survivors).size === survivors.length
    && (
      surface.selectedCandidateId === undefined
      || (
        typeof surface.selectedCandidateId === 'string'
        && survivors.includes(surface.selectedCandidateId)
      )
    )
    && reasons
    && reasons.length <= MAX_DECISION_LAYER_REASON_CODES
    && new Set(reasons).size === reasons.length
    && operations
    && OPERATION_KEYS.every((key) =>
      Number.isSafeInteger(operations[key])
      && Number(operations[key]) >= 0)
    ? value as unknown as DecisionLayerTrace
    : undefined
}

declare const admittedDecisionLayerTraceBrand: unique symbol

export interface AdmittedDecisionLayerTrace {
  readonly trace: DecisionLayerTrace
  readonly [admittedDecisionLayerTraceBrand]: true
}

export interface DecisionLayerAdmissionReplayInput
extends Omit<DecisionLayerRunInput, 'order' | 'componentRun'> {
  readonly registry: DecisionLayerRegistry
  readonly configured: readonly DecisionLayerRef[]
  /** Final single-owned component run from the containing admitted trace. */
  readonly componentRun: DecisionComponentRun
  readonly claimed: AdmittedDecisionLayerTrace
}

export interface DecisionLayerAdmissionAuthority {
  /**
   * Exact-key/domain decode of a child already proven canonical by the outer
   * trace ingress. This function never canonicalizes or copies the subgraph.
   */
  admitCanonical(
    value: CanonicalJsonValue,
  ): AdmittedDecisionLayerTrace | undefined
  /** Exact replay accepts only a capability issued by this authority. */
  replay(
    input: DecisionLayerAdmissionReplayInput,
  ): DecisionLayerRun | undefined
}

function withoutStrategicAttribution(
  run: DecisionComponentRun,
): DecisionComponentRun {
  return Object.freeze({
    ...run,
    policyUse: Object.freeze(run.policyUse.map((entry) => {
      const stages = Object.freeze(entry.stages.filter(
        (stage) => stage !== DECISION_LAYER_POLICY_USE_STAGE,
      ))
      return Object.freeze({
        component: entry.component,
        used: stages.length > 0,
        stages,
      })
    })),
  })
}

function strategicAttributionKeys(
  run: DecisionComponentRun,
): ReadonlySet<string> {
  return new Set(run.policyUse
    .filter((entry) =>
      entry.stages.includes(DECISION_LAYER_POLICY_USE_STAGE))
    .map((entry) => componentIdentityKey(entry.component)))
}

function journalAttributionKeys(
  trace: DecisionLayerTrace,
): ReadonlySet<string> {
  return new Set(trace.journal.flatMap((entry) =>
    entry.status === 'applied'
      ? entry.attributedComponents.map(componentIdentityKey)
      : []))
}

function validStrategicStageShape(
  run: DecisionComponentRun,
  expected: ReadonlySet<string>,
): boolean {
  return run.policyUse.every((entry) => {
    const key = componentIdentityKey(entry.component)
    const indices = entry.stages.flatMap((stage, index) =>
      stage === DECISION_LAYER_POLICY_USE_STAGE ? [index] : [])
    return expected.has(key)
      ? indices.length === 1 && indices[0] === 0
      : indices.length === 0
  })
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size
    && [...left].every((value) => right.has(value))
}

/**
 * Create one local admission authority. Issued capabilities are intentionally
 * authority-local, so raw detached payloads cannot be cast into exact replay.
 */
export function createDecisionLayerAdmissionAuthority():
DecisionLayerAdmissionAuthority {
  const issued = new WeakSet<AdmittedDecisionLayerTrace>()
  return Object.freeze({
    admitCanonical(value: CanonicalJsonValue) {
      const trace = decodeCanonicalDecisionLayerTrace(value)
      if (!trace) return undefined
      const admitted = Object.freeze({
        trace,
      }) as AdmittedDecisionLayerTrace
      issued.add(admitted)
      return admitted
    },
    replay(input: DecisionLayerAdmissionReplayInput) {
      try {
        if (
          !input.claimed
          || typeof input.claimed !== 'object'
          || !issued.has(input.claimed)
        ) return undefined
        const claimed = input.claimed.trace
        const order = input.registry.resolve(input.configured)
        if (!isDeepStrictEqual(claimed.configured, order.order)) {
          return undefined
        }
        const baseComponentRun = withoutStrategicAttribution(
          input.componentRun,
        )
        const journalStrategic = journalAttributionKeys(claimed)
        if (!validStrategicStageShape(
          input.componentRun,
          journalStrategic,
        )) return undefined
        const replay = runDecisionLayers({
          order,
          request: input.request,
          view: input.view,
          analysis: input.analysis,
          candidates: input.candidates,
          universalForced: input.universalForced,
          componentDefinitions: input.componentDefinitions,
          componentRun: baseComponentRun,
        })
        if (!isDeepStrictEqual(projectLayerRun(replay), claimed)) {
          return undefined
        }
        const claimedStrategic = strategicAttributionKeys(
          input.componentRun,
        )
        const replayStrategic = strategicAttributionKeys(
          replay.componentRun,
        )
        if (
          !sameSet(claimedStrategic, replayStrategic)
          || !sameSet(claimedStrategic, journalStrategic)
          || !isDeepStrictEqual(
            withoutStrategicAttribution(replay.componentRun),
            baseComponentRun,
          )
        ) return undefined
        return replay
      } catch {
        return undefined
      }
    },
  })
}
