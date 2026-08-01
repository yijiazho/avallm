// Rule-based agent, distilled from docs/research-strategy.md §5 (Bot Playbook).
// This pure policy is shared by the selectable heuristic agent and every
// fallback path.
//
// Stateless by design: every decision is derived fresh from the view. Seeded:
// same seed + same view => same decision (replay determinism).

import { makeRng, fnv1a } from '../../shared/prng.ts'
import type { Rng } from '../../shared/prng.ts'
import { evilPartnersOf, knownEvilOf } from '../../engine/knowledge.ts'
import { proposalApproved, proposalVotes } from '../../engine/rules.ts'
import type { Decision, DecisionRequest, PlayerView, Seat } from '../../engine/types.ts'
import { analyzeSituation } from '../analysis/situation.ts'
import type { SituationAnalysis } from '../analysis/situation-types.ts'
import { reconstructCognition } from '../cognition/state.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  legalCandidates,
} from '../candidate/candidates.ts'
import { applyForcedPolicy, forcedVoteChoice } from './forced.ts'
import type { PolicyCandidate } from '../candidate/types.ts'

// ---- shared analysis helpers ----

function knownEvilSeats(view: PlayerView): Set<Seat> {
  const s = new Set<Seat>()
  if (view.alignment === 'evil') {
    s.add(view.seat)
    for (const p of evilPartnersOf(view.privateInfo)) s.add(p)
  }
  for (const p of knownEvilOf(view.privateInfo)) s.add(p)
  return s
}

// Suspicion per seat, from public evidence + private knowledge.
function suspicion(view: PlayerView): number[] {
  const n = view.playerCount
  const score = new Array<number>(n).fill(0)
  const evil = knownEvilSeats(view)
  for (const s of evil) score[s]! += 10
  for (const q of view.quests) {
    if (q.status !== 'complete') continue
    for (const s of q.team) {
      if (s === view.seat) continue
      // A failed quest is hard evidence: weight it so burned players actually
      // get excluded (fail-count inference, strategy doc §1).
      if (q.result === 'fail') score[s]! += 4 * (q.failCount / q.team.length)
      else score[s]! -= 0.5
    }
  }
  // Vote-pattern inference (strategy doc: the vote matrix is the game's
  // primary text): who led and who approved the teams that went on to fail?
  for (const prop of view.proposals) {
    if (!proposalApproved(prop)) continue
    const quest = view.quests[prop.round - 1]!
    if (quest.status !== 'complete' || quest.result !== 'fail') continue
    if (prop.leader !== view.seat) score[prop.leader]! += 1.5
    for (const v of proposalVotes(prop)) {
      if (v.seat === view.seat || v.vote !== 'approve') continue
      if (!prop.team.includes(v.seat)) score[v.seat]! += 0.4
    }
  }
  score[view.seat] = -100 // trust thyself
  return score
}

function rankBySuspicion(view: PlayerView): Seat[] {
  const s = suspicion(view)
  return view.players
    .map((p) => p.seat)
    .sort((a, b) => s[a]! - s[b]!)
}

// ---- per-kind decisions ----

function decidePropose(view: PlayerView, rng: Rng): Decision {
  const size = view.quests[view.round - 1]!.teamSize
  const ranked = rankBySuspicion(view).filter((s) => s !== view.seat)
  const team: Seat[] = [view.seat]
  if (view.alignment === 'evil') {
    const partners = new Set(evilPartnersOf(view.privateInfo))
    // A quest that needs TWO Fails needs two of US: one card sinks nothing
    // there, and a partner we can see is the only second Fail we can count on
    // (an Oberon is invisible to us, as we are to it, so a team that happens to
    // seat one is luck we cannot plan around). This replaces the look-clean
    // default for that quest rather than stacking with it (§7.3/§7.4 rule 3) —
    // the least suspicious partners, so the pair still reads as a normal team.
    const need = view.quests[view.round - 1]!.failsRequired
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
function decideVote(
  view: PlayerView,
  rng: Rng,
  analysis: SituationAnalysis,
): Extract<Decision, { kind: 'vote' }> {
  const team = view.currentTeam ?? []
  const evil = knownEvilSeats(view)
  const teamHasKnownEvil = team.some((s) => evil.has(s) && s !== view.seat)
  const selfOnTeam = team.includes(view.seat)

  if (view.alignment === 'evil') {
    // Decisive-board votes were already selected by forced-policy-v1. The
    // remaining default asks whether the seats this voter knows can sink the
    // quest; Q4 at 7+ needs two Fails, so one known evil is insufficient.
    const failsNeeded = analysis.failsRequired
    const aboard = analysis.currentTeam?.knownFailsAboard.length ?? 0
    // Approve a team our side can sink: approval keeps the option, and the card
    // is a later, secret decision. Off a decisive board this is also the old
    // "any evil aboard => approve" default, since failsRequired is 1 there.
    if (aboard >= failsNeeded) return { kind: 'vote', vote: 'approve' }
    // forced-policy-v1 used to stand down here when declared leans made the
    // vote immaterial. Leans are gone, so it no longer does; this branch keeps
    // the compatibility policy's historical choice.
    if (analysis.matchPoint.good) return { kind: 'vote', vote: 'reject' }
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
  const worst = Math.max(...team.map((s) => sus[s]!))
  if (worst >= 1.2) return { kind: 'vote', vote: 'reject' } // someone burned is on it
  if (selfOnTeam) return { kind: 'vote', vote: 'approve' }
  // Off-team: at small counts the evil bloc + one lenient good passes any
  // team, so good must default to rejecting teams it's not on (strategy doc
  // §1) unless every member is proven by a succeeded quest.
  if (worst < -0.3) return { kind: 'vote', vote: 'approve' }
  const p = view.playerCount <= 6 ? 0.25 : 0.4
  return { kind: 'vote', vote: rng.chance(p) ? 'approve' : 'reject' }
}

function decideQuest(
  view: PlayerView,
  seed: string,
  analysis: SituationAnalysis,
): Decision {
  const team = view.currentTeam ?? []
  const need = analysis.failsRequired
  const evilOnTeam = [...(analysis.currentTeam?.knownFailsAboard ?? [])]

  // Only Oberon reaches this branch below the requirement: forced-policy-v1
  // already selected Success for evil seats with normal partner knowledge.
  // Oberon's extra Fail is how unseen teammates may locate it.
  if (evilOnTeam.length < need) {
    return { kind: 'quest', card: 'fail' }
  }

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
    if (prop.outcome !== 'voted') continue
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

function decideDiscuss(
  view: PlayerView,
  rng: Rng,
  analysis: SituationAnalysis,
): Decision {
  // Speech is the only channel for a position on the team, so when one is on
  // the table the fallback says where it stands out loud rather than leaving
  // the table nothing to read. The leader is excluded: their pitch already
  // argued for this team and the finalize turn closes it.
  const stance = view.currentTeam && view.leaderSeat !== view.seat
    ? (
        forcedVoteChoice(view, analysis)?.decision
        ?? decideVote(view, rng, analysis)
      ).vote
    : undefined
  // Passing is natural, and later rounds are mostly for whoever still has
  // something to say.
  const passChance = (view.discussionRound ?? 1) >= 2 ? 0.75 : 0.3
  if (rng.chance(passChance)) return { kind: 'discuss', say: '' }
  const sus = suspicion(view)
  const nameOf = (s: Seat) => view.players[s]!.name
  const stanceLines = stance === 'approve'
    ? [`This team works for me.`, `I'm good with this one.`]
    : stance === 'reject'
      ? [`I don't like this team.`, `I'd rather see a different three.`]
      : []
  // Half the time the stance carries the turn on its own; otherwise it gives
  // way to a read, which is the more interesting thing to say.
  if (stanceLines.length && rng.chance(0.5)) {
    return { kind: 'discuss', say: rng.pick(stanceLines) }
  }

  if (view.alignment === 'evil') {
    // Blend in: cast vague doubt on a non-partner, or play it cool.
    const partners = knownEvilSeats(view)
    const marks = view.players.map((p) => p.seat).filter((s) => !partners.has(s))
    const lines = [
      `Something feels off about ${nameOf(rng.pick(marks))}.`,
      `I'm comfortable with how this is shaping up.`,
      `No strong reads from me yet.`,
    ]
    return { kind: 'discuss', say: rng.pick(lines) }
  }

  const ranked = view.players.map((p) => p.seat).filter((s) => s !== view.seat)
    .sort((a, b) => sus[b]! - sus[a]!)
  const worst = ranked[0]!
  const trusted = ranked[ranked.length - 1]!
  if (sus[worst]! > 1) {
    return { kind: 'discuss', say: `I don't trust ${nameOf(worst)}.` }
  }
  const lines = [
    `I'd feel better with ${nameOf(trusted)} on this one.`,
    `Watch the votes closely this round.`,
    `No strong reads from me yet.`,
  ]
  return { kind: 'discuss', say: rng.pick(lines) }
}

// ---- entry points ----

export function heuristicDecide(
  req: DecisionRequest, view: PlayerView, seed: string,
): Decision {
  // Fresh RNG per decision, keyed by seed+seat+log position: deterministic
  // on replay, varied across a game.
  const rng = makeRng(fnv1a(`${seed}:${req.seat}:${view.events.length}:${req.kind}`))
  const candidates = legalCandidates(req, view)
  const cognition = reconstructCognition(view)
  const analysis = analyzeSituation(view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    policyCandidateTeams: candidateTeams(candidates, view),
  })
  const forced = applyForcedPolicy(req, view, analysis, candidates)
  if (forced.selectedCandidateId) {
    return candidateById(candidates, forced.selectedCandidateId).decision
  }

  let preferred: Decision
  switch (req.kind) {
    case 'discuss': preferred = decideDiscuss(view, rng, analysis); break
    case 'propose': preferred = decidePropose(view, rng); break
    // The heuristic keeps its proposal: revision is a judgment about the
    // discussion, which the heuristic doesn't model.
    case 'finalize': preferred = { kind: 'finalize', stick: true }; break
    case 'vote': preferred = decideVote(view, rng, analysis); break
    case 'quest': preferred = decideQuest(view, seed, analysis); break
    case 'assassinate': preferred = decideAssassinate(view, rng); break
  }
  const preferredId = candidateIdForDecision(preferred)
  if (
    candidates.some((candidate) => candidate.id === preferredId)
    && forced.allowedCandidateIds.includes(preferredId)
  ) {
    // Preserve seeded team order and discussion prose after proving the
    // decision names a surviving legal candidate.
    return preferred
  }
  return candidateById(candidates, forced.allowedCandidateIds[0]!).decision
}

function candidateById(
  candidates: readonly PolicyCandidate[],
  id: string,
): PolicyCandidate {
  const found = candidates.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`policy selected absent candidate ${id}`)
  return found
}
