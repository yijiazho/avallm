// Rules reference tables — transcribed from docs/research-rules-and-visuals.md §3.
// Voting: strict-majority approval (tie = reject). House rule (deviation from
// the official "5th rejection = evil wins"): the 5th proposal in a round is
// approved automatically without a vote, so only 4 proposals can be rejected.

import type { Alignment, Player, PrivateInfo, Role, Seat, SeatSet } from './types.ts'

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

// ---- name policy ----
// A display name is injected verbatim into every OTHER player's LLM prompt
// (and echoed in their speech), so it must be an unambiguous identity token.
// A first/second-person pronoun ("You", "Me", "I") is read by the model as
// referring to itself — a human named "You" makes every bot think it is the
// leader, on the team, etc. Game terms ("leader") and system words collide
// with the prompt's own structure. These are rejected at the boundary; the
// human's own view renders "You" client-side instead of storing it as a name.
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'you', 'u', 'me', 'i', 'myself', 'self', 'we', 'us',
  'system', 'assistant', 'narrator', 'leader',
])

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function nameIsReserved(name: string): boolean {
  return RESERVED_NAMES.has(normalizeName(name))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Does `text` refer to `name`? Whole-word, case-insensitive — NOT a substring
// test. Names are user-supplied and may be one or two characters ("L", "Al",
// "Ed"), so `text.includes(name)` fires on the "l" in "always" and the "ed" in
// "asked": a seat named "L" would be told every turn that the whole table just
// addressed it. Any code deciding "was this player named?" must come through
// here. Two details the naive version gets wrong: the name can carry regex
// metacharacters (agent-def validation strips <>{}[]|\ but not . ( + ? $ ^), so
// it is escaped; and ASCII \b would refuse to match "Élodie", so the boundaries
// are Unicode letter/number lookarounds under the u flag.
export function mentionsName(text: string, name: string): boolean {
  return lastMentionIndex(text, name) >= 0
}

// Where `name` was LAST named in `text`, or -1 if never. Callers that must pick
// exactly one player out of a free-text reply want the last mention, not the
// first: a model reasons its way to the answer, so the names it rules out come
// first ("P1 is clean, P2 sat on the fail, so it must be P4").
export function lastMentionIndex(text: string, name: string): number {
  const n = name.trim()
  if (!n || !text) return -1
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'giu')
  let at = -1
  for (const m of text.matchAll(re)) at = m.index
  return at
}

// Hard cap on model-authored SPEECH, cut at a word boundary and marked.
//
// A raw slice ends a turn mid-word ("...testing Gemini or s" reached a live
// table that way), and spoken text is not just displayed: every other seat reads
// it inside their next prompt, and bots mimic the shape of the prose they are
// shown. So a ragged edge is something the table can learn to imitate, and an
// explicit marker at least reads as a truncation rather than as a thought that
// trailed off.
//
// Falls back to a hard cut when the tail carries no space to break on, so one
// enormous token cannot defeat the cap. Output never exceeds `max`.
export function capSpeech(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${body.trimEnd()}…`
}

// Seat numbers are handed to models ONLY so they can fill the team/vote/target
// JSON fields; the table UI shows names, not seats. Models nonetheless leak
// "seat 3" / "player 3" into their spoken text, where it is noise to humans and
// other bots alike. Rewrite any such reference to the name at that seat as the
// utterance/pitch enters the log (the single source both UI and prompts read).
export function stripSeatRefs(text: string, players: Player[]): string {
  return text.replace(/\b(?:seats?|players?)\s*#?\s*(\d+)\b/gi, (m, d) => {
    const n = Number(d)
    return n >= 0 && n < players.length ? players[n].name : m
  })
}

// A SeatSet in ascending order — the canonical form of a team, which is one
// such set. The one place that sort lives; agent code used to re-implement this
// six ways.
export function canonicalTeam(team: SeatSet): SeatSet {
  return [...team].sort((m, n) => m - n)
}

// Order-insensitive equality over a SeatSet: "same members" is the only thing
// that matters. Named for its most common argument (a proposed/quest team), but
// the contract is set-equality, so it also compares the non-team seat sets in
// PrivateInfo (knownEvil, evilPartners, merlinCandidates). Teams are canonically
// stored sorted, but callers compare against LLM/human-supplied teams that may
// not be — sort both defensively. Absent sets (no proposal on the table yet) are
// tolerated and compare reflexively: two absent sets are equal, and an absent set
// never equals a present one. This is the one canonical answer — agent code used
// to re-implement this five ways with inconsistent absent/absent handling.
export function teamsEqual(
  a: SeatSet | undefined,
  b: SeatSet | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  const x = canonicalTeam(a)
  const y = canonicalTeam(b)
  return x.every((s, i) => s === y[i])
}

// A team is a set of seats, so no seat may appear twice. The Set idiom
// new Set(team).size === team.length was open-coded across the agent admission,
// analysis, policy, cognition, and simulation layers; this is the one place it
// lives. Named for seats because that is what it guards — a proposal team, a
// communication target list, any seat list that must be a set.
export function hasDistinctSeats(team: readonly Seat[]): boolean {
  return new Set(team).size === team.length
}

// A team in canonical form: seats strictly ascending. Strictly ascending
// already forbids a repeat, so this implies hasDistinctSeats — the open-coded
// distinct-then-ascending pair that used to sit side by side over the same
// array collapses to this single call.
export function isCanonicalTeam(team: readonly Seat[]): boolean {
  return team.every((seat, index) => index === 0 || team[index - 1] < seat)
}

// The knowledge matrix (research doc §3.3). The ONLY producer of night-phase
// knowledge — deal, viewFor, and tests all share it.
export function computeKnowledge(players: Player[], seat: Seat): PrivateInfo {
  const me = players[seat]
  const seatsOf = (pred: (p: Player) => boolean) =>
    players.filter(pred).map((p) => p.seat).sort((a, b) => a - b)

  if (me.role === 'merlin') {
    return { kind: 'merlin', knownEvil: seatsOf((p) => p.alignment === 'evil' && p.role !== 'mordred') }
  }
  if (me.role === 'percival') {
    return { kind: 'percival', merlinCandidates: seatsOf((p) => p.role === 'merlin' || p.role === 'morgana') }
  }
  if (me.alignment === 'evil' && me.role !== 'oberon') {
    return {
      kind: 'evil',
      evilPartners: seatsOf((p) => p.alignment === 'evil' && p.role !== 'oberon' && p.seat !== seat),
    }
  }
  // Oberon and Servants learn nothing.
  return { kind: 'none' }
}

// Accessors for the one array a seat's PrivateInfo carries, or [] when its kind
// carries none. These are how consumers read knowledge without narrowing the
// union at every site: the old `view.privateInfo.evilPartners ?? []` reads
// become `evilPartnersOf(view.privateInfo)`, and the discriminant makes the
// "wrong role's field" state unrepresentable rather than merely absent.
export const knownEvilOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'merlin' ? info.knownEvil : []
export const evilPartnersOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'evil' ? info.evilPartners : []
export const merlinCandidatesOf = (info: PrivateInfo): readonly Seat[] =>
  info.kind === 'percival' ? info.merlinCandidates : []

// A deep copy decoupled from the source arrays, for callers that store the
// knowledge past the life of the view it came from (e.g. cognition evidence).
export function clonePrivateInfo(info: PrivateInfo): PrivateInfo {
  switch (info.kind) {
    case 'merlin': return { kind: 'merlin', knownEvil: info.knownEvil.slice() }
    case 'percival': return { kind: 'percival', merlinCandidates: info.merlinCandidates.slice() }
    case 'evil': return { kind: 'evil', evilPartners: info.evilPartners.slice() }
    case 'none': return { kind: 'none' }
  }
}
