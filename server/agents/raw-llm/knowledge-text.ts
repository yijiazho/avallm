// Private-knowledge rendering: the lines that state what THIS seat knows from
// the deal and from the resolved quest record, as prose it can reason over. The
// public-state renderers (publicStateText, transcriptText) stay in prompts.ts;
// this is the separable private-knowledge concern, so knowledgeText is its one
// export back into the prompt builder.
//
// Everything here is derived through the belief/situation chokepoints and stated
// as a settled deduction rather than left for the model to perform, because
// across observed games no bot spent these deductions on its own.

import { isCompletedQuest } from '../../engine/rules.ts'
import { evilPartnersOf } from '../../engine/knowledge.ts'
import { analyzeSituation } from '../analysis/situation.ts'
import { exactBelief } from '../belief/exact.ts'
import {
  compatibilityCertainties,
  type RoleCertainties,
} from '../communication/compat-certainties.ts'
import { questResultTag } from './facts.ts'
import { listOf, seatName } from './prompt-format.ts'
import type { Alignment, PlayerView, Role, Seat } from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'

// The deciding seat's own public vote-vs-outcome record over resolved quests: a
// vote "matches" when approve rode a success or reject rode a fail. Merlin, who
// votes on truth it alone can see, tends toward a SPOTLESS record — the Assassin's
// single clearest tell — yet is blind to how perfect it looks and keeps
// broadcasting it (playtest: assassinated after reading every evil correctly).
// Surfacing the count as a private fact lets the "throw a deliberate wrong vote"
// guidance in ROLE_GUIDANCE.merlin actually fire. The raw votes are already public
// (dossier), but the "this is YOUR tell" framing is Merlin-only, never handed to
// the table.
function ownVoteMatchRecord(view: PlayerView): { matches: number; total: number } {
  let matches = 0
  let total = 0
  for (const prop of view.proposals) {
    if (prop.outcome !== 'voted' || !prop.approved) continue
    const quest = view.quests[prop.round - 1]
    if (quest?.status !== 'complete') continue
    const mine = prop.votes.find((v) => v.seat === view.seat)
    if (!mine) continue
    total++
    if ((mine.vote === 'approve') === (quest.result === 'success')) matches++
  }
  return { matches, total }
}

// Role names as the table says them, so prompt prose reads like the rulebook.
const ROLE_LABEL: Record<Role, string> = {
  merlin: 'Merlin', percival: 'Percival', servant: 'a Loyal Servant',
  assassin: 'the Assassin', morgana: 'Morgana', mordred: 'Mordred',
  oberon: 'Oberon', minion: 'a Minion',
}

// Remove one copy of each named role, so a cast with two Servants keeps the
// second after the seat's own is taken out.
function without(roles: readonly Role[], ...remove: Role[]): Role[] {
  const out = [...roles]
  for (const r of remove) {
    const i = out.indexOf(r)
    if (i >= 0) out.splice(i, 1)
  }
  return out
}

// A role MULTISET as prose. Counts are kept rather than deduped: "a Loyal
// Servant, the Assassin and Oberon" for four seats silently loses a Servant, and
// a line that presents itself as a settled deduction cannot afford to be short
// one role.
function roleMultisetPhrase(roles: readonly Role[]): string {
  const counted = new Map<Role, number>()
  for (const r of roles) counted.set(r, (counted.get(r) ?? 0) + 1)
  return listOf([...counted].map(([r, n]) =>
    n > 1 ? `${n} ${ROLE_LABEL[r].replace(/^(an? |the )/, '')}s` : ROLE_LABEL[r]))
}

// What the OTHER seats hold. Pure restatement of two things the seat already has
// (the public role multiset and its own role), but stated as the deduction
// rather than left for the model to perform. A Servant that never works this out
// does not know a Merlin exists to protect, which is exactly how a loyal seat
// ends up publicly certifying the one player it should be blurring.
// `alsoPlaced` drops roles the seat has ALREADY located, so the line never
// re-offers a role as unknown one sentence after naming who holds it (a Percival
// with no Morgana is told which seat is Merlin, then must not be told Merlin is
// somewhere among the rest).
function compositionLine(view: PlayerView, alsoPlaced: Role[] = []): string {
  const rest = without(view.rolesInPlay, view.role, ...alsoPlaced)
  if (!rest.length) return ''
  return ` The other ${rest.length} seats hold ${roleMultisetPhrase(rest)}, in some order.`
}

// What the RESOLVED QUESTS added on top of the deal, and only that. The dossier
// has printed the arithmetic ("2 Fails, so at least 2 of these 4 are evil") since
// the start, and across every observed game no bot ever spent it as an
// elimination: one closing model had all three players on a quest it had watched
// fail reading good. So the elimination is computed in board.ts and stated here
// as a conclusion, since stating the premise plainly has already been tried.
//
// Kept separate from the deal lines above rather than merged into them. They are
// different KINDS of fact, and the difference decides whether the seat can say it
// out loud, which is the next sentence's whole job.
function recordLine(view: PlayerView, certain: RoleCertainties): string {
  const added = certain.fromRecord
  if (!added.length) return ''
  const side = (a: Alignment) => (a === 'evil' ? 'EVIL' : 'GOOD')
  // Two grammatical positions, so two renderers. `names X as EVIL` reads as a
  // verb taking an object; `X is EVIL` is a standalone claim. Using one string
  // for both produced "Quest 1 names P4 is EVIL".
  const named = (f: typeof added[number]) => seatName(view, f.seat)
  const asSide = (group: typeof added) => {
    const one = group[0]!.alignment
    return group.every((f) => f.alignment === one)
      ? `${listOf(group.map(named))} as ${side(one)}`
      : listOf(group.map((f) => `${named(f)} as ${side(f.alignment)}`))
  }
  const isSide = (group: typeof added) => {
    const one = group[0]!.alignment
    return group.every((f) => f.alignment === one)
      ? `${listOf(group.map(named))} ${group.length === 1 ? 'is' : 'are'} ${side(one)}`
      : listOf(group.map((f) => `${named(f)} is ${side(f.alignment)}`))
  }

  // One quest can force SEVERAL seats at once, whenever it took more Fails than
  // the rest of its team can account for. Rendering those seats one at a time
  // said "he is the only one left" about each of two players in the same
  // sentence, which is a flat contradiction and hit 929 of 2713 renders. So
  // group by the quest that forced them and let the count pick the wording.
  const byQuest = new Map<number, typeof added>()
  const derived: typeof added = []
  for (const f of added) {
    if (f.questNum === undefined) derived.push(f)
    else byQuest.set(f.questNum, [...(byQuest.get(f.questNum) ?? []), f])
  }

  // The REASON is stated once and then applied, rather than repeated per seat.
  // Repeating it put the same clause in the sentence as many times as the record
  // had closed seats (an Oberon, who has no partner list to work from, reached
  // six), which is both bloat in a budget that is already contested and two
  // absolute-sounding claims a model has to notice are separately scoped.
  const groups = [...byQuest].sort((a, b) => a[0] - b[0])
  const singles = groups.filter(([, g]) => g.length === 1)
  const multis = groups.filter(([, g]) => g.length > 1)

  const parts: string[] = []
  if (singles.length) {
    parts.push(`A quest that failed while every other player on it is one you can already place names the player you cannot:`
      + ` ${singles.map(([num, g]) => `Quest ${num} names ${asSide(g)}`).join('; ')}.`)
  }
  for (const [num, g] of multis) {
    parts.push(`Quest ${num} took more Fails than the rest of its team can account for, which names ${asSide(g)}.`)
  }
  // Budget deductions are consequences of the quest ones, so they follow them.
  // The old wording pointed at "the seats above" while fromRecord is in seat
  // order, which could put it first with nothing above it to follow from.
  if (derived.length) {
    parts.push(parts.length
      ? `${isSide(derived)}, which follows once those seats are placed.`
      : `${isSide(derived)}, which the resolved quests now force.`)
  }

  return ` The quest record has since settled ${added.length === 1 ? 'one more seat' : `${added.length} more seats`}`
    + ` that the deal alone left open. ${parts.join(' ')}`
    + ` Whether you can say that out loud depends on the premise it rests on: if it rests on a quest you sat on yourself,`
    + ` the table can follow the same steps, and if it rests on who you were shown at the deal, showing the working shows what you are.`
}

export function knowledgeText(
  view: PlayerView,
  suppliedBelief?: BeliefSnapshot,
): string {
  const belief = suppliedBelief ?? exactBelief(view)
  const analysis = analyzeSituation(view, { belief })
  const certainty = compatibilityCertainties(view, belief, analysis)
  return dealKnowledgeText(view, certainty) + recordLine(view, certainty)
}

// Both private lists below are COMPLETE unless one specific role is dealt, and
// that role is named in the rules. So when it is absent, the list closes and the
// complement is certain; when it is present, the gap is exactly one known role
// rather than general doubt. Stating the counterfactual unconditionally, which
// is what these lines used to do, put a role at the table in every game: a
// Morgana in a no-Oberon deal twice wrote a seat off as "likely evil or Oberon"
// at 75% and 80%, a proposition its own partner list refutes.
//
// Certainty is more dangerous to say out loud than doubt was, so every branch
// that closes a deduction also carries the gag. Merlin's may name the Assassin
// because knownEvil is Merlin-only and the lattice makes Assassin implied.
function dealKnowledgeText(
  view: PlayerView,
  certain: RoleCertainties,
): string {
  const info = view.privateInfo
  const named = (seats: readonly Seat[]) => seats.map((s) => seatName(view, s)).join(', ')

  if (info.kind === 'merlin') {
    const gap = view.rolesInPlay.includes('mordred')
      ? ` Mordred is dealt, and they are the one evil hidden from you, so exactly one more evil sits among the others.`
      : ` That list is the whole of evil, so every other seat is good: ${named(certain.knownGood)}. It is settled, not a read you are still forming.`
    const base = `You see these players as EVIL: ${named(info.knownEvil)}.${gap}` +
      ` Never say it, and never argue from a confidence only your sight could explain, because that is what the Assassin is hunting for.`
    // Flag a spotless streak (>=2 resolved, every vote matched) — the point where
    // the record becomes a live tell. A single off vote gives cover, so don't nag.
    const { matches, total } = ownVoteMatchRecord(view)
    return total >= 2 && matches === total
      ? `${base} So far every public vote you have cast on a resolved quest has matched its outcome (${total} of ${total}): a spotless record the whole table can see.`
      : base
  }
  if (view.alignment === 'evil') {
    const evilPartners = evilPartnersOf(info)
    if (!evilPartners.length) {
      return `You are evil, but your fellow evil are unknown to you (and they do not know you).${compositionLine(view)}`
    }
    const gap = view.rolesInPlay.includes('oberon')
      ? ` An Oberon is dealt, and they are hidden from their own side, so one more evil may be riding along unseen.`
      : ` Evil is exactly you and them, so every other seat is good: ${named(certain.knownGood)}.`
    // Evil shares one win condition after three successes, so the Merlin pool is
    // the Assassin's shortlist from the deal rather than a puzzle to open at the
    // end. Gated on the seat being able to PROVE the pool: with an Oberon dealt
    // the partner list is incomplete, so "candidates" would be a guess dressed as
    // a deduction, and naming the unseen teammate among them is a read this seat
    // has not earned (prompts.ts contract: evil do not see Oberon).
    const hunt = certain.alignmentComplete && certain.merlinCandidates.length
      ? ` Merlin is one of ${named(certain.merlinCandidates)}, and nothing narrows that but their play.`
      : ''
    return `Your fellow EVIL players: ${named(evilPartners)}.${gap}${hunt}`
  }
  if (info.kind === 'percival') {
    const pair = info.merlinCandidates
    // Percival's "pair" is only a pair when a Morgana was dealt to fill it. The
    // picker allows Percival without Morgana (his own candidate list is then just
    // Merlin), and the paired prose read "one of these two is Merlin" while
    // naming a single player. He simply sees Merlin, so say that.
    if (pair.length === 1) {
      return `${seatName(view, pair[0]!)} is Merlin, and you know it outright: there is no second candidate to confuse you.` +
        ` Guard that hard. Naming them, or defending them more than anyone else would, paints the Assassin's target on the one player good cannot afford to lose.` +
        compositionLine(view, ['merlin'])
    }
    const onQuestsFor = (s: Seat) => view.quests.filter(isCompletedQuest).filter((q) => q.team.includes(s))
    // Naming the pair also settles the seats OUTSIDE it: Merlin and Morgana are
    // unique and both are accounted for, so whatever the cast has left belongs to
    // the others. At the standard 5 that leaves the Assassin and one Servant,
    // which reduces Percival's whole game to two binary questions. Nothing told
    // him this before, and no observed Percival worked it out.
    const outside = certain.seats.filter((s) => s.seat !== view.seat && !pair.includes(s.seat))
    // The residual comes off the CAST, not off a union of the outside seats'
    // possible roles: a union collapses duplicates, so at 7 players the four
    // remaining seats would be credited with "a Loyal Servant, the Assassin and
    // Oberon" and one Servant would vanish. The pair holds Merlin and Morgana
    // between them (this branch only runs when both are dealt), so removing them
    // and this seat's own role leaves exactly what the others hold.
    const residual = without(view.rolesInPlay, view.role, 'merlin', 'morgana')
    const restLine = outside.length && residual.length === outside.length
      ? ` That also settles the rest: ${listOf(outside.map((s) => seatName(view, s.seat)))} hold ${roleMultisetPhrase(residual)} between them.`
      : ''
    // Nothing has resolved yet, so there is no quest record to compare — just name
    // the pair. (The guard fires only when NEITHER candidate has been on a resolved
    // quest; once either has, we show records — successes included, as weak evidence.)
    if (!pair.some((s) => onQuestsFor(s).length > 0)) {
      return `One of these two is Merlin, the other is Morgana: ${pair.map((s) => seatName(view, s)).join(' and ')}.${restLine}`
    }
    // Co-locate each candidate's PUBLIC quest record with the private fact that
    // these two ARE the Merlin/Morgana pair, so telling them apart is a single
    // side-by-side read rather than a cross-reference into the dossier — which
    // Percival keeps getting inverted even with all the data present but scattered
    // (playtest: trusted the Morgana who sat on every failed quest). The heuristic
    // itself (a FAIL a candidate sat on marks Morgana; weight it over talk) stays
    // in ROLE_GUIDANCE.percival; this line is just the paired evidence it needs.
    const recordFor = (s: Seat) => {
      const on = onQuestsFor(s)
      return on.length ? on.map((q) => questResultTag(q.num, q.result === 'fail')).join(', ') : 'no quests yet'
    }
    return `One of these two is Merlin, the other is Morgana. Their quest records so far, side by side: ${pair.map((s) => `${seatName(view, s)}: ${recordFor(s)}`).join('; ')}.${restLine}`
  }
  return `You have no special knowledge. Only your own loyalty is certain to you.${compositionLine(view)}`
}
