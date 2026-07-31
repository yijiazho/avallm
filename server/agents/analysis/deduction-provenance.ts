/**
 * The alignment-deduction provenance cluster, split out from situation.ts.
 *
 * Given a seat proven to hold an alignment, these helpers name *why* it is
 * proven: a private deal, role-cardinality closure, a single quest record, or a
 * joint constraint. situation.ts owns the board and assessments and consumes
 * only alignmentOf and provenanceFor from here.
 */

import { evilPartnersOf, knownEvilOf } from '../../engine/knowledge.ts'
import type {
  Alignment,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import type { QuestFailEvidence } from '../belief/constraints.ts'
import type { HiddenWorld } from '../belief/types.ts'
import { isPublicEvidence, type Evidence } from '../record/evidence.ts'
import type { DeductionProvenance } from './types.ts'

export function alignmentOf(
  worlds: readonly HiddenWorld[],
  seat: Seat,
): Alignment | undefined {
  const first = worlds[0]?.alignmentBySeat[seat]
  return first && worlds.every((world) => world.alignmentBySeat[seat] === first)
    ? first
    : undefined
}

/**
 * Every private record this seat holds, not only the dealt role. A new private
 * kind joins the cited provenance automatically, which is the intent: a
 * deduction that leans on private knowledge should name all of it.
 */
const privateEvidenceIds = (evidence: readonly Evidence[]): readonly string[] =>
  evidence
    .filter((record) => !isPublicEvidence(record))
    .map((record) => record.id)

const questEvidenceId = (
  evidence: readonly Evidence[],
  questNum: number,
): string | undefined =>
  evidence.find(
    (record) =>
      record.kind === 'quest-result' && record.payload.questNum === questNum,
  )?.id

function worldMatchesQuest(
  world: HiddenWorld,
  record: QuestFailEvidence,
): boolean {
  return record.team.filter(
    (seat) => world.alignmentBySeat[seat] === 'evil',
  ).length >= record.minimumEvil
}

function combinations<T>(items: readonly T[], size: number): readonly T[][] {
  const output: T[][] = []
  const current: T[] = []
  const visit = (start: number): void => {
    if (current.length === size) {
      output.push(current.slice())
      return
    }
    for (let index = start; index < items.length; index++) {
      current.push(items[index])
      visit(index + 1)
      current.pop()
    }
  }
  visit(0)
  return output
}

function minimalQuestProof(
  dealWorlds: readonly HiddenWorld[],
  records: readonly QuestFailEvidence[],
  seat: Seat,
  alignment: Alignment,
): readonly QuestFailEvidence[] {
  for (let size = 1; size <= records.length; size++) {
    for (const selected of combinations(records, size)) {
      const worlds = dealWorlds.filter((world) =>
        selected.every((record) => worldMatchesQuest(world, record)))
      if (
        worlds.length
        && worlds.every((world) => world.alignmentBySeat[seat] === alignment)
      ) {
        return selected
      }
    }
  }
  return []
}

function directPrivateSeat(view: PlayerView, seat: Seat): boolean {
  return seat === view.seat
    || knownEvilOf(view.privateInfo).includes(seat)
    || evilPartnersOf(view.privateInfo).includes(seat)
}

function directSingleQuestProof(
  record: QuestFailEvidence,
  seat: Seat,
  alignment: Alignment,
): boolean {
  if (alignment !== 'evil' || !record.team.includes(seat)) return false
  // The quest record alone identifies a seat only when every team member
  // supplied a Fail. Any narrower candidate set comes from private deal
  // knowledge or role-cardinality closure and therefore needs joint provenance.
  return record.minimumEvil === record.team.length
}

/**
 * `dealWorlds` is a thunk so the deal-world set is only computed when the seat
 * is not directly known: a private-deal seat returns before it is forced. The
 * caller memoizes the thunk, so it is safe to invoke more than once.
 */
export function provenanceFor(
  view: PlayerView,
  evidence: readonly Evidence[],
  dealWorlds: () => readonly HiddenWorld[],
  questRecords: readonly QuestFailEvidence[],
  seat: Seat,
  alignment: Alignment,
): DeductionProvenance {
  const privateIds = privateEvidenceIds(evidence)
  if (directPrivateSeat(view, seat)) {
    return { kind: 'private-deal', evidenceIds: privateIds }
  }
  const worlds = dealWorlds()
  if (alignmentOf(worlds, seat) === alignment) {
    return { kind: 'role-cardinality-closure', evidenceIds: privateIds }
  }

  const proof = minimalQuestProof(worlds, questRecords, seat, alignment)
  const questNums = proof.map((record) => record.questNum)
  const questIds = questNums
    .map((questNum) => questEvidenceId(evidence, questNum))
    .filter((id): id is string => id !== undefined)
  if (
    proof.length === 1
    && directSingleQuestProof(proof[0], seat, alignment)
  ) {
    return { kind: 'quest-record', evidenceIds: questIds, questNums }
  }
  return {
    kind: 'joint-constraints',
    evidenceIds: [...privateIds, ...questIds],
    questNums,
    components: [
      ...(privateIds.length ? ['private-knowledge' as const] : []),
      'role-cardinality',
      'quest-record',
    ],
  }
}
