import type { Seat } from '../../engine/types.ts'
import type { HiddenWorld } from './types.ts'

export interface QuestRecordOptions {
  questRecord?: 'none' | 'all' | number
}

export interface QuestFailEvidence {
  questNum: number
  team: readonly Seat[]
  minimumEvil: number
}

export interface PublicQuestRecord {
  num: number
  team?: readonly Seat[]
  result?: 'success' | 'fail'
  failCount?: number
}

function questIncluded(
  quest: PublicQuestRecord,
  option: QuestRecordOptions['questRecord'],
): boolean {
  if (option === 'none') return false
  if (option === undefined || option === 'all') return true
  return quest.num <= option
}

function failCardsShown(quest: PublicQuestRecord): number {
  if (quest.failCount !== undefined) return quest.failCount
  return quest.result === 'fail' ? 1 : 0
}

export function questFailEvidenceFromQuests(
  quests: readonly PublicQuestRecord[],
  options: QuestRecordOptions = {},
): readonly QuestFailEvidence[] {
  return quests
    .filter((quest) =>
      questIncluded(quest, options.questRecord)
      && quest.result !== undefined
      && quest.team !== undefined
      && failCardsShown(quest) > 0)
    .map((quest) => ({
      questNum: quest.num,
      team: quest.team!,
      minimumEvil: failCardsShown(quest),
    }))
    .sort((a, b) => a.questNum - b.questNum)
}

export function worldSatisfiesQuestEvidence(
  world: HiddenWorld,
  evidenceRecords: readonly QuestFailEvidence[],
): boolean {
  for (const evidence of evidenceRecords) {
    const evilAboard = evidence.team.filter(
      (seat) => world.alignmentBySeat[seat] === 'evil',
    ).length
    if (evilAboard < evidence.minimumEvil) return false
  }
  return true
}
