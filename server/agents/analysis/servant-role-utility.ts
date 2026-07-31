/**
 * The servant's per-candidate propose utility.
 *
 * Measured before it was written, over the 60 servant cases of the phase-4
 * bank: 75 of 76 servant proposals score every viable candidate at EXACTLY the
 * same value, and the winner is currently picked by sorting candidate ids.
 * That is not a round-one artifact, it holds through round five (23 of 23).
 *
 * The flatness is structural. A servant holds no private role knowledge, so
 * its belief is the public posterior, and the proposal layer has already
 * filtered to the maximum-clean set: everything still standing is equally
 * clean under the exact joint probability, by construction.
 *
 * So this layer answers a question the base cannot see. evilReadIndex blends
 * the exact marginal with failedQuestExposureIndex, the circumstantial "this
 * seat keeps turning up on failed quests" weight that no joint probability
 * carries. That deliberate double count is documented as intentional on
 * PUBLIC_SELF_READ_CONSTANTS, and this is where it earns its keep: it is the
 * only thing left that separates teams the belief calls identical.
 *
 * Choosing the publicly cleanest of several equally-clean teams is also what a
 * Merlin would do, which is the decoy half of the servant objective. The cost
 * is zero by the model's own reckoning, since the alternatives are tied.
 */

import type { PlayerView, Seat } from '../../engine/types.ts'
import { isCanonicalTeam } from '../../engine/seatset.ts'
import type { PolicyCandidate } from '../policy/types.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import { buildPublicSelfRead } from './public-self-read.ts'
import { PUBLIC_SELF_READ_VERSION } from './public-self-read-types.ts'
import {
  canonicalSeats,
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import { clampProbability as clamp01 } from '../canonical/probability-arithmetic.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'

export const SERVANT_ROLE_UTILITY_PROJECTION_VERSION =
  'servant-role-utility-v1'
export const SERVANT_ROLE_UTILITY_DEGRADATION =
  'servant-role-utility-projection-failed'
export const SERVANT_ROLE_UTILITY_VALUE_SEMANTICS =
  'bounded-deterministic-heuristic-utility-not-probability'

/** The engine's largest propose candidate set, matching the sibling bound. */
export const MAX_SERVANT_ROLE_UTILITY_ASSESSMENTS = 252

export interface ServantRoleUtilityAssessment {
  candidateId: string
  kind: 'propose'
  team: readonly Seat[]
  valueSemantics: typeof SERVANT_ROLE_UTILITY_VALUE_SEMANTICS
  roleValue: number
}

export interface PrivateServantRoleUtilityProjection {
  version: typeof SERVANT_ROLE_UTILITY_PROJECTION_VERSION
  selfReadVersion: typeof PUBLIC_SELF_READ_VERSION
  playerCount: number
  seat: Seat
  assessments: readonly ServantRoleUtilityAssessment[]
}

export interface ServantRoleUtilityInput {
  view: PlayerView
  candidates: readonly PolicyCandidate[]
}

export function buildServantRoleUtilityProjection(
  input: ServantRoleUtilityInput,
): PrivateServantRoleUtilityProjection {
  const read = buildPublicSelfRead(projectPublicRecord(input.view))
  const assessments = input.candidates.map(
    (candidate): ServantRoleUtilityAssessment => {
      if (candidate.decision.kind !== 'propose') {
        throw new Error('servant role utility scores propose candidates only')
      }
      const team = candidate.decision.team
      if (team.length === 0) {
        throw new Error('servant role utility requires a non-empty team')
      }
      // The mean rather than the max: one badly-read seat should move the
      // value, not veto the team. A max would collapse to "avoid the single
      // dirtiest seat" and rank every other difference at zero, which is the
      // flatness this layer exists to fix.
      const total = team.reduce((sum, seat) => {
        const entry = read.seats[seat]
        if (!entry) throw new Error('servant role utility lacks a team seat')
        return sum + entry.evilReadIndex
      }, 0)
      return {
        candidateId: candidate.id,
        kind: 'propose',
        team: [...team],
        valueSemantics: SERVANT_ROLE_UTILITY_VALUE_SEMANTICS,
        roleValue: clamp01(1 - total / team.length),
      }
    },
  )
  if (assessments.length === 0) {
    throw new Error('servant role utility requires at least one candidate')
  }
  if (assessments.length > MAX_SERVANT_ROLE_UTILITY_ASSESSMENTS) {
    throw new Error('servant role utility exceeded its candidate bound')
  }
  return {
    version: SERVANT_ROLE_UTILITY_PROJECTION_VERSION,
    selfReadVersion: PUBLIC_SELF_READ_VERSION,
    playerCount: read.playerCount,
    seat: input.view.seat,
    assessments,
  }
}

function servantRoleUtilitySchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  if (!exactKeys(detached, [
    'version',
    'selfReadVersion',
    'playerCount',
    'seat',
    'assessments',
  ])) return false
  if (
    detached.version !== SERVANT_ROLE_UTILITY_PROJECTION_VERSION
    || detached.selfReadVersion !== PUBLIC_SELF_READ_VERSION
    || !tableSize(detached.playerCount)
    || !Number.isSafeInteger(detached.seat)
    || (detached.seat as number) < 0
    || (detached.seat as number) >= (detached.playerCount as number)
    || !denseArray(detached.assessments)
  ) return false

  const assessments = detached.assessments as unknown[]
  if (
    assessments.length === 0
    || assessments.length > MAX_SERVANT_ROLE_UTILITY_ASSESSMENTS
  ) return false

  const ids = new Set<string>()
  for (const entry of assessments) {
    if (!plainRecord(entry) || !exactKeys(entry, [
      'candidateId',
      'kind',
      'team',
      'valueSemantics',
      'roleValue',
    ])) return false
    if (
      typeof entry.candidateId !== 'string'
      || entry.candidateId.length === 0
      || ids.has(entry.candidateId)
      || entry.kind !== 'propose'
      || entry.valueSemantics !== SERVANT_ROLE_UTILITY_VALUE_SEMANTICS
      || !canonicalSeats(entry.team, detached.playerCount as number)
      || (entry.team as unknown[]).length === 0
      || !isCanonicalTeam(entry.team as Seat[])
      || !probability(entry.roleValue)
    ) return false
    ids.add(entry.candidateId)
  }
  return true
}

const servantRoleUtilityCodec =
  projectionCodec<PrivateServantRoleUtilityProjection>(
    servantRoleUtilitySchema,
  )

export const validateServantRoleUtilityProjection =
  servantRoleUtilityCodec.validate

export const decodeCanonicalServantRoleUtilityProjection =
  servantRoleUtilityCodec.decode

export const validateAdmittedServantRoleUtilityHostJoin =
  exactHostJoin(buildServantRoleUtilityProjection)
