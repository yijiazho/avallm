// Eval report CLI: aggregate programmatic metrics over game artifacts.
//   node server/eval/report.ts data/eval/bench-merlin-bench.jsonl [...more.jsonl]
// Sections: overview, per-agent aggregates, Merlin detectability, and — when
// the artifacts carry bench tags — the paired candidate-vs-baseline deltas
// that are the actual promotion signal (docs/design-evaluation.md §2, §8).

import { parseArgs } from 'node:util'
import { readArtifacts } from '../core/artifact.ts'
import { computeMetrics } from '../core/metrics.ts'
import { mean } from '../core/statistics.ts'
import { overviewPercent as pct } from '../core/report-format.ts'
import { FORCED_PLAY_RULES } from '../harness/forced.ts'
import type { GameMetrics, SeatMetrics } from '../core/metrics.ts'
import type { ForcedPlayRule } from '../harness/forced.ts'

const fmt = (n: number | null | undefined, digits = 2): string =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits)

function row(cells: (string | number)[], widths: number[]): string {
  return cells.map((c, i) => String(c).padEnd(widths[i])).join(' ').trimEnd()
}

// ---- per-agent aggregates ----

interface AgentAgg {
  agent: string
  games: number
  wins: number
  voteScores: number[]
  utterances: number
  passes: number
  silent: number
  forced: number // forced plays declined (metrics.forcedPlays)
  degraded: number
}

function aggregateAgents(games: GameMetrics[], degradedSeats: Map<GameMetrics, Set<number>>): AgentAgg[] {
  const byAgent = new Map<string, AgentAgg>()
  for (const g of games) {
    for (const s of g.seats) {
      const agg = byAgent.get(s.agent)
        ?? { agent: s.agent, games: 0, wins: 0, voteScores: [], utterances: 0, passes: 0, silent: 0, forced: 0, degraded: 0 }
      agg.games++
      if (s.won) agg.wins++
      if (s.voteScore !== null) agg.voteScores.push(s.voteScore)
      agg.utterances += s.utterances
      agg.passes += s.passes
      agg.silent += s.silentContradictions
      agg.forced += s.forcedPlayViolations
      if (degradedSeats.get(g)?.has(s.seat)) agg.degraded++
      byAgent.set(s.agent, agg)
    }
  }
  return [...byAgent.values()].sort((a, b) => b.games - a.games)
}

// ---- paired comparison ----

interface PairDelta {
  seed: string
  win: number          // role-seat side won: candidate - baseline (each 0/1)
  voteScore: number | null
  silent: number
  rank: number | null        // merlin only; positive = candidate LESS conspicuous
  assassinated: number | null // merlin only, when both games reached assassination
  vAssassin: number | null   // merlin only; virtual-assassin hit-rate delta
}

function pairDeltas(games: GameMetrics[]): { role: string; candidateId: string; baselineId: string; deltas: PairDelta[] } | null {
  // A pair is one (role, candidateId, baselineId, pairSeed) cell. Keying on
  // pairSeed alone silently cross-pairs unrelated runs when several benches
  // append to one file (or the same command is re-run) — the seeds repeat, so
  // run 2's candidate would overwrite run 1's under the same key. Group by the
  // full identity first, then take the largest single group so the PAIRED
  // section describes exactly one candidate-vs-baseline comparison.
  const groups = new Map<string, Map<string, { candidate?: GameMetrics; baseline?: GameMetrics }>>()
  for (const g of games) {
    const t = g.tags
    if (!t?.variant || !t.pairSeed || !t.bench || !t.agentId) continue
    // Identity excludes this game's own variant: its counterpart carries the
    // other agentId, so key on role+seed and record which agent filled which slot.
    const other = games.find((h) => h.tags?.pairSeed === t.pairSeed && h.tags?.variant !== t.variant && h.tags?.bench === t.bench)
    const candidateId = t.variant === 'candidate' ? t.agentId : other?.tags?.agentId
    const baselineId = t.variant === 'baseline' ? t.agentId : other?.tags?.agentId
    if (!candidateId || !baselineId) continue
    const key = `${t.bench}\0${candidateId}\0${baselineId}`
    const bySeed = groups.get(key) ?? new Map()
    const slot = bySeed.get(t.pairSeed) ?? {}
    slot[t.variant as 'candidate' | 'baseline'] = g
    bySeed.set(t.pairSeed, slot)
    groups.set(key, bySeed)
  }
  // Largest group wins the section (report the dominant comparison; others are
  // noise from a mixed file the caller can split).
  let best: [string, Map<string, { candidate?: GameMetrics; baseline?: GameMetrics }>] | null = null
  for (const entry of groups) {
    if (!best || [...entry[1].values()].filter((p) => p.candidate && p.baseline).length
      > [...best[1].values()].filter((p) => p.candidate && p.baseline).length) best = entry
  }
  if (!best) return null
  const complete = [...best[1].entries()].filter(([, p]) => p.candidate && p.baseline)
  if (!complete.length) return null

  const role = complete[0][1].candidate!.tags!.bench!
  // Every game in this group is a bench of `role`, so the role seat always
  // exists; guard anyway so a malformed artifact skips rather than throwing.
  const seatOf = (g: GameMetrics): SeatMetrics | undefined => g.seats.find((s) => s.role === role)
  const deltas: PairDelta[] = complete.flatMap(([seed, p]) => {
    const c = seatOf(p.candidate!)
    const b = seatOf(p.baseline!)
    if (!c || !b) return []
    const isMerlin = role === 'merlin'
    const cM = p.candidate!.merlin
    const bM = p.baseline!.merlin
    return [{
      seed,
      win: Number(c.won) - Number(b.won),
      voteScore: c.voteScore !== null && b.voteScore !== null ? c.voteScore - b.voteScore : null,
      silent: c.silentContradictions - b.silentContradictions,
      rank: isMerlin && cM?.conspicuousnessRank != null && bM?.conspicuousnessRank != null
        ? cM.conspicuousnessRank - bM.conspicuousnessRank
        : null,
      assassinated: isMerlin && cM?.assassinated !== null && bM?.assassinated !== null
        ? Number(cM!.assassinated) - Number(bM!.assassinated)
        : null,
      vAssassin: isMerlin && cM?.virtualAssassinRate != null && bM?.virtualAssassinRate != null
        ? cM.virtualAssassinRate - bM.virtualAssassinRate
        : null,
    }]
  })
  return {
    role,
    candidateId: complete[0][1].candidate!.tags!.agentId,
    baselineId: complete[0][1].baseline!.tags!.agentId,
    deltas,
  }
}

function deltaLine(label: string, values: (number | null)[], note: string): string {
  const xs = values.filter((v): v is number => v !== null)
  if (!xs.length) return `  ${label.padEnd(22)} —`
  const up = xs.filter((x) => x > 0).length
  const down = xs.filter((x) => x < 0).length
  const tie = xs.length - up - down
  return `  ${label.padEnd(22)} mean ${fmt(mean(xs), 3).padStart(7)}   +${up} / -${down} / =${tie} of ${xs.length}   ${note}`
}

// ---- main ----

const { positionals } = parseArgs({ allowPositionals: true, options: {} })
if (!positionals.length) {
  console.error('usage: node server/eval/report.ts <artifacts.jsonl> [...more]')
  process.exit(1)
}

const artifacts = positionals.flatMap((f) => readArtifacts(f))
const games = artifacts.map(computeMetrics)
const degradedSeats = new Map<GameMetrics, Set<number>>(
  games.map((g, i) => [g, new Set(artifacts[i].degraded.map((d) => d.seat))]),
)

console.log(`\n== OVERVIEW ==`)
const good = games.filter((g) => g.winner === 'good').length
console.log(`${games.length} games   good ${good} (${pct(good, games.length)})   evil ${games.length - good} (${pct(games.length - good, games.length)})`)
const reasons = new Map<string, number>()
for (const g of games) reasons.set(g.winReason, (reasons.get(g.winReason) ?? 0) + 1)
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${r}: ${n}`)
const degradedTotal = games.reduce((a, g) => a + g.degradedCount, 0)
if (degradedTotal) console.log(`degraded decisions: ${degradedTotal}`)

console.log(`\n== PER AGENT ==`)
const widths = [22, 6, 6, 6, 6, 12, 7, 7, 5]
console.log(row(['agent', 'games', 'win%', 'vote', 'utter/pass', 'silent', 'forced', 'degr'], widths))
for (const a of aggregateAgents(games, degradedSeats)) {
  console.log(row([
    a.agent, a.games, pct(a.wins, a.games), fmt(mean(a.voteScores)),
    `${a.utterances}/${a.passes}`, a.silent, a.forced || '', a.degraded || '',
  ], widths))
}

// Forced plays get their own breakdown: unlike the judge's families these are
// ground truth, so a non-zero count is a guidance bug (the prompt never reached
// the bot at that moment) or a model-capability limit — worth naming per rule.
const forcedAll = games.flatMap((g) => g.forcedPlays)
if (forcedAll.length) {
  console.log(`\n== FORCED PLAYS DECLINED (${forcedAll.length} over ${games.length} game${games.length === 1 ? '' : 's'}) ==`)
  const byRule = new Map<string, number>()
  for (const v of forcedAll) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1)
  for (const [r, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${n}  (${FORCED_PLAY_RULES[r as ForcedPlayRule]})`)
  }
  for (const v of forcedAll.slice(0, 12)) {
    console.log(`    ${v.agent} as ${v.role}: ${v.detail}`)
  }
  if (forcedAll.length > 12) console.log(`    ... and ${forcedAll.length - 12} more`)
}

const merlinGames = games.filter((g) => g.merlin)
if (merlinGames.length) {
  console.log(`\n== MERLIN DETECTABILITY ==`)
  const byAgent = new Map<string, GameMetrics[]>()
  for (const g of merlinGames) {
    byAgent.set(g.merlin!.agent, [...(byAgent.get(g.merlin!.agent) ?? []), g])
  }
  const mWidths = [22, 6, 6, 9, 8, 14, 10]
  console.log(row(['merlin agent', 'games', 'vote', 'avg rank', 'rank #1', 'assassinated', 'vAssassin'], mWidths))
  for (const [agent, gs] of byAgent) {
    const ranks = gs.map((g) => g.merlin!.conspicuousnessRank).filter((r): r is number => r !== null)
    const reached = gs.filter((g) => g.merlin!.assassinated !== null)
    const hit = reached.filter((g) => g.merlin!.assassinated).length
    const vRates = gs.map((g) => g.merlin!.virtualAssassinRate).filter((v): v is number => v !== null)
    console.log(row([
      agent, gs.length,
      fmt(mean(gs.map((g) => g.merlin!.voteScore).filter((v): v is number => v !== null))),
      fmt(mean(ranks), 1),
      `${ranks.filter((r) => r === 1).length}/${ranks.length}`,
      reached.length ? `${hit}/${reached.length} (${pct(hit, reached.length)})` : '—',
      vRates.length ? fmt(mean(vRates)) : '—',
    ], mWidths))
  }
  console.log(`(rank 1 = most truth-aligned good player = most conspicuous; a hidden Merlin blends mid-pack)`)
}

const judged = games.filter((g) => g.judge)
if (judged.length) {
  console.log(`\n== JUDGE (${judged[0].judge!.model}) ==`)
  const found = judged.filter((g) => g.judge!.blindedMerlinCorrect).length
  console.log(`blinded pass: merlin found ${found}/${judged.length} (${pct(found, judged.length)})`)
  const families = new Map<string, number>()
  for (const g of judged) {
    for (const i of g.judge!.incidents) families.set(i.family, (families.get(i.family) ?? 0) + 1)
  }
  for (const [f, n] of [...families].sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`)
}

const paired = pairDeltas(games)
if (paired) {
  console.log(`\n== PAIRED: ${paired.candidateId} vs ${paired.baselineId} (as ${paired.role}) ==`)
  console.log(`candidate minus baseline, per matched seed:`)
  console.log(deltaLine('side wins', paired.deltas.map((d) => d.win), '(+ = candidate side won more)'))
  console.log(deltaLine('vote truth-alignment', paired.deltas.map((d) => d.voteScore), paired.role === 'merlin' ? '(for Merlin, HIGH is conspicuous)' : ''))
  console.log(deltaLine('silent contradictions', paired.deltas.map((d) => d.silent), '(- = candidate dodges less)'))
  if (paired.role === 'merlin') {
    console.log(deltaLine('conspicuousness rank', paired.deltas.map((d) => d.rank), '(+ = candidate blends in better)'))
    console.log(deltaLine('assassinated', paired.deltas.map((d) => d.assassinated), '(- = candidate survives more)'))
    console.log(deltaLine('virtual assassin', paired.deltas.map((d) => d.vAssassin), '(- = candidate harder to spot)'))
  }
}
console.log()
