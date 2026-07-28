import { isDeepStrictEqual } from 'node:util'
import { isProxy } from 'node:util/types'
import type { Seat } from '../../engine/types.ts'
import type { PublicRecord } from '../communication/public-record.ts'
import { PROBABILITY_TOLERANCE } from '../belief/types.ts'
import {
  observePublicRecord,
} from './observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import {
  ACTOR_TARGET_TREATMENT_READ_VERSION,
  MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
  type ActorTargetTreatmentFraction,
  type ActorTargetTreatmentRow,
  type PrivateActorTargetTreatmentRead,
} from './actor-target-treatment-types.ts'
import type {
  CanonicalJsonValue,
} from '../components/canonical-json.ts'

const plainRecord = (value: unknown): value is Record<string, unknown> =>
  !!value
  && typeof value === 'object'
  && !Array.isArray(value)
  && !isProxy(value)
  && Object.getPrototypeOf(value) === Object.prototype

function plainDetachedData(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (
    typeof value !== 'object'
    || isProxy(value)
    || seen.has(value)
  ) return false
  seen.add(value)
  const array = Array.isArray(value)
  if (
    array
      ? (
          Object.keys(value).length !== value.length
          || Array.from(
            { length: value.length },
            (_, index) => Object.hasOwn(value, index),
          ).some((present) => !present)
        )
      : Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = descriptors[key]
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !plainDetachedData(descriptor.value, seen)
    ) return false
  }
  return true
}

const denseArray = (value: unknown): value is unknown[] =>
  Array.isArray(value)
  && !isProxy(value)
  && Object.keys(value).length === value.length
  && Array.from(
    { length: value.length },
    (_, index) => Object.hasOwn(value, index),
  ).every(Boolean)

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key))

const probability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1

const close = (left: number, right: number): boolean =>
  Math.abs(left - right) <= PROBABILITY_TOLERANCE

const canonicalTeam = (team: readonly Seat[]): readonly Seat[] =>
  [...team].sort((left, right) => left - right)

function fraction(
  numerator: number,
  denominator: number,
): ActorTargetTreatmentFraction {
  return {
    numerator,
    denominator,
    index: denominator === 0 ? null : numerator / denominator,
  }
}

function matrixIndex(
  playerCount: number,
  actor: Seat,
  target: Seat,
): number {
  return actor * playerCount + target
}

/**
 * Conservatively join an approved proposal to the public quest whose team
 * actually executed. A hammer contributes proposal selection but no invented
 * votes.
 */
function executedProposals(record: PublicRecord) {
  return [...record.quests]
    .filter((quest) => quest.result !== undefined && quest.team !== undefined)
    .sort((left, right) => left.num - right.num)
    .flatMap((quest) => {
      const team = canonicalTeam(quest.team!)
      const proposal = record.proposals
        .filter(
          (candidate) =>
            candidate.round === quest.num
            && (candidate.approved === true || candidate.auto === true)
            && isDeepStrictEqual(canonicalTeam(candidate.team), team),
        )
        .sort(
          (left, right) =>
            left.proposalNum - right.proposalNum
            || left.leader - right.leader,
        )
        .at(-1)
      return proposal ? [proposal] : []
    })
}

export function buildPrivateActorTargetTreatmentRead(
  record: PublicRecord,
  observer: PublicObserverSnapshot,
): PrivateActorTargetTreatmentRead {
  const authoritativeObserver = observePublicRecord(record)
  if (!isDeepStrictEqual(observer, authoritativeObserver)) {
    throw new Error(
      'actor-target treatment read requires canonical public observer',
    )
  }
  const counts = Array.from(
    { length: record.playerCount * record.playerCount },
    () => ({
      proposalNumerator: 0,
      proposalDenominator: 0,
      voteNumerator: 0,
      voteDenominator: 0,
    }),
  )
  for (const proposal of executedProposals(record)) {
    const team = new Set(proposal.team)
    for (let target = 0; target < record.playerCount; target++) {
      const row = counts[matrixIndex(
        record.playerCount,
        proposal.leader,
        target,
      )]
      row.proposalDenominator += 1
      if (team.has(target)) row.proposalNumerator += 1
    }
    for (const vote of [...(proposal.votes ?? [])].sort(
      (left, right) => left.seat - right.seat,
    )) {
      for (const target of [...team].sort((left, right) => left - right)) {
        const row = counts[matrixIndex(
          record.playerCount,
          vote.seat,
          target,
        )]
        row.voteDenominator += 1
        if (vote.vote === 'approve') row.voteNumerator += 1
      }
    }
  }
  const rows: ActorTargetTreatmentRow[] = []
  for (let actor = 0; actor < record.playerCount; actor++) {
    for (let target = 0; target < record.playerCount; target++) {
      const row = counts[matrixIndex(record.playerCount, actor, target)]
      rows.push({
        actor,
        target,
        observationSemantics:
          'public-executed-proposal-counts-no-data-is-null',
        proposalSelection: fraction(
          row.proposalNumerator,
          row.proposalDenominator,
        ),
        voteApproval: fraction(
          row.voteNumerator,
          row.voteDenominator,
        ),
      })
    }
  }
  const result: PrivateActorTargetTreatmentRead = {
    version: ACTOR_TARGET_TREATMENT_READ_VERSION,
    observerModelVersion: observer.version,
    observerFeasibleWorldCount: observer.feasibleWorldCount,
    playerCount: record.playerCount,
    matrixSemantics: 'dense-canonical-actor-target',
    rows,
  }
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8')
      > MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES
  ) {
    throw new Error('actor-target treatment read exceeds payload bound')
  }
  return result
}

function validFraction(
  value: unknown,
): value is ActorTargetTreatmentFraction {
  if (
    !plainRecord(value)
    || !exactKeys(value, ['numerator', 'denominator', 'index'])
    || !Number.isSafeInteger(value.numerator)
    || !Number.isSafeInteger(value.denominator)
    || (value.numerator as number) < 0
    || (value.denominator as number) < (value.numerator as number)
    || (value.denominator as number) > 5
  ) return false
  return value.denominator === 0
    ? value.numerator === 0 && value.index === null
    : probability(value.index)
      && close(
        value.index,
        (value.numerator as number) / (value.denominator as number),
      )
}

function validatePrivateActorTargetTreatmentShape(
  value: unknown,
  detached: boolean,
): value is PrivateActorTargetTreatmentRead {
  try {
    if (
      (detached && !plainDetachedData(value))
      || !plainRecord(value)
      || !exactKeys(value, [
        'version',
        'observerModelVersion',
        'observerFeasibleWorldCount',
        'playerCount',
        'matrixSemantics',
        'rows',
      ])
      || value.version !== ACTOR_TARGET_TREATMENT_READ_VERSION
      || value.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
      || !Number.isSafeInteger(value.observerFeasibleWorldCount)
      || (value.observerFeasibleWorldCount as number) <= 0
      || !Number.isSafeInteger(value.playerCount)
      || (value.playerCount as number) < 5
      || (value.playerCount as number) > 10
      || value.matrixSemantics !== 'dense-canonical-actor-target'
      || !denseArray(value.rows)
      || value.rows.length !== (value.playerCount as number) ** 2
      || (
        detached
        && Buffer.byteLength(JSON.stringify(value), 'utf8')
          > MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES
      )
    ) return false
    const playerCount = value.playerCount as number
    return value.rows.every((raw, index) =>
      plainRecord(raw)
      && exactKeys(raw, [
        'actor',
        'target',
        'observationSemantics',
        'proposalSelection',
        'voteApproval',
      ])
      && raw.actor === Math.floor(index / playerCount)
      && raw.target === index % playerCount
      && raw.observationSemantics
        === 'public-executed-proposal-counts-no-data-is-null'
      && validFraction(raw.proposalSelection)
      && validFraction(raw.voteApproval))
  } catch {
    return false
  }
}

export function validatePrivateActorTargetTreatmentRead(
  value: unknown,
): value is PrivateActorTargetTreatmentRead {
  return validatePrivateActorTargetTreatmentShape(value, true)
}

/**
 * Decode a value already canonicalized and byte-bounded by the component
 * kernel. Only the component's semantic schema is checked here.
 */
export function decodeCanonicalPrivateActorTargetTreatmentRead(
  value: CanonicalJsonValue,
): PrivateActorTargetTreatmentRead | undefined {
  return validatePrivateActorTargetTreatmentShape(value, false)
    ? value
    : undefined
}

export function validatePrivateActorTargetTreatmentHostJoin(
  value: unknown,
  input: {
    record: PublicRecord
    observer: PublicObserverSnapshot
  },
): value is PrivateActorTargetTreatmentRead {
  return validatePrivateActorTargetTreatmentRead(value)
    && isDeepStrictEqual(
      value,
      buildPrivateActorTargetTreatmentRead(input.record, input.observer),
    )
}

export function validateAdmittedPrivateActorTargetTreatmentHostJoin(
  value: PrivateActorTargetTreatmentRead,
  input: {
    record: PublicRecord
    observer: PublicObserverSnapshot
  },
): boolean {
  return isDeepStrictEqual(
    value,
    buildPrivateActorTargetTreatmentRead(input.record, input.observer),
  )
}
