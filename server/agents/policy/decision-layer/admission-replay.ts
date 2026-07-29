import { isDeepStrictEqual } from 'node:util'
import {
  canonicalizeJson,
  exactOwnDataRecord,
} from '../../components/canonical-json.ts'
import type { DecisionComponentRun } from '../../components/kernel.ts'
import type {
  DecisionLayerRegistry,
} from './registry.ts'
import {
  DECISION_LAYER_RUN_VERSION,
  DECISION_LAYER_SURFACE_VERSION,
  MAX_DECISION_LAYER_REASON_CODES,
  MAX_DECISION_LAYER_STRING_BYTES,
  runDecisionLayers,
} from './runner.ts'
import {
  projectDecisionLayerRun,
} from './projection.ts'
import type {
  DecisionLayerJournalEntry,
  DecisionLayerOperationCounts,
  DecisionLayerRef,
  DecisionLayerRun,
  DecisionLayerTrace,
  DecisionLayerRunInput,
} from './types.ts'

export const MAX_DECISION_LAYER_RUN_JSON_BYTES = 4_194_304

const OPERATION_KEYS: readonly (keyof DecisionLayerOperationCounts)[] = [
  'universalCandidateIdsVisited',
  'legalCandidatesVisited',
  'layersVisited',
  'applicabilityEvaluations',
  'layersExecuted',
  'componentRequirementsIndexed',
  'componentEntriesVisited',
  'componentLookupAttempts',
  'componentPayloadReads',
  'componentAttributionTokensVisited',
  'componentAttributionEntriesVisited',
  'componentAttributionPolicyUseEntriesVisited',
  'surfaceBuildAttempts',
  'surfacePriorSurvivorsVisited',
  'surfaceDraftSurvivorsVisited',
  'surfaceReasonsVisited',
  'surfaceBytesConstructed',
]

function ref(value: unknown): value is DecisionLayerRef {
  const record = exactOwnDataRecord(value, ['id', 'version'])
  return !!record
    && typeof record.id === 'string'
    && typeof record.version === 'string'
    && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(record.id)
    && /^[a-z0-9][a-z0-9._+-]{0,99}$/.test(record.version)
}

function stringArray(
  value: unknown,
  canonical = false,
): value is readonly string[] {
  return Array.isArray(value)
    && value.every((entry) =>
      typeof entry === 'string'
      && (!canonical || (
        Buffer.byteLength(entry, 'utf8') <=
          MAX_DECISION_LAYER_STRING_BYTES
        && /^[A-Z0-9][A-Z0-9_-]*$/.test(entry)
      )))
}

function priorKeys(
  entry: Record<string, unknown>,
): readonly string[] {
  return entry.priorSelectedCandidateId === undefined
    ? [
        'componentLookups',
        'componentReads',
        'layer',
        'priorSurvivorCandidateIds',
      ]
    : [
        'componentLookups',
        'componentReads',
        'layer',
        'priorSelectedCandidateId',
        'priorSurvivorCandidateIds',
      ]
}

function validJournalEntry(
  value: unknown,
  configured: DecisionLayerRef,
): value is DecisionLayerJournalEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (
    !ref(entry.layer)
    || !isDeepStrictEqual(entry.layer, configured)
    || !stringArray(entry.priorSurvivorCandidateIds)
    || new Set(entry.priorSurvivorCandidateIds).size
      !== entry.priorSurvivorCandidateIds.length
    || (
      entry.priorSelectedCandidateId !== undefined
      && typeof entry.priorSelectedCandidateId !== 'string'
    )
    || !Array.isArray(entry.componentLookups)
    || !entry.componentLookups.every(ref)
    || !Array.isArray(entry.componentReads)
    || !entry.componentReads.every(ref)
  ) return false
  const base = priorKeys(entry)
  if (entry.status === 'inapplicable') {
    return !!exactOwnDataRecord(entry, [...base, 'status'])
  }
  if (entry.status === 'degraded') {
    return !!exactOwnDataRecord(entry, [
      ...base,
      'degradationCode',
      'failureCode',
      'status',
    ])
      && typeof entry.degradationCode === 'string'
      && [
        'applicability-failed',
        'execution-failed',
        'layer-degraded',
        'malformed-result',
        'invalid-surface',
        'dependency-unavailable',
      ].includes(String(entry.failureCode))
  }
  if (entry.status !== 'applied') return false
  const selectedKey = entry.selectedCandidateId === undefined
    ? []
    : ['selectedCandidateId']
  return !!exactOwnDataRecord(entry, [
    ...base,
    'attributedComponents',
    'reasonCodes',
    ...selectedKey,
    'status',
    'survivorCandidateIds',
  ])
    && stringArray(entry.survivorCandidateIds)
    && entry.survivorCandidateIds.length > 0
    && new Set(entry.survivorCandidateIds).size
      === entry.survivorCandidateIds.length
    && (
      entry.selectedCandidateId === undefined
      || (
        typeof entry.selectedCandidateId === 'string'
        && entry.survivorCandidateIds.includes(entry.selectedCandidateId)
      )
    )
    && stringArray(entry.reasonCodes, true)
    && entry.reasonCodes.length <= MAX_DECISION_LAYER_REASON_CODES
    && new Set(entry.reasonCodes).size === entry.reasonCodes.length
    && Array.isArray(entry.attributedComponents)
    && entry.attributedComponents.every(ref)
}

/**
 * Strict bounded syntax for detached decision-layer telemetry. Exact semantic
 * authority comes only from replay against an out-of-band resolved order.
 */
export function validateDecisionLayerRun(
  value: unknown,
): value is DecisionLayerTrace {
  const canonical = canonicalizeJson(
    value,
    MAX_DECISION_LAYER_RUN_JSON_BYTES,
  )
  if (!canonical.ok) return false
  const run = exactOwnDataRecord(canonical.payload, [
    'configured',
    'journal',
    'operations',
    'surface',
    'version',
  ])
  if (
    !run
    || run.version !== DECISION_LAYER_RUN_VERSION
    || !Array.isArray(run.configured)
    || !run.configured.every(ref)
    || new Set(run.configured.map(
      (entry) => `${entry.id}@${entry.version}`,
    )).size !== run.configured.length
    || !Array.isArray(run.journal)
    || run.journal.length !== run.configured.length
    || !run.journal.every((entry, index) =>
      validJournalEntry(
        entry,
        (run.configured as unknown as DecisionLayerRef[])[index],
      ))
  ) return false
  const surface = exactOwnDataRecord(
    run.surface,
    run.surface
      && typeof run.surface === 'object'
      && !Array.isArray(run.surface)
      && (run.surface as Record<string, unknown>)
        .selectedCandidateId !== undefined
      ? [
          'reasonCodes',
          'selectedCandidateId',
          'survivorCandidateIds',
          'version',
        ]
      : ['reasonCodes', 'survivorCandidateIds', 'version'],
  )
  const operations = exactOwnDataRecord(run.operations, OPERATION_KEYS)
  return !!surface
    && surface.version === DECISION_LAYER_SURFACE_VERSION
    && stringArray(surface.survivorCandidateIds)
    && surface.survivorCandidateIds.length > 0
    && new Set(surface.survivorCandidateIds).size
      === surface.survivorCandidateIds.length
    && (
      surface.selectedCandidateId === undefined
      || (
        typeof surface.selectedCandidateId === 'string'
        && surface.survivorCandidateIds.includes(
          surface.selectedCandidateId,
        )
      )
    )
    && stringArray(surface.reasonCodes, true)
    && surface.reasonCodes.length <= MAX_DECISION_LAYER_REASON_CODES
    && new Set(surface.reasonCodes).size === surface.reasonCodes.length
    && !!operations
    && OPERATION_KEYS.every((key) =>
      Number.isSafeInteger(operations[key])
      && Number(operations[key]) >= 0)
}

export interface DecisionLayerAdmissionReplayInput
extends Omit<DecisionLayerRunInput, 'order' | 'componentRun'> {
  readonly registry: DecisionLayerRegistry
  readonly configured: readonly DecisionLayerRef[]
  readonly componentRun: DecisionComponentRun
  readonly claimed: DecisionLayerTrace
}

/**
 * Generic exact host replay. The configured order is out-of-band identity;
 * no layer id, role, or payload shape is interpreted here.
 */
export function replayDecisionLayersForAdmission(
  input: DecisionLayerAdmissionReplayInput,
): DecisionLayerRun | undefined {
  try {
    if (!validateDecisionLayerRun(input.claimed)) return undefined
    const order = input.registry.resolve(input.configured)
    if (!isDeepStrictEqual(input.claimed.configured, order.order)) {
      return undefined
    }
    const replay = runDecisionLayers({
      order,
      request: input.request,
      view: input.view,
      analysis: input.analysis,
      candidates: input.candidates,
      universalForced: input.universalForced,
      componentRun: input.componentRun,
    })
    return isDeepStrictEqual(projectDecisionLayerRun(replay), input.claimed)
      ? replay
      : undefined
  } catch {
    return undefined
  }
}
