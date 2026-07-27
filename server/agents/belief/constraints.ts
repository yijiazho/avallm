import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { PlayerView, Quest, Seat } from '../../engine/types.ts'
import type { HiddenWorld } from './types.ts'

export interface ConstraintOptions {
  /**
   * `none` isolates deal knowledge. A number includes resolved quests through
   * that quest number, and `all` includes every resolved quest in the view.
   */
  questRecord?: 'none' | 'all' | number
}

export interface QuestFailEvidence {
  questNum: number
  team: readonly Seat[]
  minimumEvil: number
}

const sameSeats = (a: readonly Seat[], b: readonly Seat[]): boolean => {
  if (a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((seat, index) => seat === right[index])
}

function questIncluded(quest: Quest, option: ConstraintOptions['questRecord']): boolean {
  if (option === 'none') return false
  if (option === undefined || option === 'all') return true
  return quest.num <= option
}

function failCardsShown(quest: Quest): number {
  if (quest.failCount !== undefined) return quest.failCount
  return quest.result === 'fail' ? 1 : 0
}

export function questFailEvidence(
  view: PlayerView,
  options: ConstraintOptions = {},
): readonly QuestFailEvidence[] {
  return view.quests
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

/**
 * Test a complete world against exactly the hard information in a PlayerView.
 * Complete private lists are compared as sets, so both named and omitted seats
 * constrain the result.
 */
export function worldSatisfiesView(
  view: PlayerView,
  world: HiddenWorld,
  options: ConstraintOptions = {},
): boolean {
  if (world.roleBySeat.length !== view.playerCount) return false
  if (world.roleBySeat[view.seat] !== view.role) return false

  if (view.role === 'merlin') {
    const visibleEvil = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role }) => ROLE_ALIGNMENT[role] === 'evil' && role !== 'mordred')
      .map(({ seat }) => seat)
    if (!sameSeats(visibleEvil, view.privateInfo.knownEvil ?? [])) return false
  }

  if (view.alignment === 'evil' && view.role !== 'oberon') {
    const visiblePartners = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role, seat }) =>
        seat !== view.seat
        && ROLE_ALIGNMENT[role] === 'evil'
        && role !== 'oberon')
      .map(({ seat }) => seat)
    if (!sameSeats(visiblePartners, view.privateInfo.evilPartners ?? [])) return false
  }

  if (view.role === 'percival') {
    const candidates = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role }) => role === 'merlin' || role === 'morgana')
      .map(({ seat }) => seat)
    if (!sameSeats(candidates, view.privateInfo.merlinCandidates ?? [])) return false
  }

  return worldSatisfiesQuestRecord(view, world, options)
}

export function worldSatisfiesQuestRecord(
  view: PlayerView,
  world: HiddenWorld,
  options: ConstraintOptions = {},
): boolean {
  for (const evidence of questFailEvidence(view, options)) {
    const evilAboard = evidence.team.filter(
      (seat) => world.alignmentBySeat[seat] === 'evil',
    ).length
    if (evilAboard < evidence.minimumEvil) return false
  }

  return true
}
