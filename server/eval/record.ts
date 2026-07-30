// Render an archived game as text for LLM consumers (probe, judge).
// Two levels: publicRecord is strictly the table-visible record (what a
// spectator saw — the blinded input); fullRecord adds roles and every
// seat-private event (thinking, scratchpads, votes as cast, quest cards) —
// the judge's full-transparency input. Lines carry [seq N] tags so callers
// can cite exact moments.

import { sanitizeSpeech } from '../agents/prompts.ts'
import type { GameArtifact } from './artifact.ts'
import type { GameEvent, Seat } from '../engine/types.ts'

export function nameOf(a: GameArtifact, seat: Seat): string {
  return `${a.players[seat].name}(seat ${seat})`
}

function teamText(a: GameArtifact, team: readonly Seat[]): string {
  return team.map((s) => a.players[s].name).join('/')
}

function eventLine(a: GameArtifact, ev: GameEvent, full: boolean): string | null {
  const tag = `[seq ${ev.seq}]`
  switch (ev.type) {
    case 'leadChange':
      return `${tag} — quest ${ev.payload.round}, proposal ${ev.payload.proposalNum}: ${nameOf(a, ev.payload.seat)} leads —`
    case 'utterance': {
      // sanitize-at-boundary: player/agent free text is untrusted and enters an
      // LLM prompt here (probe/judge), so strip injection markup exactly like
      // the live prompt path does (server/agents/prompts.ts).
      const text = sanitizeSpeech(ev.payload.text ?? '')
      return `${tag} ${nameOf(a, ev.payload.seat)}: ${text ? `"${text}"` : '(passes)'}`
    }
    case 'proposal': {
      const pitch = typeof ev.payload.pitch === 'string' ? ` — pitch: "${sanitizeSpeech(ev.payload.pitch)}"` : ''
      return `${tag} ${nameOf(a, ev.payload.leader)} proposes [${teamText(a, ev.payload.team)}]${pitch}`
    }
    case 'proposalLocked':
      return `${tag} ${nameOf(a, ev.payload.leader)} locks in the team`
    case 'proposalRevised': {
      const reason = typeof ev.payload.reason === 'string' ? ` — "${sanitizeSpeech(ev.payload.reason)}"` : ''
      return `${tag} ${nameOf(a, ev.payload.leader)} REVISES the team to [${teamText(a, ev.payload.to)}]${reason}`
    }
    case 'voteReveal': {
      if (ev.payload.auto === true) return `${tag} HAMMER: team [${teamText(a, ev.payload.team)}] auto-approved, no vote`
      const votes = ev.payload.votes
        .map((v) => `${a.players[v.seat].name}:${v.vote === 'approve' ? 'Y' : 'N'}`).join(' ')
      return `${tag} votes: ${votes} -> ${ev.payload.approved ? 'APPROVED' : 'rejected'}`
    }
    case 'questResult':
      return `${tag} QUEST ${ev.payload.round}: ${ev.payload.result.toUpperCase()} (${ev.payload.failCount} fail cards, ${ev.payload.failsRequired} needed)`
    case 'assassination':
      return `${tag} assassination: ${nameOf(a, ev.payload.assassin)} names ${nameOf(a, ev.payload.target)} as Merlin -> ${ev.payload.wasMerlin ? 'CORRECT' : 'wrong'}`
    case 'gameOver':
      return `${tag} GAME OVER: ${ev.payload.winner} wins (${ev.payload.reason})`
    case 'rename':
      return `${tag} (${ev.payload.from} changed name to ${ev.payload.to})`
    // ---- private events: full record only ----
    case 'thinking':
      return full ? `${tag} [private thinking, ${nameOf(a, ev.payload.seat)} on ${ev.payload.kind}]: ${sanitizeSpeech(ev.payload.text)}` : null
    case 'scratchpad':
      return full ? `${tag} [private notes, ${nameOf(a, ev.payload.seat)}]: ${sanitizeSpeech(ev.payload.text)}` : null
    case 'voteCast':
      return full ? `${tag} [private] ${nameOf(a, ev.payload.seat)} votes ${ev.payload.vote}` : null
    case 'questCard':
      return full ? `${tag} [private] ${nameOf(a, ev.payload.seat)} plays ${ev.payload.card}` : null
    default:
      return null // gameCreated/roleDealt/knowledge: covered by the headers
  }
}

function header(a: GameArtifact, withRoles: boolean, withOutcome: boolean): string {
  const players = a.players
    .map((p) => withRoles
      ? `${p.name}(seat ${p.seat}) = ${p.role.toUpperCase()} (${p.alignment})`
      : `${p.name}(seat ${p.seat})`)
    .join(', ')
  const created = a.log[0]
  const roles = created?.type === 'gameCreated' ? created.payload.rolesInPlay.join(', ') : ''
  return [
    `Players: ${players}.`,
    `Roles in play: ${roles}.`,
    `${a.playerCount} players.${withOutcome ? ` Result: ${a.winner} wins (${a.winReason}).` : ''}`,
  ].join('\n')
}

// excludeOutcome: stop the record before the endgame (no assassination, no
// gameOver, no result line) — required for the virtual-assassin probe, which
// must not see how the real endgame went.
export function publicRecord(a: GameArtifact, opts: { excludeOutcome?: boolean } = {}): string {
  const lines = a.log
    .filter((ev) => ev.visibility === 'public')
    .filter((ev) => !(opts.excludeOutcome && (ev.type === 'assassination' || ev.type === 'gameOver')))
    .map((ev) => eventLine(a, ev, false))
    .filter((l): l is string => l !== null)
  return `${header(a, false, !opts.excludeOutcome)}\n\n${lines.join('\n')}`
}

export function fullRecord(a: GameArtifact): string {
  const lines = a.log
    .map((ev) => eventLine(a, ev, true))
    .filter((l): l is string => l !== null)
  return `${header(a, true, true)}\n\n${lines.join('\n')}`
}
