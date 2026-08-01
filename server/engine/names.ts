// Untrusted name and speech-text policy. A display name is user-supplied and is
// injected verbatim into every OTHER player's LLM prompt, so it is sanitized and
// vetted here before it reaches any prompt. Model-authored speech is capped and
// its stray seat references rewritten here too. Pure: this module imports only
// engine types.

import { ROLES, type Player } from './types.ts'

// ---- name policy ----
// A display name is injected verbatim into every OTHER player's LLM prompt
// (and echoed in their speech), so it must be an unambiguous identity token.
// A first/second-person pronoun ("You", "Me", "I") is read by the model as
// referring to itself — a human named "You" makes every bot think it is the
// leader, on the team, etc. Game terms ("leader") and system words collide
// with the prompt's own structure. These are rejected at the boundary; the
// human's own view renders "You" client-side instead of storing it as a name.
// Agent-card names are public metadata, not conversational player identities.
// Keep the pre-alias identity-word policy for those labels so existing cards
// named after Avalon roles remain valid when player names gain the stricter
// role-name rule below.
export const RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set([
  'you', 'u', 'me', 'i', 'myself', 'self', 'we', 'us',
  'system', 'assistant', 'narrator', 'leader',
])

export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...RESERVED_AGENT_NAMES,
  // Public game identities and hidden roles are not safe player names. Aside
  // from confusing ordinary prose, allowing a player called "Merlin" makes a
  // grounded role claim indistinguishable from addressing that player.
  ...ROLES,
])

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function nameIsReserved(name: string): boolean {
  return RESERVED_NAMES.has(normalizeName(name))
}

export function agentNameIsReserved(name: string): boolean {
  return RESERVED_AGENT_NAMES.has(normalizeName(name))
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
    return n >= 0 && n < players.length ? players[n]!.name : m
  })
}
