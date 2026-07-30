// Programmatic behavioral metrics over game artifacts
// (docs/design-evaluation.md §3). Pure functions, zero LLM cost. These are
// the unfakeable half of the eval signal — the judge's scores are advisory,
// these are ground truth.
//
// Conspicuousness: how truth-aligned each player's public discrimination was
// (votes vs. ground-truth evil on the team). Merlin should NOT be the
// top-ranked good player — a Merlin whose public record out-discriminates
// every servant is telegraphing private knowledge (the motivating incident:
// a Merlin declaring "no trust X" every turn about a hidden evil).
// Speech-content accusations are deliberately out of scope here: that
// analysis needs judgment, so it belongs to the judge.

import { buildLedger } from './ledger.ts'
import { forcedPlayViolations } from './forced.ts'
import type { Ledger } from './ledger.ts'
import type { GameArtifact } from './artifact.ts'
import type { ForcedPlayViolation } from './forced.ts'
import type { Alignment, Role, Seat } from '../engine/types.ts'

export interface SeatMetrics {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  agent: string
  won: boolean
  votes: number            // revealed votes cast (hammer auto-approvals have none)
  voteScore: number | null // fraction of votes matching ground truth: reject iff team contains evil
  utterances: number       // non-empty says
  passes: number           // empty says
  silentContradictions: number // ledger flags: passed while owing a reaction
  forcedPlayViolations: number // declined a deterministically-correct move (forced.ts)
}

export interface GameMetrics {
  id: string
  seed: string
  tags?: Record<string, string>
  winner: Alignment
  winReason: string
  degradedCount: number
  seats: SeatMetrics[]
  // Every forced play declined this game, with the seat, rule, and the Fail math
  // that made it forced. Per-seat counts live on SeatMetrics; this is the detail
  // a report or a prompt post-mortem reads.
  forcedPlays: ForcedPlayViolation[]
  merlin?: {
    seat: Seat
    agent: string
    voteScore: number | null
    // Rank of Merlin's voteScore among good players (1 = most truth-aligned =
    // most conspicuous). null when Merlin cast no revealed votes.
    conspicuousnessRank: number | null
    goodPlayers: number
    assassinated: boolean | null // null: game never reached assassination
    virtualAssassinRate: number | null // probe hit rate, null if not probed
  }
  assassination?: { assassin: Seat; target: Seat; wasMerlin: boolean }
  // Discussion wind-down + finalize outcomes (schema >= 3 flow): the tuning
  // signal for discussion pacing and how often the leader actually revises.
  discussion?: {
    segments: number    // discussion segments with at least one round of talk
    roundsTotal: number
    finalizes: number   // leader stick-or-change turns taken
    revised: number     // ... of which changed the team
  }
  judge?: {
    model: string
    blindedMerlinCorrect: boolean
    blindedEvilCorrect: number
    incidents: { seat: Seat; family: string }[]
  }
}

export function computeMetrics(a: GameArtifact): GameMetrics {
  const isEvil = (s: Seat) => a.players[s].alignment === 'evil'
  const teamHasEvil = (team: Seat[]) => team.some(isEvil)

  const votes = new Map<Seat, { n: number; correct: number }>()
  const talk = new Map<Seat, { utterances: number; passes: number }>()
  for (const p of a.players) {
    votes.set(p.seat, { n: 0, correct: 0 })
    talk.set(p.seat, { utterances: 0, passes: 0 })
  }

  let assassination: GameMetrics['assassination']

  for (const ev of a.log) {
    if (ev.visibility !== 'public') continue
    const p = ev.payload
    switch (ev.type) {
      case 'utterance': {
        const seat = p.seat as Seat
        const t = talk.get(seat)!
        if (((p.text as string) ?? '').trim() === '') t.passes++
        else t.utterances++
        break
      }
      case 'voteReveal': {
        const team = (p.team as Seat[]) ?? []
        for (const v of (p.votes as { seat: Seat; vote: string }[]) ?? []) {
          const e = votes.get(v.seat)!
          e.n++
          if ((v.vote === 'reject') === teamHasEvil(team)) e.correct++
        }
        break
      }
      case 'assassination':
        assassination = {
          assassin: p.assassin as Seat,
          target: p.target as Seat,
          wasMerlin: p.wasMerlin as boolean,
        }
        break
    }
  }

  // Segment accounting: a segment opens at proposal/proposalRevised and closes
  // at the next finalize event or voteReveal. Rounds come from the max
  // utterance round seen (0-round segments — e.g. maxRounds 0 — are not
  // counted).
  let discussion: GameMetrics['discussion']
  if (a.schema >= 3) {
    const talkCfg = a.talk as { maxRounds?: number; maxRoundsAfterChange?: number }
    const acc = { segments: 0, roundsTotal: 0, finalizes: 0, revised: 0 }
    let open = false
    let segRounds = 0
    const close = () => {
      if (!open) return
      open = false
      if (segRounds === 0) return
      acc.segments++
      acc.roundsTotal += segRounds
    }
    for (const ev of a.log) {
      if (ev.visibility !== 'public') continue
      const p = ev.payload
      if (ev.type === 'proposal') {
        close(); open = true; segRounds = 0
      } else if (ev.type === 'utterance') {
        if (open) segRounds = Math.max(segRounds, (p.round as number) ?? 1)
      } else if (ev.type === 'proposalLocked') {
        close(); acc.finalizes++
      } else if (ev.type === 'proposalRevised') {
        close(); acc.finalizes++; acc.revised++
        open = true; segRounds = 0
      } else if (ev.type === 'voteReveal') {
        close()
      }
    }
    close()
    if (acc.segments || acc.finalizes) discussion = acc
  }

  const ledger: Ledger = buildLedger(a.log)
  const silentBySeat = new Map<Seat, number>()
  for (const f of ledger.silentAfterContradiction) {
    silentBySeat.set(f.seat, (silentBySeat.get(f.seat) ?? 0) + 1)
  }

  // Forced plays: deterministically-correct moves the seat declined (forced.ts).
  // Ground truth like the vote scores, not an opinion like the judge's families.
  const forcedPlays = forcedPlayViolations(a)
  const forcedBySeat = new Map<Seat, number>()
  for (const v of forcedPlays) forcedBySeat.set(v.seat, (forcedBySeat.get(v.seat) ?? 0) + 1)

  const score = (e: { n: number; correct: number }) => (e.n ? e.correct / e.n : null)
  const seats: SeatMetrics[] = a.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    role: p.role,
    alignment: p.alignment,
    agent: p.agent,
    won: p.alignment === a.winner,
    votes: votes.get(p.seat)!.n,
    voteScore: score(votes.get(p.seat)!),
    utterances: talk.get(p.seat)!.utterances,
    passes: talk.get(p.seat)!.passes,
    silentContradictions: silentBySeat.get(p.seat) ?? 0,
    forcedPlayViolations: forcedBySeat.get(p.seat) ?? 0,
  }))

  let merlin: GameMetrics['merlin']
  const m = seats.find((s) => s.role === 'merlin')
  if (m) {
    const good = seats.filter((s) => s.alignment === 'good')
    // Midrank, so ties don't read as unique conspicuousness: with small-
    // denominator vote fractions, several good players often tie Merlin's
    // score. Strict-greater ranking would put a 3-way top tie at rank 1
    // ("most conspicuous") for all three; averaging over the tie gives rank 2,
    // correctly showing Merlin is NOT uniquely the most truth-aligned.
    const scored = good.filter((s) => s.voteScore !== null)
    const above = scored.filter((s) => s.voteScore! > m.voteScore!).length
    const tied = scored.filter((s) => s.voteScore === m.voteScore).length // includes Merlin
    const rank = m.voteScore === null ? null : above + (tied + 1) / 2
    merlin = {
      seat: m.seat,
      agent: m.agent,
      voteScore: m.voteScore,
      conspicuousnessRank: rank,
      goodPlayers: good.length,
      assassinated: assassination ? assassination.wasMerlin : null,
      virtualAssassinRate: a.probes?.virtualAssassin?.hitRate ?? null,
    }
  }

  const judge = a.judge
    ? {
        model: a.judge.model,
        blindedMerlinCorrect: a.judge.blinded.merlinCorrect,
        blindedEvilCorrect: a.judge.blinded.evilCorrect,
        incidents: a.judge.incidents.map((i) => ({ seat: i.seat as Seat, family: i.family })),
      }
    : undefined

  return {
    id: a.id,
    seed: a.seed,
    ...(a.tags ? { tags: a.tags } : {}),
    winner: a.winner,
    winReason: a.winReason,
    degradedCount: a.degraded.length,
    seats,
    forcedPlays,
    ...(merlin ? { merlin } : {}),
    ...(assassination ? { assassination } : {}),
    ...(discussion ? { discussion } : {}),
    ...(judge ? { judge } : {}),
  }
}
