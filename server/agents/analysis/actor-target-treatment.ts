/**
 * The public actor-target treatment read. For each ordered (actor, target) pair
 * it counts how often the actor put the target on an executed proposal and, when
 * the actor voted on such a proposal, how often they approved a team carrying the
 * target, as fractions over a dense playerCount^2 matrix. It reads the public
 * record only: names, prose, private state, and raw event ordering never enter
 * it. Mordred blindness is the consumer, reading the Merlin row to weigh
 * anomalous treatment of a hypothesized Merlin.
 */

import { isDeepStrictEqual } from 'node:util'
import { proposalApproved, proposalVotes } from '../../engine/rules.ts'
import type { Seat } from '../../engine/types.ts'
import { teamsEqual } from '../../engine/seatset.ts'
import type { PublicRecord } from '../communication/public-record.ts'
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
import {
  denseArray,
  exactKeys,
  plainDetachedData,
  plainRecord,
  probability,
  tableSize,
} from '../components/canonical-shape.ts'
import {
  closeProbability as close,
} from '../components/probability-arithmetic.ts'

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
      const proposal = record.proposals
        .filter(
          (candidate) =>
            candidate.round === quest.num
            && proposalApproved(candidate)
            && teamsEqual(candidate.team, quest.team!),
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
    for (const vote of [...proposalVotes(proposal)].sort(
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
      || !tableSize(value.playerCount)
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

/**
 * The untyped-entry host join: shape-validate an unknown value at the hostile
 * boundary, then rebuild and compare. Retained deliberately though only tests
 * reach it today (recorded in TEST_ONLY_EXPORT_EXEMPTIONS in
 * tools/architecture-fitness.mjs); it is the second door for a caller holding an
 * unnarrowed value. Production enters through the Admitted variant below, which
 * assumes the kernel already admitted the shape.
 */
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
