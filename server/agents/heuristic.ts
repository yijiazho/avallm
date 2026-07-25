// Rule-based agent, distilled from docs/research-strategy.md §5 (Bot Playbook).
// Doubles as the runtime fallback when any other agent fails, so the pure
// function form (heuristicDecide) is exported separately from the class.
//
// Stateless by design: every decision is derived fresh from the view. Seeded:
// same seed + same view => same decision (replay determinism).

import { makeRng, fnv1a } from '../engine/prng.ts'
import type { Rng } from '../engine/prng.ts'
import { knownEvilAboard, matchPoint } from './board.ts'
import type { Decision, DecisionRequest, PlayerView, Seat } from '../engine/types.ts'
import type { AgentContext, AvalonAgent } from './types.ts'

// ---- shared analysis helpers ----

function knownEvilSeats(view: PlayerView): Set<Seat> {
  const s = new Set<Seat>()
  if (view.alignment === 'evil') {
    s.add(view.seat)
    for (const p of view.privateInfo.evilPartners ?? []) s.add(p)
  }
  for (const p of view.privateInfo.knownEvil ?? []) s.add(p)
  return s
}

// Suspicion per seat, from public evidence + private knowledge.
function suspicion(view: PlayerView): number[] {
  const n = view.playerCount
  const score = new Array<number>(n).fill(0)
  const evil = knownEvilSeats(view)
  for (const s of evil) score[s] += 10
  for (const q of view.quests) {
    if (!q.team || q.result === undefined || q.failCount === undefined) continue
    for (const s of q.team) {
      if (s === view.seat) continue
      // A failed quest is hard evidence: weight it so burned players actually
      // get excluded (fail-count inference, strategy doc §1).
      if (q.result === 'fail') score[s] += 4 * (q.failCount / q.team.length)
      else score[s] -= 0.5
    }
  }
  // Vote-pattern inference (strategy doc: the vote matrix is the game's
  // primary text): who led and who approved the teams that went on to fail?
  for (const prop of view.proposals) {
    if (!prop.approved) continue
    const quest = view.quests[prop.round - 1]
    if (quest.result !== 'fail') continue
    if (prop.leader !== view.seat) score[prop.leader] += 1.5
    for (const v of prop.votes ?? []) {
      if (v.seat === view.seat || v.vote !== 'approve') continue
      if (!prop.team.includes(v.seat)) score[v.seat] += 0.4
    }
  }
  score[view.seat] = -100 // trust thyself
  return score
}

function rankBySuspicion(view: PlayerView): Seat[] {
  const s = suspicion(view)
  return view.players
    .map((p) => p.seat)
    .sort((a, b) => s[a] - s[b])
}

// ---- per-kind decisions ----

function decidePropose(view: PlayerView, rng: Rng): Decision {
  const size = view.quests[view.round - 1].teamSize
  const ranked = rankBySuspicion(view).filter((s) => s !== view.seat)
  const team: Seat[] = [view.seat]
  if (view.alignment === 'evil') {
    const partners = new Set(view.privateInfo.evilPartners ?? [])
    // A quest that needs TWO Fails needs two of US: one card sinks nothing
    // there, and a partner we can see is the only second Fail we can count on
    // (an Oberon is invisible to us, as we are to it, so a team that happens to
    // seat one is luck we cannot plan around). This replaces the look-clean
    // default for that quest rather than stacking with it (§7.3/§7.4 rule 3) —
    // the least suspicious partners, so the pair still reads as a normal team.
    const need = view.quests[view.round - 1].failsRequired
    team.push(...ranked.filter((s) => partners.has(s)).slice(0, Math.max(0, need - 1)))
    // The rest: the most trusted-looking non-partners.
    const clean = ranked.filter((s) => !partners.has(s))
    team.push(...clean.slice(0, Math.max(0, size - team.length)))
    // Backfill from partners if the table is small.
    for (const s of ranked) {
      if (team.length >= size) break
      if (!team.includes(s)) team.push(s)
    }
  } else {
    team.push(...ranked.slice(0, size - 1))
  }
  return { kind: 'propose', team: rng.shuffle(team) }
}

// Only proposals 1-4 are ever voted on: the 5th ("hammer") proposal is
// auto-approved by the engine, so no hammer logic is needed here.
function decideVote(view: PlayerView, rng: Rng): Decision {
  const team = view.currentTeam ?? []
  const evil = knownEvilSeats(view)
  const teamHasKnownEvil = team.some((s) => evil.has(s) && s !== view.seat)
  const selfOnTeam = team.includes(view.seat)

  if (view.alignment === 'evil') {
    // Forced plays first, before any cover reasoning (§7.4 rule 1). Both hinge
    // on the same question the cover instinct never asks: can the seats this
    // voter KNOWS about actually sink this quest? "One of ours is aboard" is not
    // "we can sink it" — Q4 at 7+ needs two Fails, so a lone teammate sinks
    // nothing and approving it just runs the quest.
    const failsNeeded = view.quests[view.round - 1].failsRequired
    const aboard = knownEvilAboard(view, team).length
    // Approve a team our side can sink: approval keeps the option, and the card
    // is a later, secret decision. Off a decisive board this is also the old
    // "any evil aboard => approve" default, since failsRequired is 1 there.
    if (aboard >= failsNeeded) return { kind: 'vote', vote: 'approve' }
    // Nothing aboard can sink it. At good's match point a success ends the quest
    // phase, so approving loses outright and the reject is the last lever —
    // worth the tell, which is why this REPLACES the blend-in default rather
    // than stacking with it (§7.4 rule 3).
    if (matchPoint(view).good) return { kind: 'vote', vote: 'reject' }
    // Undecided board: an unsinkable team still costs nothing to wave through
    // if a teammate is on it, and there are later rounds to recover in.
    if (aboard > 0) return { kind: 'vote', vote: 'approve' }
    return { kind: 'vote', vote: rng.chance(0.2) ? 'approve' : 'reject' }
  }

  // Good.
  if (teamHasKnownEvil) {
    // Merlin caps its accuracy: sometimes lets a bad team through as cover
    // (near-perfect voting is the assassin's #1 tell, strategy doc §3).
    const isMerlin = view.role === 'merlin'
    if (isMerlin && rng.chance(0.25)) return { kind: 'vote', vote: 'approve' }
    return { kind: 'vote', vote: 'reject' }
  }
  // Merlin also throws occasional wrong-way rejects on clean teams as cover.
  if (view.role === 'merlin' && rng.chance(0.15)) return { kind: 'vote', vote: 'reject' }
  if (view.round === 1) return { kind: 'vote', vote: 'approve' }
  const sus = suspicion(view)
  const worst = Math.max(...team.map((s) => sus[s]))
  if (worst >= 1.2) return { kind: 'vote', vote: 'reject' } // someone burned is on it
  if (selfOnTeam) return { kind: 'vote', vote: 'approve' }
  // Off-team: at small counts the evil bloc + one lenient good passes any
  // team, so good must default to rejecting teams it's not on (strategy doc
  // §1) unless every member is proven by a succeeded quest.
  if (worst < -0.3) return { kind: 'vote', vote: 'approve' }
  const p = view.playerCount <= 6 ? 0.25 : 0.4
  return { kind: 'vote', vote: rng.chance(p) ? 'approve' : 'reject' }
}

function decideQuest(view: PlayerView, seed: string): Decision {
  if (view.alignment === 'good') return { kind: 'quest', card: 'success' }

  const quest = view.quests[view.round - 1]
  const team = view.currentTeam ?? quest.team ?? []
  const need = quest.failsRequired
  const evilOnTeam = knownEvilAboard(view, team)

  // Forced play (§7.2): a Fail below the quest's requirement cannot sink it and
  // only advertises an evil aboard for free. Oberon is the named exception — it
  // cannot see a partner to coordinate with, so its own card is never the whole
  // story, and the extra Fail is how its unseen teammates locate it.
  if (evilOnTeam.length < need) {
    return { kind: 'quest', card: view.role === 'oberon' ? 'fail' : 'success' }
  }

  // Enough known Fails are aboard to sink it, so all that is left is who spends
  // a card, and when.

  // On a decisive board, everyone aboard spends one: the quest ends the game
  // either way, so a redundant Fail costs nothing — no later round exists for
  // the extra card to have leaked into — while holding one back bets the game on
  // a partner whose card you cannot see. The card-count leak is the only thing
  // the convention below is protecting, and here there is nothing left to leak.
  const mp = matchPoint(view)
  if (mp.good || mp.evil) return { kind: 'quest', card: 'fail' }

  // Undecided board: spend exactly the Fails the quest requires, taken from the
  // lowest known-evil seats aboard. At need = 1 that is the old "only the lowest
  // seat fails"; at need = 2 it is the pair that has to act together. (Oberon
  // only ever counts itself, so it is always designated.)
  const designated = new Set(evilOnTeam.slice().sort((a, b) => a - b).slice(0, need))
  if (!designated.has(view.seat)) return { kind: 'quest', card: 'success' }

  // Empirical fail rates (strategy doc appendix): tiny teams rarely fail early.
  let p: number
  if (team.length === 2) p = 0.15
  else if (view.round === 1) p = 0.4
  else p = 0.55
  // Keyed to the quest and team rather than the seat, so every designated seat
  // rolls the same number: on a two-Fail quest the pair either both play Fail or
  // both hold. A split roll would burn one card, sink nothing, and leak — the
  // wasted-lone-fail shape again, arrived at by two seats each playing a
  // defensible card. No out-of-band channel: the key is public board state.
  const roll = makeRng(fnv1a(`${seed}:quest:${view.round}:${[...team].sort().join(',')}`))
  return { kind: 'quest', card: roll.chance(p) ? 'fail' : 'success' }
}

function decideAssassinate(view: PlayerView, rng: Rng): Decision {
  // The strategy doc's #1 signal: vote accuracy. Score each candidate by how
  // often their vote matched the "correct" call given the assassin's knowledge.
  const evil = knownEvilSeats(view)
  const candidates = view.players.map((p) => p.seat).filter((s) => !evil.has(s))
  const score = new Map<Seat, number>(candidates.map((s) => [s, 0]))
  for (const prop of view.proposals) {
    if (!prop.votes) continue
    const teamHadEvil = prop.team.some((s) => evil.has(s))
    const correct = teamHadEvil ? 'reject' : 'approve'
    for (const v of prop.votes) {
      if (score.has(v.seat) && v.vote === correct) {
        score.set(v.seat, score.get(v.seat)! + 1)
      }
    }
  }
  let best: Seat[] = []
  let bestScore = -1
  for (const [s, sc] of score) {
    if (sc > bestScore) { bestScore = sc; best = [s] }
    else if (sc === bestScore) best.push(s)
  }
  return { kind: 'assassinate', target: best.length ? rng.pick(best) : rng.pick(candidates) }
}

function decideDiscuss(view: PlayerView, rng: Rng): Decision {
  // Lean: when a team is on the table, signal how we'd vote right now. The
  // leader never leans — their signals are the pitch and the finalize turn.
  const lean = view.currentTeam && view.leaderSeat !== view.seat
    ? (decideVote(view, rng) as { vote: 'approve' | 'reject' }).vote
    : undefined
  // Passing is natural, and later rounds are mostly for whoever still has
  // something to say.
  const passChance = (view.discussionRound ?? 1) >= 2 ? 0.75 : 0.3
  if (rng.chance(passChance)) return { kind: 'discuss', say: '', lean }
  const sus = suspicion(view)
  const nameOf = (s: Seat) => view.players[s].name

  if (view.alignment === 'evil') {
    // Blend in: cast vague doubt on a non-partner, or play it cool.
    const partners = knownEvilSeats(view)
    const marks = view.players.map((p) => p.seat).filter((s) => !partners.has(s))
    const lines = [
      `Something feels off about ${nameOf(rng.pick(marks))}.`,
      `I'm comfortable with how this is shaping up.`,
      `No strong reads from me yet.`,
    ]
    return { kind: 'discuss', say: rng.pick(lines), lean }
  }

  const ranked = view.players.map((p) => p.seat).filter((s) => s !== view.seat)
    .sort((a, b) => sus[b] - sus[a])
  const worst = ranked[0]
  const trusted = ranked[ranked.length - 1]
  if (sus[worst] > 1) {
    return { kind: 'discuss', say: `I don't trust ${nameOf(worst)}.`, lean }
  }
  const lines = [
    `I'd feel better with ${nameOf(trusted)} on this one.`,
    `Watch the votes closely this round.`,
    `No strong reads from me yet.`,
  ]
  return { kind: 'discuss', say: rng.pick(lines), lean }
}

// ---- entry points ----

export function heuristicDecide(
  req: DecisionRequest, view: PlayerView, seed: string,
): Decision {
  // Fresh RNG per decision, keyed by seed+seat+log position: deterministic
  // on replay, varied across a game.
  const rng = makeRng(fnv1a(`${seed}:${req.seat}:${view.events.length}:${req.kind}`))
  switch (req.kind) {
    case 'discuss': return decideDiscuss(view, rng)
    case 'propose': return decidePropose(view, rng)
    // The heuristic keeps its proposal: revision is a judgment about the
    // discussion, which the heuristic doesn't model.
    case 'finalize': return { kind: 'finalize', stick: true }
    case 'vote': return decideVote(view, rng)
    case 'quest': return decideQuest(view, seed)
    case 'assassinate': return decideAssassinate(view, rng)
  }
}

export function createHeuristicAgent(ctx: AgentContext): AvalonAgent {
  return {
    decide: async (req, view) => heuristicDecide(req, view, ctx.seed),
  }
}
