// Forced-play violations: the ground-truth half of "is our guidance actually
// being followed?" (docs/design-bot-guidance.md §7, docs/design-evaluation.md §3).
//
// A FORCED play is one that is correct deterministically, given the public board
// plus the deciding seat's own knowledge — no read of the table, no cover
// judgement, no probability. "Evil should usually put exactly one evil on the
// team" is not forced; "a lone Fail cannot sink a quest that needs two" is. Only
// the forced tier belongs here. Everything softer is a default with named
// exceptions, and grading it needs judgement, which is the LLM judge's job
// (INCIDENT_FAMILIES in judge.ts, notably 'blunder').
//
// This module MEASURES independently and never enforces. The raw-LLM baseline
// must not be corrected after it answers, because that would destroy the
// compliance signal. A composed policy may narrow legal candidates before a
// discretionary planner runs; that is an attributable policy choice, not an
// evaluator rewrite. Violations are always recorded from the artifact and left
// standing.
//
// Judged against what the seat COULD know, never against omniscience: knowledge
// comes from computeKnowledge, the engine's single producer of night-phase
// knowledge, so an unseen Oberon aboard can never make a teammate's reasonable
// play look like a blunder (and the visibility rule cannot drift away from the
// one the prompts are built on). The flip side is that a play can be recorded as
// forced-and-followed while still failing for reasons the seat could not see —
// that is the correct accounting for decision quality.

import { QUESTS_TO_WIN, failsRequired } from '../../engine/rules.ts'
import { computeKnowledge, evilPartnersOf } from '../../engine/knowledge.ts'
import { artifactPlayerAt, type GameArtifact } from '../core/artifact.ts'
import type { Player, Role, Seat } from '../../engine/types.ts'

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
  // Propose rule. An evil leader picks the roster outright, so at good's match
  // point it hands over the last team that will ever be picked, and a team with
  // no Fail it knows of ends the quest phase by construction.
  'propose-unsinkable': "led the team at good's match point and seated no Fail it knew of, when it had one to seat",
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
    visible.set(p.seat, new Set<Seat>([p.seat, ...evilPartnersOf(info)]))
  }
  const isEvil = (s: Seat) => players[s]?.alignment === 'evil'
  const knownAboard = (seat: Seat, team: readonly Seat[]) =>
    team.filter((s) => visible.get(seat)?.has(s)).length

  const record = (
    seat: Seat, rule: ForcedPlayRule, round: number, seq: number, detail: string,
  ) => {
    const p = artifactPlayerAt(a, seat)
    out.push({ seat, name: p.name, role: p.role, agent: p.agent, rule, round, seq, detail })
  }

  let successes = 0
  let fails = 0
  let team: Seat[] = []
  // Who owns the team that is currently on the table, and the event that put it
  // there, so a propose violation points at the proposal rather than at the
  // quest result where it is detected.
  let leader: Seat | undefined
  let leaderSeq = 0
  const cards = new Map<Seat, 'success' | 'fail'>()

  for (const ev of a.log) {
    const p = ev.payload as Record<string, any>
    switch (ev.type) {
      case 'proposal':
        team = (p.team as Seat[]).slice()
        leader = p.leader as Seat
        leaderSeq = ev.seq
        break
      case 'proposalRevised':
        team = (p.to as Seat[]).slice()
        leaderSeq = ev.seq
        break
      case 'proposalLocked':
        team = ((p.team as Seat[]) ?? team).slice()
        break
      case 'voteReveal': {
        team = ((p.team as Seat[]) ?? team).slice()
        const round = p.round as number
        const need = failsRequired(a.playerCount, round)
        const goodMatchPoint = successes === QUESTS_TO_WIN - 1
        const decisive = goodMatchPoint || fails === QUESTS_TO_WIN - 1
        // Engine rule (game.ts): strict majority approves, a tie rejects.
        const passes = (yes: number) => yes * 2 > a.playerCount
        const approvesBesides = (except: Seat) =>
          ((p.votes as { seat: Seat; vote: string }[]) ?? [])
            .filter((v) => v.seat !== except && v.vote === 'approve').length

        // Both rules below rest on one rationale: approval preserves the option
        // to sink the quest, and rejecting destroys it. That needs the vote to
        // be ABLE to preserve or destroy something, so each rule fires only when
        // this seat's ballot was actually pivotal.
        //
        // PIVOTALITY IS JUDGED AGAINST THE REVEALED TALLY, which is hindsight
        // relative to the voter. That is a deliberate change of standard. The
        // guards used to run off the leans seats declared during discussion, on
        // the theory that a blunder should be judged from what the seat could
        // see at the time. Leans are gone, and they were the wrong input anyway:
        // nothing bound a seat to the lean it declared, so evil could suppress a
        // true blunder call simply by declaring a reject it never intended to
        // cast. A deceivable input makes a detector that misses on purpose. The
        // revealed tally cannot be gamed after the fact, and the cost of the new
        // standard is narrow and stated: a reject that was reasonable when cast
        // and happened to be pivotal still reads as a blunder here.
        //
        // The false positive this replaces: a Morgana rejected a team her side
        // could sink at 2-2, with three rejects already declared on a
        // five-player table. Under pivotality she is cleared for the same
        // reason, because those rejects landed and her approve would not have
        // carried the team either.
        const approveCouldMatter = (seat: Seat) => passes(approvesBesides(seat) + 1)
        // Mirror for the approve rule, where the alternative was rejecting: if
        // the team carries without this seat, a reject saves nothing.
        const rejectCouldMatter = (seat: Seat) => !passes(approvesBesides(seat))

        for (const v of (p.votes as { seat: Seat; vote: string }[]) ?? []) {
          if (!isEvil(v.seat)) continue
          const n = knownAboard(v.seat, team)
          // The proposal's fate is still part of the record: a reject that helped
          // kill your own winning team cost you the quest, while one the table
          // approved anyway cost only the tell. Both are the same wrong decision
          // at the moment it was made, which is why both are counted, but a reader
          // comparing agents needs to see which it turned out to be.
          const math = `needed ${need} Fail${need === 1 ? '' : 's'}, knew of ${n} aboard;` +
            ` the proposal was ${p.approved ? 'approved anyway' : 'rejected'}`
          if (v.vote === 'reject' && n >= need && decisive && approveCouldMatter(v.seat)) {
            record(v.seat, 'vote-reject-sinkable', round, ev.seq,
              `rejected Q${round} with the game on the line (${math})`)
          } else if (v.vote === 'approve' && n < need && goodMatchPoint && rejectCouldMatter(v.seat)) {
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
            } else if (card === 'fail' && n < need && players[seat]!.role !== 'oberon') {
              record(seat, 'wasted-lone-fail', round, ev.seq,
                `Fail on Q${round} could not sink it (${math})`)
            }
          }
        }
        // The propose rule, judged here because this is where the team is final.
        // proposalLocked fires only when the leader sticks, a revise emits its
        // own event instead, and a table with no discussion phase produces
        // neither — but every played quest has a result. The violation is still
        // recorded against the proposal's seq, so it points at the decision.
        //
        // Judged on the DECISION rather than the outcome (see the module header):
        // an unseen Oberon that happens to sink the quest does not retroactively
        // make an unsinkable roster the right pick, because the leader could not
        // have been counting on a teammate the deal hides from it.
        if (leader !== undefined && isEvil(leader) && successes === QUESTS_TO_WIN - 1) {
          const pool = visible.get(leader)?.size ?? 0
          const n = knownAboard(leader, team)
          // Only forced when a sinkable team was buildable at all. On a two-Fail
          // quest with one visible partner, no roster the leader could name would
          // have met the requirement, so there was no forced play to miss.
          if (pool >= need && n < need) {
            record(leader, 'propose-unsinkable', round, leaderSeq,
              `led Q${round} at good's match point seating ${n} known Fail${n === 1 ? '' : 's'},` +
              ` needing ${need} to sink it, with ${pool} evil it could see`)
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
