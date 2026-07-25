// Forced-play violations: the ground-truth half of "is our guidance actually
// being followed?" (docs/research-strategy.md §7, docs/design-evaluation.md §3).
//
// A FORCED play is one that is correct deterministically, given the public board
// plus the deciding seat's own knowledge — no read of the table, no cover
// judgement, no probability. "Evil should usually put exactly one evil on the
// team" is not forced; "a lone Fail cannot sink a quest that needs two" is. Only
// the forced tier belongs here. Everything softer is a default with named
// exceptions, and grading it needs judgement, which is the LLM judge's job
// (INCIDENT_FAMILIES in judge.ts, notably 'blunder').
//
// This module MEASURES and never enforces. Making the engine or the agent layer
// play the forced move would inject a decision the bot never reached on its own
// — the line the reverted "lowest seat on the team fails" convention crossed —
// and it would destroy the very signal we are reading. So a violation is
// recorded, reported, and left standing.
//
// Judged against what the seat COULD know, never against omniscience: knowledge
// comes from computeKnowledge, the engine's single producer of night-phase
// knowledge, so an unseen Oberon aboard can never make a teammate's reasonable
// play look like a blunder (and the visibility rule cannot drift away from the
// one the prompts are built on). The flip side is that a play can be recorded as
// forced-and-followed while still failing for reasons the seat could not see —
// that is the correct accounting for decision quality.

import { QUESTS_TO_WIN, computeKnowledge, failsRequired } from '../engine/rules.ts'
import type { GameArtifact } from './artifact.ts'
import type { Player, Role, Seat } from '../engine/types.ts'

export const FORCED_PLAY_RULES = {
  // Quest-card rules. The board is decisive and this seat held enough known
  // Fails aboard to act on it, so cover is worthless: the game ends either way.
  'match-point-success': "played Success on the quest whose success gives good its third, while holding enough known Fails aboard to sink it",
  'win-point-success': "played Success on the quest whose failure would have been evil's third and won the game",
  // Dominated regardless of board: a Fail below the quest's requirement sinks
  // nothing and advertises an evil aboard. Oberon is exempt by design — its role
  // guidance is to Fail every quest it reaches, since it cannot see a partner to
  // coordinate with and the extra card is how its teammates locate it.
  'wasted-lone-fail': 'played Fail on a quest needing more Fails than it knew were aboard, which cannot sink the quest and only leaks',
  // Vote rules, restricted to a decisive board so that the cover argument for
  // the other choice genuinely does not exist.
  'vote-reject-sinkable': 'voted to reject a team its own side could sink, on a board where that quest decided the game',
  'vote-approve-unsinkable': "voted to approve a team it knew of no way to fail, at good's match point",
} as const

export type ForcedPlayRule = keyof typeof FORCED_PLAY_RULES

export interface ForcedPlayViolation {
  seat: Seat
  name: string
  role: Role
  agent: string
  rule: ForcedPlayRule
  round: number
  seq: number   // the event that recorded the decision
  detail: string
}

export function forcedPlayViolations(a: GameArtifact): ForcedPlayViolation[] {
  const players = a.players as Player[]
  const out: ForcedPlayViolation[] = []

  // Seats each evil player can account for: itself plus the partners the deal
  // lets it see. Oberon sees nobody, and nobody sees Oberon.
  const visible = new Map<Seat, Set<Seat>>()
  for (const p of players) {
    if (p.alignment !== 'evil') continue
    const info = computeKnowledge(players, p.seat)
    visible.set(p.seat, new Set<Seat>([p.seat, ...(info.evilPartners ?? [])]))
  }
  const isEvil = (s: Seat) => players[s]?.alignment === 'evil'
  const knownAboard = (seat: Seat, team: readonly Seat[]) =>
    team.filter((s) => visible.get(seat)?.has(s)).length

  const record = (
    seat: Seat, rule: ForcedPlayRule, round: number, seq: number, detail: string,
  ) => {
    const p = a.players[seat]
    out.push({ seat, name: p.name, role: p.role, agent: p.agent, rule, round, seq, detail })
  }

  let successes = 0
  let fails = 0
  let team: Seat[] = []
  const cards = new Map<Seat, 'success' | 'fail'>()

  for (const ev of a.log) {
    const p = ev.payload as Record<string, any>
    switch (ev.type) {
      case 'proposal':
        team = (p.team as Seat[]).slice()
        break
      case 'proposalRevised':
        team = (p.to as Seat[]).slice()
        break
      case 'voteReveal': {
        team = ((p.team as Seat[]) ?? team).slice()
        const round = p.round as number
        const need = failsRequired(a.playerCount, round)
        const goodMatchPoint = successes === QUESTS_TO_WIN - 1
        const decisive = goodMatchPoint || fails === QUESTS_TO_WIN - 1
        for (const v of (p.votes as { seat: Seat; vote: string }[]) ?? []) {
          if (!isEvil(v.seat)) continue
          const n = knownAboard(v.seat, team)
          // The proposal's fate is part of the record: a reject that helped kill
          // your own winning team cost you the quest, while one the table
          // approved anyway cost nothing but the tell. Same count either way —
          // the decision was equally wrong — but a reader comparing agents needs
          // to see which it was.
          const math = `needed ${need} Fail${need === 1 ? '' : 's'}, knew of ${n} aboard;` +
            ` the proposal was ${p.approved ? 'approved anyway' : 'rejected'}`
          if (v.vote === 'reject' && n >= need && decisive) {
            record(v.seat, 'vote-reject-sinkable', round, ev.seq,
              `rejected Q${round} with the game on the line (${math})`)
          } else if (v.vote === 'approve' && n < need && goodMatchPoint) {
            record(v.seat, 'vote-approve-unsinkable', round, ev.seq,
              `approved Q${round}, good's third quest (${math})`)
          }
        }
        break
      }
      case 'questCard':
        cards.set(p.seat as Seat, p.card as 'success' | 'fail')
        break
      case 'questResult': {
        const round = p.round as number
        const need = p.failsRequired as number
        // A card is only judged against the outcome it was supposed to produce.
        // If the quest sank, no forced Fail was materially declined and no Fail
        // was wasted, so every card rule stands down — otherwise the detector
        // contradicts the artifact it is reading, and worse, punishes the play
        // EVIL_SHARED asks for: on a decisive one-Fail quest with two evil
        // aboard, exactly one should Fail and the other should cover, and the
        // coverer would be recorded as declining a forced play on a quest that
        // failed. Same shape when an unseen Oberon supplies the second Fail on
        // the two-Fail quest: the partner's card was needed, not wasted.
        if ((p.result as string) === 'success') {
          for (const seat of team) {
            if (!isEvil(seat)) continue
            const card = cards.get(seat)
            if (!card) continue // a redacted or partial log: nothing to judge
            const n = knownAboard(seat, team)
            const math = `needed ${need} Fail${need === 1 ? '' : 's'}, knew of ${n} aboard`
            if (card === 'success' && n >= need) {
              if (successes === QUESTS_TO_WIN - 1) {
                record(seat, 'match-point-success', round, ev.seq,
                  `Success on Q${round} handed good its third quest (${math})`)
              } else if (fails === QUESTS_TO_WIN - 1) {
                record(seat, 'win-point-success', round, ev.seq,
                  `Success on Q${round} passed up evil's winning third fail (${math})`)
              }
            } else if (card === 'fail' && n < need && players[seat].role !== 'oberon') {
              record(seat, 'wasted-lone-fail', round, ev.seq,
                `Fail on Q${round} could not sink it (${math})`)
            }
          }
        }
        cards.clear()
        if (p.result === 'success') successes++
        else fails++
        break
      }
    }
  }
  return out
}
