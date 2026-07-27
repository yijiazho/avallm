import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { PlayerView, Seat } from '../../engine/types.ts'
import type { HiddenWorld } from './types.ts'
import {
  questFailEvidenceFromQuests,
  worldSatisfiesQuestEvidence,
  type QuestFailEvidence,
  type QuestRecordOptions,
} from './quest-constraints.ts'

export {
  questFailEvidenceFromQuests,
  worldSatisfiesQuestEvidence,
  type QuestFailEvidence,
} from './quest-constraints.ts'

export interface ConstraintOptions extends QuestRecordOptions {
  /**
   * `none` isolates deal knowledge. A number includes resolved quests through
   * that quest number, and `all` includes every resolved quest in the view.
   */
}

const sameSeats = (a: readonly Seat[], b: readonly Seat[]): boolean => {
  if (a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((seat, index) => seat === right[index])
}

export function questFailEvidence(
  view: PlayerView,
  options: ConstraintOptions = {},
): readonly QuestFailEvidence[] {
  return questFailEvidenceFromQuests(view.quests, options)
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
  return worldSatisfiesQuestEvidence(
    world,
    questFailEvidence(view, options),
  )
}
