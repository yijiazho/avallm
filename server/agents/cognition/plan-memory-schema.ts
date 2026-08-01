// Untrusted-ingress schema validation for private plan memory. This is the
// admission boundary that decides whether a plan-memory value that arrived from
// `unknown` (persistence, a host join, a cross-language producer) may be trusted
// as a PrivatePlanMemory. Its exact accept/reject behavior is security-relevant:
// a dropped or reordered check widens what is admitted. The recorder that mints
// well-formed memory lives in plan-memory.ts and depends on this module for the
// shared id/cursor helpers and the final validation.

import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { isDecisionKind } from '../../engine/types.ts'
import { hasDistinctSeats } from '../../engine/seatset.ts'
import {
  plainDetachedData,
  strictCanonicalArray,
} from '../canonical/canonical-shape.ts'
import { isAppliedDecisionResolution } from './applied-decision.ts'
import {
  projectLanguageInterpreterInput,
} from '../record/language-contract.ts'
import { publicEvidenceExists } from '../record/evidence-reference.ts'
import { validStrategicIntent } from '../record/strategic-intent-contract.ts'
import { buildCommitments } from './commitments.ts'
import {
  assessLiteralCoherence,
  COHERENCE_MODEL_VERSION,
  coherenceBasisFromView,
  isCoherenceIntent,
  type PlanIntentBasis,
} from './coherence.ts'
import { extractEvidence } from './evidence.ts'
import {
  PLAN_MEMORY_VERSION,
  type AppliedPlanHistoryEntry,
  type PrivatePlanMemory,
  type SelectedPlanSummary,
} from './types.ts'

/** Finite private memory; older superseded entries are discarded FIFO. */
export const PLAN_MEMORY_HISTORY_LIMIT = 128
export const PLAN_MEMORY_SERIALIZED_LIMIT = 4_000_000

/** Maximum visible source sequence in a view; -1 for an empty view. */
export function viewCursor(view: Pick<PlayerView, 'events'>): number {
  return view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1)
}

/** Deterministic identity of one recorded applied plan. */
export function entryId(
  req: DecisionRequest,
  throughSeq: number,
  ordinal: number,
): string {
  return `applied-plan:${req.seat}:${req.kind}:q${req.round}:p${req.proposalNum}:v${throughSeq}:n${ordinal}`
}

/** The ordinal encoded in an entry id, or -1 when the id lacks the `:n<d>` tail. */
function parseOrdinal(id: string): number {
  const match = /:n(\d+)$/.exec(id)
  return match ? Number(match[1]) : -1
}

/**
 * The per-kind allowed-key lists shared by both decision validators. `finalize`
 * carries the full key set; `finalizeStick` is the narrower list validDecision
 * demands when a finalize sticks. validSelectedDecision indexes this by kind and
 * always uses the full `finalize` list, matching each validator's prior policy.
 */
const DECISION_KEYS = {
  discuss: ['kind', 'say', 'thinking', 'notes'],
  propose: ['kind', 'team', 'pitch', 'thinking', 'notes'],
  finalize: ['kind', 'stick', 'team', 'reason', 'thinking', 'notes'],
  finalizeStick: ['kind', 'stick', 'thinking', 'notes'],
  vote: ['kind', 'vote', 'thinking', 'notes'],
  quest: ['kind', 'card', 'thinking', 'notes'],
  assassinate: ['kind', 'target', 'thinking', 'notes'],
} satisfies Record<string, readonly string[]>

const MEMORY_KEYS: readonly string[] = [
  'version', 'coherenceVersion', 'viewerSeat', 'nextOrdinal', 'history',
]
const ENTRY_KEYS: readonly string[] = [
  'id', 'request', 'viewThroughSeq', 'selected', 'appliedDecision',
  'resolution', 'coherence', 'status', 'supersededBy',
]
const COHERENCE_KEYS: readonly string[] = [
  'version', 'intent', 'classification', 'conflictCodes',
  'commitmentBasis', 'planIntentBasis', 'currentTeam',
]

/** A distinct 1..5 seat team of seats in 0..9. */
function validTeam(value: unknown): value is readonly Seat[] {
  return (
    strictCanonicalArray(value)
    && value.length >= 1
    && value.length <= 5
    && value.every(
      (seat) =>
        typeof seat === 'number'
        && Number.isInteger(seat)
        && seat >= 0
        && seat <= 9,
    )
    && hasDistinctSeats(value as readonly Seat[])
  )
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
      return exact(DECISION_KEYS.discuss)
        && typeof decision.say === 'string'
        && decision.say.length <= 600
    case 'propose':
      return exact(DECISION_KEYS.propose)
        && validTeam(decision.team)
        && (
          decision.pitch === undefined
          || (typeof decision.pitch === 'string' && decision.pitch.length <= 400)
        )
    case 'finalize':
      return exact(
        decision.stick === true
          ? DECISION_KEYS.finalizeStick
          : DECISION_KEYS.finalize,
      )
        && (decision.stick === true
        || (
          decision.stick === false
          && validTeam(decision.team)
          && (
            decision.reason === undefined
            || (typeof decision.reason === 'string' && decision.reason.length <= 400)
          )
        ))
    case 'vote':
      return exact(DECISION_KEYS.vote)
        && (decision.vote === 'approve' || decision.vote === 'reject')
    case 'quest':
      return exact(DECISION_KEYS.quest)
        && (decision.card === 'success' || decision.card === 'fail')
    case 'assassinate':
      return exact(DECISION_KEYS.assassinate)
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
  const allowed = DECISION_KEYS[decision.kind]
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
      && validTeam(payload.team)
  })
}

function validPlanIntentBasis(
  value: unknown,
  req: DecisionRequest,
  viewThroughSeq: number,
  currentOrdinal: number,
): value is PlanIntentBasis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const basis = value as Record<string, unknown>
  const sourceOrdinal = typeof basis.id === 'string'
    ? parseOrdinal(basis.id)
    : -1
  return req.kind === 'vote'
    && Object.keys(basis).length === 6
    && Object.keys(basis).every((key) => [
      'id', 'sourceViewThroughSeq', 'round', 'proposalNum', 'objective',
      'horizon',
    ].includes(key))
    && typeof basis.id === 'string'
    && basis.id.length > 0
    && sourceOrdinal >= 0
    && sourceOrdinal < currentOrdinal
    && Number.isSafeInteger(basis.sourceViewThroughSeq)
    && Number(basis.sourceViewThroughSeq) >= -1
    && Number(basis.sourceViewThroughSeq) <= viewThroughSeq
    && basis.id === entryId(
      { ...req, kind: 'discuss' },
      Number(basis.sourceViewThroughSeq),
      sourceOrdinal,
    )
    && basis.round === req.round
    && basis.proposalNum === req.proposalNum
    && (basis.objective === 'SUPPORT_TEAM' || basis.objective === 'OPPOSE_TEAM')
    && basis.horizon === 'CURRENT_PROPOSAL'
}

function validSelectedPlan(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return Object.keys(plan).length >= 4
    && Object.keys(plan).length <= 5
    && Object.keys(plan).every((key) => [
      'version', 'candidateId', 'policyId', 'beliefThroughSeq',
      'strategicIntent',
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
    && (
      plan.strategicIntent === undefined
      || validStrategicIntent(plan.strategicIntent, {
        seatExists: (seat) => seat <= 9,
      })
    )
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

/**
 * Every per-entry field invariant except the cross-entry monotonic and
 * supersession-chain checks. Ordinal is parsed once by the caller and threaded
 * in so `entryId` can reconstruct the expected id.
 */
function validEntry(
  entry: AppliedPlanHistoryEntry,
  memory: PrivatePlanMemory,
  ordinal: number,
): boolean {
  const expectedId = entryId(entry.request, entry.viewThroughSeq, ordinal)
  return !(
    !validRequest(entry.request, memory.viewerSeat)
    || entry.id !== expectedId
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
      entry.coherence.planIntentBasis !== undefined
      && !validPlanIntentBasis(
        entry.coherence.planIntentBasis,
        entry.request,
        entry.viewThroughSeq,
        ordinal,
      )
    )
    || (
      entry.coherence.currentTeam !== undefined
      && !validTeam(entry.coherence.currentTeam)
    )
    || !isDeepStrictEqual(
      entry.coherence,
      assessLiteralCoherence(
        entry.request,
        entry.appliedDecision,
        entry.coherence.intent,
        entry.coherence.commitmentBasis,
        entry.coherence.currentTeam,
        entry.coherence.planIntentBasis,
      ),
    )
    || !Object.keys(entry).every((key) => ENTRY_KEYS.includes(key))
    || !Object.keys(entry.coherence).every((key) => COHERENCE_KEYS.includes(key))
    || entry.coherence.commitmentBasis.some(
      (basis) => basis.sourceSeq > entry.viewThroughSeq,
    )
  )
}

/** Ordinals strictly ascend within `nextOrdinal`; view cursors never regress. */
function validMonotonic(
  entry: AppliedPlanHistoryEntry,
  ordinal: number,
  nextOrdinal: number,
  previousOrdinal: number,
  previousCursor: number,
): boolean {
  return (
    ordinal > previousOrdinal
    && ordinal < nextOrdinal
    && entry.viewThroughSeq >= previousCursor
  )
}

/**
 * The supersession chain: exactly the trailing entry is `current` (with no
 * successor); every earlier entry is `superseded` and names the next entry's id.
 * Reports whether the entry counts as current so the caller can tally.
 */
function validSupersessionChain(
  entry: AppliedPlanHistoryEntry,
  index: number,
  memory: PrivatePlanMemory,
): { ok: boolean; isCurrent: boolean } {
  if (entry.status === 'current') {
    const ok = index === memory.history.length - 1
      && rawSupersededBy(entry) === undefined
    return { ok, isCurrent: true }
  }
  const ok = entry.status === 'superseded'
    && entry.supersededBy === memory.history[index + 1]?.id
  return { ok, isCurrent: false }
}

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
    || !Object.keys(memory).every((key) => MEMORY_KEYS.includes(key))
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
    const ordinal = parseOrdinal(entry.id)
    if (
      !validEntry(entry, memory, ordinal)
      || !validMonotonic(
        entry,
        ordinal,
        memory.nextOrdinal,
        previousOrdinal,
        previousCursor,
      )
    ) {
      return false
    }
    previousCursor = entry.viewThroughSeq
    previousOrdinal = ordinal
    const chain = validSupersessionChain(entry, index, memory)
    if (!chain.ok) return false
    if (chain.isCurrent) current++
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
  const ordinal = typeof entry.id === 'string' ? parseOrdinal(entry.id) : -1
  if (ordinal < 0 || entry.status !== 'current' || rawSupersededBy(entry) !== undefined) {
    return false
  }
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
    const publicInput = projectLanguageInterpreterInput(view)
    const intent = outcome.selected?.plan.strategicIntent
    return (
      isDeepStrictEqual(outcome.request, req)
      && outcome.viewThroughSeq === viewCursor(view)
      && isDeepStrictEqual(outcome.appliedDecision, appliedDecision)
      && isDeepStrictEqual(outcome.coherence.commitmentBasis, expectedBasis)
      && isDeepStrictEqual(outcome.coherence.currentTeam, view.currentTeam)
      && (
        intent === undefined
        || validStrategicIntent(intent, {
          seatExists: (seat) =>
            view.players.some((player) => player.seat === seat),
          evidenceExists: (reference) =>
            publicEvidenceExists(reference, publicInput),
        })
      )
    )
  } catch {
    return false
  }
}
