// Debug-transcript renderer: one game → one self-contained Markdown document
// meant to be copied to the clipboard and pasted into a chat for debugging.
//
// Two audiences in one artifact:
//   - a human skims the header + play-by-play to confirm they grabbed the
//     right game, and
//   - a debugger (me) reads the annotated play-by-play — which INLINES hidden
//     information (each bot's [thinking]/[notes], secret quest cards, individual
//     votes) in seq order — plus the raw JSONL log for byte-exact detail.
//
// Pure and clock-free (the caller passes `capturedAt`), so it unit-tests
// offline. Redaction is the CALLER's job: pass only the events the requester
// may see and omit roles when they aren't revealed — this module renders
// whatever it is given and never widens visibility.

import type { Alignment, GameEvent, Phase, Quest, Role, Seat } from './engine/types.ts'

export interface TranscriptSeat {
  seat: Seat
  name: string
  agent: string          // 'human' or the agent-card/implementation identity
  model?: string         // resolved model slug, 'rule-based', or 'probabilistic'
  role?: Role            // present only when the transcript is a full reveal
  alignment?: Alignment
}

export interface TranscriptInput {
  id: string
  seed: string
  playerCount: number
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: Quest[]
  seats: TranscriptSeat[]
  log: readonly GameEvent[]        // already redacted to what the caller may see
  degraded?: { seat: Seat; kind: string; error: string }[]
  // Deterministically wrong decisions (eval/forced.ts). Optional because only a
  // finished, fully revealed transcript can carry them: a blunder is unreadable
  // without knowing who was evil, which is the same reason they sit beside the
  // reveal rather than in the play-by-play. The caller grades and passes them in,
  // so this module keeps rendering and does no analysis of its own.
  violations?: { seat: Seat; rule: string; round: number; detail: string }[]
  winner?: Alignment
  winReason?: string
  // True when roles + hidden events are present (full reveal). False when the
  // log is scoped to one seat's visibility.
  revealed: boolean
  // For a scoped (non-revealed) transcript: whose view this is, for the header.
  scopedTo?: Seat | 'spectator'
  capturedAt: string               // ISO timestamp, supplied by the I/O layer
  includeRaw?: boolean             // append the raw JSONL log (default true)
}

export function renderTranscript(input: TranscriptInput): string {
  const seatName = new Map(input.seats.map((s) => [s.seat, s]))
  // `who(seat)` — the uniform seat reference used throughout the play-by-play.
  // When revealed it carries the role, which is exactly the annotation a
  // debugger wants next to every vote / card / thought: "Name(#3·morgana)".
  const who = (seat: Seat): string => {
    const s = seatName.get(seat)
    if (!s) return `seat ${seat}`
    return input.revealed && s.role ? `${s.name}(#${seat}·${s.role})` : `${s.name}(#${seat})`
  }

  const out: string[] = []
  out.push('# Avalon debug transcript')
  out.push('')

  // ---- header ----
  const over = input.phase === 'gameOver'
  const when = over
    ? 'FINAL'
    : `MID-GAME — ${input.phase} (quest ${input.round}, proposal ${input.proposalNum}), leader ${who(input.leaderSeat)}`
  out.push(`- game \`${input.id}\` · seed \`${input.seed}\` · ${input.playerCount} players`)
  out.push(`- captured: ${when}`)
  out.push(`- captured at: ${input.capturedAt}`)
  if (input.winner) out.push(`- winner: **${input.winner.toUpperCase()}** — ${input.winReason ?? '?'}`)
  if (input.revealed) {
    out.push('- fidelity: **FULL REVEAL** — every role and all bot reasoning included')
  } else {
    const scope = input.scopedTo === 'spectator' ? 'a spectator' : `seat ${input.scopedTo}`
    out.push(`- fidelity: **SCOPED** to ${scope} — public events plus that seat's own private events; other roles and bot reasoning are hidden (finish the game, or capture from the solo seat, for a full reveal)`)
  }
  if (input.degraded && input.degraded.length) {
    out.push(`- degraded decisions: ${input.degraded.length}`)
    for (const d of input.degraded) {
      out.push(`  - ${who(d.seat)} ${d.kind}: ${d.error}`)
    }
  }
  if (input.violations && input.violations.length) {
    out.push(`- forced-play violations: ${input.violations.length}`)
    for (const v of input.violations) {
      out.push(`  - ${who(v.seat)} Q${v.round} [${v.rule}]: ${v.detail}`)
    }
  }
  out.push('')

  // ---- seat roster ----
  out.push('## Seats')
  out.push('')
  if (input.revealed) {
    out.push('| # | name | agent | model | role | align |')
    out.push('| - | ---- | ----- | ----- | ---- | ----- |')
    for (const s of input.seats) {
      out.push(`| ${s.seat} | ${s.name} | ${s.agent} | ${s.model ?? '—'} | ${s.role ?? '?'} | ${s.alignment ?? '?'} |`)
    }
  } else {
    out.push('| # | name | agent | model |')
    out.push('| - | ---- | ----- | ----- |')
    for (const s of input.seats) out.push(`| ${s.seat} | ${s.name} | ${s.agent} | ${s.model ?? '—'} |`)
  }
  out.push('')

  // ---- quest board ----
  out.push('## Quests')
  out.push('')
  for (const q of input.quests) {
    const teamStr = q.status === 'complete' ? q.team.map(who).join(', ') : '—'
    const res = q.status === 'complete'
      ? `${q.result.toUpperCase()} (${q.failCount} fail${q.failCount === 1 ? '' : 's'}, needed ${q.failsRequired})`
      : 'pending'
    out.push(`- Q${q.num} (size ${q.teamSize}, needs ${q.failsRequired} fail${q.failsRequired === 1 ? '' : 's'}): ${res} — team: ${teamStr}`)
  }
  out.push('')

  // ---- annotated play-by-play ----
  // Free-form text (utterances, pitches, thinking, names) can contain ```,
  // which would close a fixed ``` fence early and garble the rendered document.
  // fenceBar picks a backtick run longer than anything in the body.
  out.push('## Play-by-play')
  out.push('')
  const pbp: string[] = []
  for (const ev of input.log) {
    const line = renderLine(ev, who)
    if (line !== null) pbp.push(line)
  }
  const pbpBar = fenceBar(pbp.join('\n'))
  out.push(pbpBar, ...pbp, pbpBar, '')

  // ---- raw log ----
  if (input.includeRaw !== false) {
    out.push('## Raw event log (JSONL, one event per line)')
    out.push('')
    const raw = input.log.map((ev) => JSON.stringify(ev))
    const rawBar = fenceBar(raw.join('\n'))
    out.push(rawBar + 'jsonl', ...raw, rawBar, '')
  }

  return out.join('\n')
}

// A fence guaranteed to survive body content: at least three backticks, and
// always one more than the longest backtick run the body already contains.
function fenceBar(body: string): string {
  const longest = (body.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

// One event → one (or a few) play-by-play lines, or null to skip. Private
// events (thinking/notes/individual votes/secret cards/knowledge) are indented
// so they read as annotations under the public flow.
function renderLine(ev: GameEvent, who: (s: Seat) => string): string | null {
  const seq = String(ev.seq).padStart(3, ' ')
  const tag = (body: string) => `${seq}  ${body}`
  const sub = (body: string) => `${seq}      ${body}`
  const names = (seats: readonly Seat[], join = ', ') => seats.map(who).join(join)
  switch (ev.type) {
    case 'gameCreated': {
      const p = ev.payload
      return tag(`=== ${p.playerCount} players; roles: ${p.rolesInPlay.join(', ')}; first leader ${who(p.firstLeader)} ===`)
    }
    case 'roleDealt': {
      const p = ev.payload
      return sub(`deal: ${who(p.seat)} = ${p.role} (${p.alignment})`)
    }
    // Switching on the payload's own `kind` rather than probing for whichever
    // seat list happens to be defined: PrivateInfo is a discriminated union, so
    // exactly one list exists and the probe was reconstructing that fact at
    // runtime. A knowledge kind added later stops the build here.
    case 'knowledge': {
      const p = ev.payload
      const known = (body: string) => sub(`knows: ${who(p.seat)} — ${body}`)
      switch (p.kind) {
        case 'evil':
          return known(`evil partners ${names(p.evilPartners) || '(none)'}`)
        case 'merlin':
          return known(`sees evil ${names(p.knownEvil)}`)
        case 'percival':
          return known(`Merlin/Morgana ${names(p.merlinCandidates, ' or ')}`)
        case 'none':
          return null
      }
    }
    case 'leadChange': {
      const p = ev.payload
      return tag(`— leader → ${who(p.seat)} (Q${p.round}.${p.proposalNum}) —`)
    }
    case 'utterance': {
      const p = ev.payload
      if (!p.text) return null
      return tag(`${who(p.seat)}: "${p.text}"`)
    }
    case 'proposal': {
      const p = ev.payload
      const pitch = p.pitch ? ` — "${p.pitch}"` : ''
      return tag(`[Q${p.round}.${p.proposalNum}] ${who(p.leader)} proposes: ${names(p.team)}${pitch}`)
    }
    case 'proposalLocked':
      return tag(`${who(ev.payload.leader)} locks in the team`)
    case 'proposalRevised': {
      const p = ev.payload
      const reason = p.reason ? ` — "${p.reason}"` : ''
      return tag(`${who(p.leader)} revises the team: ${names(p.to)}${reason}`)
    }
    case 'voteCast': {
      const p = ev.payload
      return sub(`vote: ${who(p.seat)} → ${p.vote}`)
    }
    case 'voteReveal': {
      const p = ev.payload
      const votes = p.votes
        .map((v) => `${who(v.seat)}:${v.vote === 'approve' ? 'Y' : 'N'}`).join('  ')
      return tag(`votes: ${votes}  →  ${p.approved ? 'APPROVED' : 'rejected'}`)
    }
    case 'questCard': {
      const p = ev.payload
      return sub(`card: ${who(p.seat)} plays ${p.card.toUpperCase()}`)
    }
    case 'questResult': {
      const p = ev.payload
      return tag(`Quest ${p.round}: ${p.result.toUpperCase()} (${p.failCount} fail${p.failCount === 1 ? '' : 's'}, needed ${p.failsRequired})`)
    }
    case 'thinking': {
      const p = ev.payload
      return sub(`[${who(p.seat)} · ${p.kind} thinking] ${p.text}`)
    }
    case 'scratchpad': {
      const p = ev.payload
      return sub(`[${who(p.seat)} · notes] ${p.text}`)
    }
    case 'assassination': {
      const p = ev.payload
      return tag(`assassin ${who(p.assassin)} targets ${who(p.target)} — ${p.wasMerlin ? 'MERLIN! evil wins' : 'not Merlin'}`)
    }
    case 'gameOver': {
      const p = ev.payload
      return tag(`*** ${p.winner.toUpperCase()} wins (${p.reason}) ***`)
    }
    case 'rename': {
      const p = ev.payload
      return sub(`rename: seat ${p.seat} "${p.from}" → "${p.to}"`)
    }
    // No default arm on purpose. This transcript is the debugging artifact of
    // last resort, so an event it does not know how to render must be a compile
    // error rather than a line nobody notices is missing. Adding an event type
    // leaves this function able to fall off the end, which its return type
    // forbids, and the build stops here until the new kind gets a line.
  }
}
