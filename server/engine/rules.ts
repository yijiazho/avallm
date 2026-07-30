// Rules reference tables — transcribed from docs/research-rules-and-visuals.md §3.
// Voting: strict-majority approval (tie = reject). House rule (deviation from
// the official "5th rejection = evil wins"): the 5th proposal in a round is
// approved automatically without a vote, so only 4 proposals can be rejected.

import type { Alignment, ProposalVote, Role } from './types.ts'

export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 10
export const MAX_PROPOSALS = 5
export const QUESTS_PER_GAME = 5
export const QUESTS_TO_WIN = 3

export const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
}

export const EVIL_COUNT: Record<number, number> = {
  5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4,
}

// Only quest 4, only at 7+ players, requires 2 fail cards.
export function failsRequired(playerCount: number, questNum: number): number {
  return playerCount >= 7 && questNum === 4 ? 2 : 1
}

// Narrow a quest to its resolved member. Usable as a filter predicate so a
// filter-then-map over finished quests keeps team/result/failCount in scope.
// Generic over the quest shape so it accepts both the mutable engine `Quest`
// and the readonly `DeepReadonly<Quest>` a PlayerView projection carries,
// narrowing each to its own completed variant.
export function isCompletedQuest<Q extends { status: 'pending' | 'complete' }>(
  quest: Q,
): quest is Q & { status: 'complete' } {
  return quest.status === 'complete'
}

export const ROLE_ALIGNMENT: Record<Role, Alignment> = {
  merlin: 'good', percival: 'good', servant: 'good',
  assassin: 'evil', morgana: 'evil', mordred: 'evil', oberon: 'evil', minion: 'evil',
}

// De-facto standard digital setups (research doc §3.4).
export const DEFAULT_ROLES: Record<number, Role[]> = {
  5: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  6: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin'],
  7: ['merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon'],
  8: ['merlin', 'percival', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'minion'],
  9: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred'],
  10: ['merlin', 'percival', 'servant', 'servant', 'servant', 'servant', 'morgana', 'assassin', 'mordred', 'oberon'],
}

// Roles that can appear AT MOST ONCE in a cast. Servant and Minion are the only
// roles dealt in quantity. Named rather than inlined so the duplicate check below
// reads as a rule instead of a literal.
//
// agents/board.ts deliberately does NOT consult this: it counts copies off
// rolesInPlay instead, because "unique in the rulebook" and "unique in THIS cast"
// differ. At 5 players exactly one Servant is dealt, so the Servant seat can rule
// Servant out everywhere else, which a fixed list of unique roles would miss.
const UNIQUE_ROLES: Role[] = ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon']

// The role dependency lattice. A special role is only meaningful when the role
// it acts ON is also in play, so each entry names its ONE direct requirement and
// transitivity carries the rest: Morgana needs Percival, who needs Merlin, so
// Morgana never states a Merlin edge of its own. Merlin/Assassin are the root
// and are checked as a biconditional below (each is meaningless without the
// other, so neither can be the other's dependent).
//
// This is here rather than only in the setup picker because the picker is UI
// convenience: POST /api/lobby takes a caller-supplied role list, so without
// this an incoherent cast reaches the PROMPT layer, where each of these roles'
// guidance text names the role it depends on ("Percival sees you and Merlin...",
// "Hidden from Merlin") and would describe somebody nobody is holding.
//
// Scope is deliberate: only edges that prompt correctness depends on. Oberon is
// absent because his guidance is self-contained (an evil who cannot coordinate
// works fine with no Merlin at the table). The picker is stricter and requires
// Merlin for him, which is a product choice and is safe: a picker STRICTER than
// the engine only narrows what it offers, while a picker LOOSER than the engine
// would offer setups that can only ever 400.
const ROLE_REQUIRES: Partial<Record<Role, Role>> = {
  percival: 'merlin',
  morgana: 'percival',
  mordred: 'merlin',
}

export function validateRoles(playerCount: number, roles: Role[]): void {
  if (roles.length !== playerCount) {
    throw new Error(`roles length ${roles.length} !== playerCount ${playerCount}`)
  }
  const evil = roles.filter((r) => ROLE_ALIGNMENT[r] === 'evil').length
  if (evil !== EVIL_COUNT[playerCount]) {
    throw new Error(`role set has ${evil} evil, expected ${EVIL_COUNT[playerCount]} for ${playerCount} players`)
  }
  const has = (r: Role) => roles.includes(r)
  if (has('merlin') !== has('assassin')) {
    throw new Error('merlin and assassin must be added together')
  }
  // Checked root-first (declaration order), so a cast that breaks several edges
  // at once reports the upstream cause rather than the symptom below it.
  for (const [role, needs] of Object.entries(ROLE_REQUIRES) as [Role, Role][]) {
    if (has(role) && !has(needs)) {
      throw new Error(`${role} requires ${needs} in play`)
    }
  }
  for (const r of UNIQUE_ROLES) {
    if (roles.filter((x) => x === r).length > 1) throw new Error(`duplicate unique role: ${r}`)
  }
}

// ---- Proposal outcome predicates ----
//
// One home for the "what did this proposal resolve to" questions, so readers
// narrow the outcome-discriminated shape through these rather than re-deriving
// the hammer/vote rules at each site. Typed structurally on the outcome
// discriminant alone, so they serve both the engine's ProposalRecord and the
// public-board projection (PublicRecord.proposals), which share the discriminant
// but differ in their other fields.

// The ballot cast on a proposal. Empty for a proposal still on the table
// (pending) and for the auto-approved hammer, which is never voted on.
export function proposalVotes(
  p:
    | { outcome: 'pending' | 'auto' }
    | { outcome: 'voted'; votes: readonly ProposalVote[] },
): readonly ProposalVote[] {
  return p.outcome === 'voted' ? p.votes : []
}

// Whether the proposal was approved and sent on the quest: a voted approval or
// the auto-approved hammer.
export function proposalApproved(
  p: { outcome: 'pending' | 'auto' } | { outcome: 'voted'; approved: boolean },
): boolean {
  return p.outcome === 'auto' || (p.outcome === 'voted' && p.approved)
}

// Whether the proposal has resolved (been voted on or auto-approved), i.e. is no
// longer the team on the table awaiting a vote. A type guard so callers narrow
// to the resolved variants of whichever proposal union they hold.
export function proposalResolved<T extends { outcome: 'pending' | 'voted' | 'auto' }>(
  p: T,
): p is Extract<T, { outcome: 'voted' | 'auto' }> {
  return p.outcome !== 'pending'
}

// Whether the proposal was voted down: a real ballot that failed the majority.
export function proposalRejected(
  p: { outcome: 'pending' | 'auto' } | { outcome: 'voted'; approved: boolean },
): boolean {
  return p.outcome === 'voted' && !p.approved
}
