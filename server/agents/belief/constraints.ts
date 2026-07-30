import { ROLE_ALIGNMENT, teamsEqual } from '../../engine/rules.ts'
import type { PlayerView } from '../../engine/types.ts'
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
    if (!teamsEqual(visibleEvil, view.privateInfo.knownEvil ?? [])) return false
  }

  if (view.alignment === 'evil' && view.role !== 'oberon') {
    const visiblePartners = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role, seat }) =>
        seat !== view.seat
        && ROLE_ALIGNMENT[role] === 'evil'
        && role !== 'oberon')
      .map(({ seat }) => seat)
    if (!teamsEqual(visiblePartners, view.privateInfo.evilPartners ?? [])) return false
  }

  if (view.role === 'percival') {
    const candidates = world.roleBySeat
      .map((role, seat) => ({ role, seat }))
      .filter(({ role }) => role === 'merlin' || role === 'morgana')
      .map(({ seat }) => seat)
    if (!teamsEqual(candidates, view.privateInfo.merlinCandidates ?? [])) return false
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
