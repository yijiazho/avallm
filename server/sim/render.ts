// Text rendering of public game events for the sim transcript and CLI play.

import type { Game, GameEvent, Seat } from '../engine/types.ts'

function name(game: Game, seat: Seat): string {
  return `${game.players[seat]!.name}(${seat})`
}

export function renderEvent(ev: GameEvent, game: Game): string | null {
  // Switch on the discriminated `ev.type`, then read the per-case typed
  // `ev.payload`: every field access below is compiler-checked against the
  // payload that event owns (EventPayloadMap), no hand-casts.
  switch (ev.type) {
    case 'gameCreated': {
      const p = ev.payload
      return `=== Avalon: ${p.playerCount} players, roles: ${p.rolesInPlay.join(', ')} ===\n` +
        `First leader: ${name(game, p.firstLeader)}`
    }
    case 'utterance': {
      const p = ev.payload
      return p.text ? `  ${name(game, p.seat)}: "${p.text}"` : null
    }
    case 'proposal': {
      const p = ev.payload
      return `\n[Q${p.round}.${p.proposalNum}] ${name(game, p.leader)} proposes: ${p.team.map((s) => name(game, s)).join(', ')}`
    }
    case 'proposalLocked': {
      const p = ev.payload
      return `  ${name(game, p.leader)} locks in the team.`
    }
    case 'proposalRevised': {
      // Show the change, not just the new roster — a reader (human or bot) should
      // not have to diff it against the proposal line scrolled off above.
      const p = ev.payload
      const { from, to } = p
      const dropped = from.filter((s) => !to.includes(s)).map((s) => name(game, s)).join(', ')
      const added = to.filter((s) => !from.includes(s)).map((s) => name(game, s)).join(', ')
      // Lower-case verb like "proposes" / "locks in the team": in this renderer
      // capitals mark outcomes (APPROVED, SUCCESS, MERLIN!), not actions. The
      // client feed says "revises the team" for the same event.
      return `  ${name(game, p.leader)} revises the team: drops ${dropped}, adds ${added}.` +
        ` Now: ${to.map((s) => name(game, s)).join(', ')}.${p.reason ? ` Reason: "${p.reason}"` : ''}`
    }
    case 'voteReveal': {
      const p = ev.payload
      if (p.auto) return `  hammer: AUTO-APPROVED (no vote)`
      const votes = p.votes
        .map((v) => `${name(game, v.seat)}:${v.vote === 'approve' ? 'Y' : 'N'}`).join(' ')
      return `  votes: ${votes} -> ${p.approved ? 'APPROVED' : 'rejected'}`
    }
    case 'questResult': {
      const p = ev.payload
      return `  Quest ${p.round}: ${p.result.toUpperCase()} (${p.failCount} fail${p.failCount === 1 ? '' : 's'}, needed ${p.failsRequired})`
    }
    case 'assassination': {
      const p = ev.payload
      return `\nAssassin ${name(game, p.assassin)} targets ${name(game, p.target)}: ${p.wasMerlin ? 'MERLIN! Evil wins.' : 'not Merlin.'}`
    }
    case 'gameOver': {
      const p = ev.payload
      return `\n*** ${p.winner.toUpperCase()} wins (${p.reason}) ***`
    }
    default:
      return null // private events are not rendered publicly
  }
}

// Seat-private events (`thinking`, `scratchpad`) are deliberately absent from
// this renderer: it produces the PUBLIC feed a player may watch. The written
// transcript renders them through `server/transcript.ts`, the same renderer the
// in-app copy-log button uses, gated behind the sim's `--reasoning`.
export function revealRoles(game: Game): string {
  return 'Roles: ' + game.players
    .map((p) => `${name(game, p.seat)}=${p.role}`)
    .join(', ')
}
