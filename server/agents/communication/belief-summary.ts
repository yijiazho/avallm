import type { PlayerView, Seat } from '../../engine/types.ts'
import type { BeliefSnapshot, TeamAssessment } from '../belief/types.ts'
import type { SituationAnalysis } from '../analysis/situation-types.ts'

export const BELIEF_RENDERER_VERSION = 'compact-belief-v1'

const percent = (value: number, uncertain = false): string => {
  let shown = Math.round(value * 1000) / 10
  if (uncertain && value > 0 && shown === 0) shown = 0.1
  if (uncertain && value < 1 && shown === 100) shown = 99.9
  return `${shown.toFixed(shown % 1 === 0 ? 0 : 1)}%`
}

const names = (view: PlayerView, seats: readonly Seat[]): string =>
  seats.length
    ? seats.map((seat) => `${view.players[seat].name}(seat ${seat})`).join(', ')
    : 'none'

function probabilitySemantics(snapshot: BeliefSnapshot): string {
  switch (snapshot.quality) {
    case 'weighted':
      return 'weighted probability'
    case 'degraded':
      return 'degraded fallback share'
    case 'constraints-only':
      return 'uniform share of feasible hypotheses'
  }
}

function teamLine(
  view: PlayerView,
  assessment: TeamAssessment,
  label: string,
  probabilitySemantics: string,
): string {
  const possible = assessment.evilCountDistribution
    .map((share, evil) => ({ evil, share }))
    .filter(({ share }) => share > 0)
    .map(({ evil, share }) =>
      `${evil} evil: ${percent(share, share > 0 && share < 1)}`)
    .join(', ')
  return `${label} [${names(view, assessment.team)}] | clean ${probabilitySemantics}: `
    + `${percent(
      assessment.cleanProbability,
      assessment.cleanProbability > 0 && assessment.cleanProbability < 1,
    )} | evil-count possibilities: ${possible}`
}

interface AlignmentHypothesis {
  key: string
  evil: readonly Seat[]
  probability: number
}

function topAlignmentHypotheses(
  snapshot: BeliefSnapshot,
  limit: number,
): readonly AlignmentHypothesis[] {
  const grouped = new Map<string, AlignmentHypothesis>()
  for (const weighted of snapshot.worlds) {
    const evil = weighted.world.alignmentBySeat
      .map((alignment, seat) => ({ alignment, seat }))
      .filter(({ alignment }) => alignment === 'evil')
      .map(({ seat }) => seat)
    const key = evil.join(',')
    const prior = grouped.get(key)
    grouped.set(key, {
      key,
      evil,
      probability: (prior?.probability ?? 0) + weighted.probability,
    })
  }
  return [...grouped.values()]
    .sort((a, b) => b.probability - a.probability || a.key.localeCompare(b.key))
    .slice(0, limit)
}

function exactOnePairs(
  snapshot: BeliefSnapshot,
  unresolved: readonly Seat[],
  limit: number,
): readonly [Seat, Seat][] {
  const pairs: [Seat, Seat][] = []
  for (let left = 0; left < unresolved.length; left++) {
    for (let right = left + 1; right < unresolved.length; right++) {
      const a = unresolved[left]
      const b = unresolved[right]
      if (snapshot.worlds.every((weighted) => {
        const world = weighted.world
        const count = Number(world.alignmentBySeat[a] === 'evil')
          + Number(world.alignmentBySeat[b] === 'evil')
        return count === 1
      })) {
        pairs.push([a, b])
        if (pairs.length >= limit) return pairs
      }
    }
  }
  return pairs
}

/**
 * Deterministic prompt/offline renderer. It labels each snapshot with the
 * semantics of its quality: a uniform share of feasible hypotheses for a
 * constraints-only snapshot, weighted probability for a weighted one, and a
 * degraded fallback share for a degraded one.
 */
export function renderBeliefSummary(
  view: PlayerView,
  snapshot: BeliefSnapshot,
  analysis: SituationAnalysis,
): string {
  const semantics = probabilitySemantics(snapshot)
  const lines = [
    `== EXACT BELIEF SUMMARY (experimental, ${BELIEF_RENDERER_VERSION}) ==`,
    `Model ${snapshot.modelVersion} | visible event cursor ${snapshot.throughSeq} | quality ${snapshot.quality}.`,
    `Semantics: values below are ${semantics}. They are not calibrated behavioral likelihoods.`,
    `PROVEN GOOD: ${names(view, analysis.provenGood)}.`,
    `PROVEN EVIL: ${names(view, analysis.provenEvil)}.`,
  ]

  if (analysis.unresolved.length) {
    lines.push('Unresolved player shares:')
    for (const seat of analysis.unresolved) {
      const marginal = snapshot.playerMarginals[seat]
      lines.push(
        `  ${names(view, [seat])} | evil ${semantics}: `
        + `${percent(marginal.evilProbability, true)} | good ${semantics}: `
        + `${percent(marginal.goodProbability, true)}`,
      )
    }
  } else {
    lines.push('Unresolved player shares: none.')
  }

  if (analysis.currentTeam) {
    lines.push(teamLine(
      view,
      analysis.currentTeam,
      'Current team',
      semantics,
    ))
  }
  for (const [index, candidate] of analysis.candidateTeams.entries()) {
    lines.push(teamLine(
      view,
      candidate,
      `Candidate team ${index + 1}`,
      semantics,
    ))
  }

  const relationships = exactOnePairs(snapshot, analysis.unresolved, 4)
  if (relationships.length) {
    lines.push('Exact joint relationships:')
    for (const [a, b] of relationships) {
      lines.push(`  Exactly one of ${names(view, [a, b])} is evil.`)
    }
  }

  lines.push('Top joint alignment hypotheses:')
  for (const [index, hypothesis] of topAlignmentHypotheses(snapshot, 3).entries()) {
    lines.push(
      `  ${index + 1}. Evil seats [${names(view, hypothesis.evil)}] | ${semantics}: `
      + percent(
        hypothesis.probability,
        hypothesis.probability > 0 && hypothesis.probability < 1,
      ),
    )
  }
  return lines.join('\n')
}
