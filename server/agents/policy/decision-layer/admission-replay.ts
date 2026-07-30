import { isDeepStrictEqual } from 'node:util'
import {
  denseOwnDataArrayValues,
  exactOwnDataRecord,
  type CanonicalJsonValue,
} from '../../components/canonical-json.ts'
import type { DecisionComponentRun } from '../../components/kernel.ts'
import { componentIdentityKey } from '../../components/registry.ts'
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
  DecisionLayerSurface,
  DecisionLayerTrace,
  DecisionLayerRunInput,
} from './types.ts'
import type {
  AssertNever,
  ConcatKeys,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
} from '../../key-lists.ts'

/*
 * Every key list in this module reaches `exactOwnDataRecord` one hop away, through
 * the local `frozenRecord` wrapper, so a search for direct predicate calls does not
 * find them. The wrapper takes the list as a parameter, which means the binding has
 * to happen at each caller exactly as it would at a direct call site.
 *
 * That predicate measures the list, so both failure directions reject rather than
 * loosen: a forgotten key and a repeated one each make the length comparison
 * disagree, and the trace is refused. A refused replay degrades the decision layer
 * instead of raising anything, which is the quietest way for this to go wrong.
 *
 * `OPERATION_KEYS` had the first of the three checks already, as a
 * `readonly (keyof DecisionLayerOperationCounts)[]` annotation. That rejects a name
 * the counts do not have but says nothing about a counter the list forgot, and
 * because the annotation widens the tuple it also disarms `DuplicateKeys`, which
 * resolves only for an `as const` literal. Adding a counter to a twenty-four field
 * block and not extending this list is the edit it now catches.
 *
 * The underscore-prefixed assertion aliases are exported only so noUnusedLocals
 * accepts them. Nothing imports one: it fails the build if its list drifts from the
 * shape it covers, so being referenced is not what makes it work, and deleting one
 * as dead would remove that check silently.
 */
const OPERATION_KEYS = [
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
] as const satisfies ExactKeyList<DecisionLayerOperationCounts>
export type _OperationKeysSound =
  | AssertNever<MissingKeys<DecisionLayerOperationCounts, typeof OPERATION_KEYS>>
  | AssertNever<DuplicateKeys<typeof OPERATION_KEYS>>

const REF_KEYS = [
  'id',
  'version',
] as const satisfies ExactKeyList<DecisionLayerRef>
export type _RefKeysSound =
  | AssertNever<MissingKeys<DecisionLayerRef, typeof REF_KEYS>>
  | AssertNever<DuplicateKeys<typeof REF_KEYS>>

const TRACE_KEYS = [
  'configured',
  'journal',
  'operations',
  'surface',
  'version',
] as const satisfies ExactKeyList<DecisionLayerTrace>
export type _TraceKeysSound =
  | AssertNever<MissingKeys<DecisionLayerTrace, typeof TRACE_KEYS>>
  | AssertNever<DuplicateKeys<typeof TRACE_KEYS>>

/*
 * The surface carries its brand under a unique symbol key. `ExactKeyList` and
 * `MissingKeys` both intersect with `string`, so the brand sits outside the binding
 * in both directions, which is what the runtime wants: it has no JSON form to check.
 */

const SURFACE_SELECTED_KEYS = [
  'selectedCandidateId',
] as const satisfies ExactKeyList<DecisionLayerSurface>

const SURFACE_KEYS = [
  'reasonCodes',
  'survivorCandidateIds',
  'version',
] as const satisfies ExactKeyList<
  Omit<DecisionLayerSurface, 'selectedCandidateId'>
>
type SurfaceKeys = ConcatKeys<
  typeof SURFACE_KEYS,
  typeof SURFACE_SELECTED_KEYS
>
export type _SurfaceKeysSound =
  | AssertNever<MissingKeys<DecisionLayerSurface, SurfaceKeys>>
  | AssertNever<DuplicateKeys<SurfaceKeys>>

/*
 * The journal is four variants over a shared base, and the reader tries every
 * base-by-suffix combination until one matches. The base contributes one optional
 * key and the applied variant contributes another, so the two are independent and
 * each variant asserts over its own concatenation.
 *
 * The base list binds against the union with its two non-base keys omitted, which
 * works because `keyof` over a union is the intersection of the arms' keys: every
 * variant declares the four base fields plus `status`, so removing `status` and the
 * optional `priorSelectedCandidateId` leaves exactly the base. Naming a
 * variant-specific key in the base list is therefore a type error.
 */

type JournalEntryOf<Status extends DecisionLayerJournalEntry['status']> =
  Extract<DecisionLayerJournalEntry, { status: Status }>

type JournalKeys<Suffix extends readonly PropertyKey[]> = ConcatKeys<
  ConcatKeys<typeof JOURNAL_BASE_KEYS, typeof JOURNAL_PRIOR_SELECTED_KEYS>,
  Suffix
>

const JOURNAL_PRIOR_SELECTED_KEYS = [
  'priorSelectedCandidateId',
] as const satisfies ExactKeyList<DecisionLayerJournalEntry>

const JOURNAL_BASE_KEYS = [
  'componentLookups',
  'componentReads',
  'layer',
  'priorSurvivorCandidateIds',
] as const satisfies ExactKeyList<
  Omit<DecisionLayerJournalEntry, 'priorSelectedCandidateId' | 'status'>
>

const JOURNAL_INAPPLICABLE_KEYS = [
  'status',
] as const satisfies ExactKeyList<JournalEntryOf<'inapplicable'>>
export type _JournalInapplicableKeysSound =
  | AssertNever<
      MissingKeys<
        JournalEntryOf<'inapplicable'>,
        JournalKeys<typeof JOURNAL_INAPPLICABLE_KEYS>
      >
    >
  | AssertNever<DuplicateKeys<JournalKeys<typeof JOURNAL_INAPPLICABLE_KEYS>>>

const JOURNAL_SUPPRESSED_KEYS = [
  'status',
  'suppressionCode',
] as const satisfies ExactKeyList<JournalEntryOf<'suppressed'>>
export type _JournalSuppressedKeysSound =
  | AssertNever<
      MissingKeys<
        JournalEntryOf<'suppressed'>,
        JournalKeys<typeof JOURNAL_SUPPRESSED_KEYS>
      >
    >
  | AssertNever<DuplicateKeys<JournalKeys<typeof JOURNAL_SUPPRESSED_KEYS>>>

const JOURNAL_DEGRADED_KEYS = [
  'degradationCode',
  'failureCode',
  'status',
] as const satisfies ExactKeyList<JournalEntryOf<'degraded'>>
export type _JournalDegradedKeysSound =
  | AssertNever<
      MissingKeys<
        JournalEntryOf<'degraded'>,
        JournalKeys<typeof JOURNAL_DEGRADED_KEYS>
      >
    >
  | AssertNever<DuplicateKeys<JournalKeys<typeof JOURNAL_DEGRADED_KEYS>>>

const JOURNAL_APPLIED_SELECTED_KEYS = [
  'selectedCandidateId',
] as const satisfies ExactKeyList<JournalEntryOf<'applied'>>

const JOURNAL_APPLIED_KEYS = [
  'attributedComponents',
  'reasonCodes',
  'status',
  'survivorCandidateIds',
] as const satisfies ExactKeyList<JournalEntryOf<'applied'>>
type AppliedJournalKeys = ConcatKeys<
  JournalKeys<typeof JOURNAL_APPLIED_KEYS>,
  typeof JOURNAL_APPLIED_SELECTED_KEYS
>
export type _JournalAppliedKeysSound =
  | AssertNever<MissingKeys<JournalEntryOf<'applied'>, AppliedJournalKeys>>
  | AssertNever<DuplicateKeys<AppliedJournalKeys>>

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
  const record = frozenRecord(value, REF_KEYS)
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
    JOURNAL_BASE_KEYS,
    [...JOURNAL_BASE_KEYS, ...JOURNAL_PRIOR_SELECTED_KEYS],
  ] as const
  for (const base of bases) {
    for (const suffix of [
      JOURNAL_INAPPLICABLE_KEYS,
      JOURNAL_SUPPRESSED_KEYS,
      JOURNAL_DEGRADED_KEYS,
      JOURNAL_APPLIED_KEYS,
      [...JOURNAL_APPLIED_KEYS, ...JOURNAL_APPLIED_SELECTED_KEYS],
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
  const run = frozenRecord(value, TRACE_KEYS)
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
    ...SURFACE_KEYS,
    ...SURFACE_SELECTED_KEYS,
  ]) ?? frozenRecord(run.surface, SURFACE_KEYS)
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
