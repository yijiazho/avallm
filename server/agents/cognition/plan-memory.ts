import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { isDecisionKind } from '../../engine/types.ts'
import { hasDistinctSeats } from '../../engine/rules.ts'
import type { DecisionPlan } from '../policy/plan.ts'
import {
  plainDetachedData,
  strictCanonicalArray,
} from '../components/canonical-shape.ts'
import {
  isAppliedDecisionResolution,
  type AppliedDecisionResolution,
} from '../applied-decision.ts'
import { buildCommitments } from './commitments.ts'
import {
  assessLiteralCoherence,
  COHERENCE_MODEL_VERSION,
  coherenceBasisFromView,
  isCoherenceIntent,
  literalCommitmentBasis,
  type CoherenceIntent,
} from './coherence.ts'
import { extractEvidence } from './evidence.ts'
import {
  PLAN_MEMORY_VERSION,
  type AppliedPlanHistoryEntry,
  type PrivatePlanMemory,
  type PublicCommitment,
  type SelectedPlanSummary,
} from './types.ts'

// The plan-memory shapes live in cognition/types.ts, where CognitionState names
// PrivatePlanMemory; keeping them there rather than here is what lets that
// module avoid importing this one back. The recording and validation logic
// below owns them, and they are re-exported so callers still read them from
// `./plan-memory.ts`.
export { PLAN_MEMORY_VERSION } from './types.ts'
export type {
  AppliedPlanHistoryEntry,
  PrivatePlanMemory,
  SelectedPlanSummary,
} from './types.ts'

/** Finite private memory; older superseded entries are discarded FIFO. */
export const PLAN_MEMORY_HISTORY_LIMIT = 128
export const PLAN_MEMORY_SERIALIZED_LIMIT = 4_000_000

function viewCursor(view: Pick<PlayerView, 'events'>): number {
  return view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1)
}

function entryId(
  req: DecisionRequest,
  throughSeq: number,
  ordinal: number,
): string {
  return `applied-plan:${req.seat}:${req.kind}:q${req.round}:p${req.proposalNum}:v${throughSeq}:n${ordinal}`
}

function planSummary(
  selectedDecision: Decision,
  plan: DecisionPlan,
): SelectedPlanSummary {
  return {
    decision: structuredClone(selectedDecision),
    plan: {
      version: plan.version,
      candidateId: plan.candidateId,
      policyId: plan.policyId,
      beliefThroughSeq: plan.beliefThroughSeq,
    },
  }
}

export interface RecordAppliedPlanInput {
  memory?: PrivatePlanMemory
  req: DecisionRequest
  view: PlayerView
  commitments: readonly PublicCommitment[]
  selectedDecision?: Decision
  selectedPlan?: DecisionPlan
  appliedDecision: Decision
  resolution: AppliedDecisionResolution
  intent: CoherenceIntent
}

export function recordAppliedPlan(
  input: RecordAppliedPlanInput,
): PrivatePlanMemory {
  if (input.view.seat !== input.req.seat) {
    throw new Error('cannot record a plan from another seat view')
  }
  // Both fallback-after-illegal-decision and selected-applied carry what the
  // agent chose; only an agent error leaves nothing to have been selected.
  const expectsSelected = input.resolution !== 'fallback-after-agent-error'
  if (expectsSelected !== Boolean(input.selectedDecision)) {
    throw new Error('selected decision does not match applied resolution')
  }
  if (
    input.selectedPlan
    && (
      !input.selectedDecision
      || !isDeepStrictEqual(input.selectedPlan.request, input.req)
      || !isDeepStrictEqual(input.selectedPlan.decision, input.selectedDecision)
    )
  ) {
    throw new Error('selected plan does not match request and selected decision')
  }
  if (input.selectedDecision && !input.selectedPlan) {
    throw new Error('selected decisions require their selected structured plan')
  }
  if (
    input.memory
    && (
      input.memory.version !== PLAN_MEMORY_VERSION
      || input.memory.coherenceVersion !== COHERENCE_MODEL_VERSION
      || input.memory.viewerSeat !== input.req.seat
    )
  ) {
    throw new Error('cannot advance incompatible private plan memory')
  }
  const throughSeq = viewCursor(input.view)
  const ordinal = input.memory?.nextOrdinal ?? 0
  const id = entryId(input.req, throughSeq, ordinal)
  const basis = literalCommitmentBasis(input.commitments, input.req)
  const coherence = assessLiteralCoherence(
    input.req,
    input.appliedDecision,
    input.intent,
    basis,
    input.view.currentTeam,
  )
  const history: AppliedPlanHistoryEntry[] = (input.memory?.history ?? []).map(
    (entry) =>
      entry.status === 'current'
        ? { ...structuredClone(entry), status: 'superseded' as const, supersededBy: id }
        : structuredClone(entry))
  history.push({
    id,
    request: { ...input.req },
    viewThroughSeq: throughSeq,
    ...(input.selectedDecision && input.selectedPlan
      ? { selected: planSummary(input.selectedDecision, input.selectedPlan) }
      : {}),
    appliedDecision: structuredClone(input.appliedDecision),
    resolution: input.resolution,
    coherence,
    status: 'current',
  })
  while (history.length > PLAN_MEMORY_HISTORY_LIMIT) history.shift()
  const recorded: PrivatePlanMemory = {
    version: PLAN_MEMORY_VERSION,
    coherenceVersion: COHERENCE_MODEL_VERSION,
    viewerSeat: input.req.seat,
    nextOrdinal: ordinal + 1,
    history,
  }
  if (!validatePrivatePlanMemory(recorded)) {
    throw new Error('recorded private plan memory exceeds its bounded schema')
  }
  return recorded
}

function validDecision(value: unknown): value is Decision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const decision = value as Record<string, unknown>
  const keys = Object.keys(decision)
  const exact = (allowed: readonly string[]) =>
    keys.every((key) => allowed.includes(key))
  const strings = ['thinking', 'notes']
  if (strings.some((key) =>
    decision[key] !== undefined
    && (
      typeof decision[key] !== 'string'
      || (decision[key] as string).length > 8_000
    ))) return false
  switch (decision.kind) {
    case 'discuss':
      return exact(['kind', 'say', 'thinking', 'notes'])
        && typeof decision.say === 'string'
        && decision.say.length <= 600
    case 'propose':
      return exact(['kind', 'team', 'pitch', 'thinking', 'notes'])
        && strictCanonicalArray(decision.team)
        && decision.team.length >= 1
        && decision.team.length <= 5
        && decision.team.every(
          (seat) =>
            typeof seat === 'number'
            && Number.isInteger(seat)
            && seat >= 0
            && seat <= 9,
        )
        && hasDistinctSeats(decision.team as readonly Seat[])
        && (
          decision.pitch === undefined
          || (typeof decision.pitch === 'string' && decision.pitch.length <= 400)
        )
    case 'finalize':
      return exact(
        decision.stick === true
          ? ['kind', 'stick', 'thinking', 'notes']
          : ['kind', 'stick', 'team', 'reason', 'thinking', 'notes'],
      )
        && (decision.stick === true
        || (
          decision.stick === false
          && strictCanonicalArray(decision.team)
          && decision.team.length >= 1
          && decision.team.length <= 5
          && decision.team.every(
            (seat) =>
              typeof seat === 'number'
              && Number.isInteger(seat)
              && seat >= 0
              && seat <= 9,
          )
          && hasDistinctSeats(decision.team as readonly Seat[])
          && (
            decision.reason === undefined
            || (typeof decision.reason === 'string' && decision.reason.length <= 400)
          )
        ))
    case 'vote':
      return exact(['kind', 'vote', 'thinking', 'notes'])
        && (decision.vote === 'approve' || decision.vote === 'reject')
    case 'quest':
      return exact(['kind', 'card', 'thinking', 'notes'])
        && (decision.card === 'success' || decision.card === 'fail')
    case 'assassinate':
      return exact(['kind', 'target', 'thinking', 'notes'])
        && Number.isInteger(decision.target)
        && Number(decision.target) >= 0
        && Number(decision.target) <= 9
    default:
      return false
  }
}

function validSelectedDecision(value: unknown): value is Decision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return false
  }
  if (encoded.length > 16_384) return false
  const decision = value as Record<string, unknown>
  if (!isDecisionKind(decision.kind)) {
    return false
  }
  const allowed = decision.kind === 'discuss'
    ? ['kind', 'say', 'thinking', 'notes']
    : decision.kind === 'propose'
      ? ['kind', 'team', 'pitch', 'thinking', 'notes']
      : decision.kind === 'finalize'
        ? ['kind', 'stick', 'team', 'reason', 'thinking', 'notes']
        : decision.kind === 'vote'
          ? ['kind', 'vote', 'thinking', 'notes']
          : decision.kind === 'quest'
            ? ['kind', 'card', 'thinking', 'notes']
            : ['kind', 'target', 'thinking', 'notes']
  if (!Object.keys(decision).every((key) => allowed.includes(key))) return false
  // No undefined case: plainDetachedData has already rejected any property
  // present with an undefined value, and Object.values skips absent keys.
  const fieldsValid = Object.values(decision).every((field) => {
    if (typeof field === 'boolean') return true
    if (typeof field === 'number') return Number.isSafeInteger(field)
    if (typeof field === 'string') return field.length <= 10_000
    return strictCanonicalArray(field)
      && field.length <= 10
      && field.every((entry) => Number.isSafeInteger(entry))
  })
  if (!fieldsValid) return false
  try {
    return isDeepStrictEqual(JSON.parse(encoded), value)
  } catch {
    return false
  }
}

function validRequest(value: unknown, viewerSeat: Seat): value is DecisionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const req = value as Record<string, unknown>
  return Object.keys(req).every(
    (key) => ['kind', 'seat', 'round', 'proposalNum'].includes(key),
  )
    && Object.keys(req).length === 4
    && isDecisionKind(req.kind)
    && Number.isSafeInteger(req.seat)
    && Number(req.seat) >= 0
    && Number(req.seat) <= 9
    && req.seat === viewerSeat
    && Number.isSafeInteger(req.round)
    && Number(req.round) >= 1
    && Number(req.round) <= 5
    && Number.isSafeInteger(req.proposalNum)
    && Number(req.proposalNum) >= 1
    && Number(req.proposalNum) <= 5
}

function validCommitmentBasis(
  value: unknown,
  req: DecisionRequest,
): boolean {
  if (
    !strictCanonicalArray(value)
    || value.length > 2
  ) return false
  let previousSeq = -1
  const ids = new Set<string>()
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const basis = entry as Record<string, unknown>
    const payload = basis.payload as Record<string, unknown> | undefined
    if (
      !Object.keys(basis).every((key) =>
        ['id', 'sourceSeq', 'actor', 'kind', 'round', 'proposalNum', 'payload']
          .includes(key))
      || Object.keys(basis).length !== 7
      || typeof basis.id !== 'string'
      || !basis.id.length
      || ids.has(basis.id)
      || !Number.isSafeInteger(basis.sourceSeq)
      || Number(basis.sourceSeq) < previousSeq
      || basis.actor !== req.seat
      || basis.round !== req.round
      || basis.proposalNum !== req.proposalNum
      || !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
    ) {
      return false
    }
    ids.add(basis.id)
    previousSeq = Number(basis.sourceSeq)
    return basis.kind === 'team'
      && Object.keys(payload).length === 3
      && payload.type === 'team'
      && ['proposed', 'revised'].includes(String(payload.action))
      && strictCanonicalArray(payload.team)
      && payload.team.length >= 1
      && payload.team.length <= 5
      && payload.team.every(
        (seat) =>
          typeof seat === 'number'
          && Number.isInteger(seat)
          && seat >= 0
          && seat <= 9,
      )
      && hasDistinctSeats(payload.team as readonly Seat[])
  })
}

function validSelectedPlan(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return Object.keys(plan).length === 4
    && Object.keys(plan).every((key) => [
      'version', 'candidateId', 'policyId', 'beliefThroughSeq',
    ].includes(key))
    && typeof plan.version === 'string'
    && plan.version.length > 0
    && plan.version.length <= 128
    && typeof plan.candidateId === 'string'
    && plan.candidateId.length > 0
    && plan.candidateId.length <= 512
    && typeof plan.policyId === 'string'
    && plan.policyId.length > 0
    && plan.policyId.length <= 128
    && Number.isSafeInteger(plan.beliefThroughSeq)
    && Number(plan.beliefThroughSeq) >= -1
}

function validSelectedSummary(value: unknown): value is SelectedPlanSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  return Object.keys(summary).every((key) => ['decision', 'plan'].includes(key))
    && validSelectedDecision(summary.decision)
    && validSelectedPlan(summary.plan)
}

/**
 * Reads a possibly-present `supersededBy` off untrusted validator input.
 * The `SupersessionState` union hides the field on a `current` entry, but the
 * validators must still reject a persisted `current` record that smuggles a
 * successor, so they inspect the raw shape rather than the narrowed type.
 */
const rawSupersededBy = (entry: AppliedPlanHistoryEntry): unknown =>
  (entry as { supersededBy?: unknown }).supersededBy

function validatePrivatePlanMemoryInner(
  value: unknown,
): value is PrivatePlanMemory {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !plainDetachedData(value)
  ) {
    return false
  }
  let memory: PrivatePlanMemory
  let encoded: string
  try {
    memory = structuredClone(value) as PrivatePlanMemory
    encoded = JSON.stringify(memory)
  } catch {
    return false
  }
  if (
    Object.keys(memory).length !== 5
    || !Object.keys(memory).every((key) => [
      'version', 'coherenceVersion', 'viewerSeat', 'nextOrdinal', 'history',
    ].includes(key))
    ||
    memory.version !== PLAN_MEMORY_VERSION
    || memory.coherenceVersion !== COHERENCE_MODEL_VERSION
    || !Number.isSafeInteger(memory.viewerSeat)
    || memory.viewerSeat < 0
    || memory.viewerSeat > 9
    || !Number.isSafeInteger(memory.nextOrdinal)
    || memory.nextOrdinal < 1
    || !strictCanonicalArray(memory.history)
    || memory.history.length === 0
    || memory.history.length > PLAN_MEMORY_HISTORY_LIMIT
    || Buffer.byteLength(encoded, 'utf8') > PLAN_MEMORY_SERIALIZED_LIMIT
  ) {
    return false
  }
  let current = 0
  let previousCursor = -1
  let previousOrdinal = -1
  for (let index = 0; index < memory.history.length; index++) {
    const entry = memory.history[index]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const match = /:n(\d+)$/.exec(entry.id)
    const ordinal = match ? Number(match[1]) : -1
    const expectedId = entryId(entry.request, entry.viewThroughSeq, ordinal)
    if (
      !validRequest(entry.request, memory.viewerSeat)
      ||
      entry.id !== expectedId
      || ordinal <= previousOrdinal
      || ordinal >= memory.nextOrdinal
      || entry.request.seat !== memory.viewerSeat
      || !Number.isSafeInteger(entry.viewThroughSeq)
      || entry.viewThroughSeq < -1
      || !validDecision(entry.appliedDecision)
      || !isAppliedDecisionResolution(entry.resolution)
      // An agent error must leave the key absent outright: a truthiness test
      // would let a forged `selected: null` through, since plainDetachedData
      // admits null values.
      || (
        entry.resolution === 'fallback-after-agent-error'
          ? Object.hasOwn(entry, 'selected')
          : !validSelectedSummary(entry.selected)
      )
      || entry.coherence.version !== COHERENCE_MODEL_VERSION
      || !isCoherenceIntent(entry.coherence.intent)
      || !validCommitmentBasis(
        entry.coherence.commitmentBasis,
        entry.request,
      )
      || (
        entry.coherence.currentTeam !== undefined
        && (
          !strictCanonicalArray(entry.coherence.currentTeam)
          || entry.coherence.currentTeam.length < 1
          || entry.coherence.currentTeam.length > 5
          || !entry.coherence.currentTeam.every(
            (seat) => Number.isInteger(seat) && seat >= 0 && seat <= 9,
          )
          || !hasDistinctSeats(entry.coherence.currentTeam as readonly Seat[])
        )
      )
      || !isDeepStrictEqual(
        entry.coherence,
        assessLiteralCoherence(
          entry.request,
          entry.appliedDecision,
          entry.coherence.intent,
          entry.coherence.commitmentBasis,
          entry.coherence.currentTeam,
        ),
      )
    ) {
      return false
    }
    if (
      !Object.keys(entry).every((key) => [
        'id', 'request', 'viewThroughSeq', 'selected', 'appliedDecision',
        'resolution', 'coherence', 'status', 'supersededBy',
      ].includes(key))
      || !Object.keys(entry.coherence).every((key) => [
        'version', 'intent', 'classification', 'conflictCodes',
        'commitmentBasis', 'currentTeam',
      ].includes(key))
      || entry.coherence.commitmentBasis.some(
        (basis) => basis.sourceSeq > entry.viewThroughSeq,
      )
    ) {
      return false
    }
    if (entry.viewThroughSeq < previousCursor) return false
    previousCursor = entry.viewThroughSeq
    previousOrdinal = ordinal
    if (entry.status === 'current') {
      current++
      if (index !== memory.history.length - 1 || rawSupersededBy(entry) !== undefined) {
        return false
      }
    } else if (
      entry.status !== 'superseded'
      || entry.supersededBy !== memory.history[index + 1]?.id
    ) {
      return false
    }
  }
  return current === 1 && memory.nextOrdinal === previousOrdinal + 1
}

export function validatePrivatePlanMemory(
  value: unknown,
): value is PrivatePlanMemory {
  try {
    return validatePrivatePlanMemoryInner(value)
  } catch {
    return false
  }
}

export function validateAppliedPlanOutcome(
  value: unknown,
  viewerSeat: Seat,
): value is AppliedPlanHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as AppliedPlanHistoryEntry
  const match = typeof entry.id === 'string'
    ? /:n(\d+)$/.exec(entry.id)
    : null
  if (!match || entry.status !== 'current' || rawSupersededBy(entry) !== undefined) {
    return false
  }
  const ordinal = Number(match[1])
  return validatePrivatePlanMemory({
    version: PLAN_MEMORY_VERSION,
    coherenceVersion: COHERENCE_MODEL_VERSION,
    viewerSeat,
    nextOrdinal: ordinal + 1,
    history: [entry],
  })
}

export function validateAppliedPlanOutcomeHostJoin(
  value: unknown,
  req: DecisionRequest,
  appliedDecision: Decision,
  view: PlayerView,
): value is AppliedPlanHistoryEntry {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (!validateAppliedPlanOutcome(value, view.seat)) return false
    const outcome = value as AppliedPlanHistoryEntry
    const commitments = buildCommitments(extractEvidence(view))
    const expectedBasis = coherenceBasisFromView(view, req, commitments)
    return (
      isDeepStrictEqual(outcome.request, req)
      && outcome.viewThroughSeq === viewCursor(view)
      && isDeepStrictEqual(outcome.appliedDecision, appliedDecision)
      && isDeepStrictEqual(outcome.coherence.commitmentBasis, expectedBasis)
      && isDeepStrictEqual(outcome.coherence.currentTeam, view.currentTeam)
    )
  } catch {
    return false
  }
}
