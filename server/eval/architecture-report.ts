// Compact, machine-readable architecture comparison report.
//
// The report is intentionally narrower than report.ts: it summarizes only the
// role seat selected by each architecture-bank case and groups operational
// results by role, decision/call kind, model, and component-version bundle.
//
// The work lives in ./architecture-report/; this file is the entry point and
// the published surface. It keeps architectureReport itself, because that
// function is what defines a report: the bank and duplicate-cell checks, the
// baseline-first variant order, and the paired comparisons all belong to the
// whole report rather than to any one stage of it. It also keeps the CLI, which
// package.json pins by path.
//
// The re-exports below are named one by one rather than a star. Many callers
// across server/eval/ and the test tree import from this path, and some of
// those files are pinned by content hash, so the published surface has to stay
// a deliberate list that a move cannot silently widen.

import fs from 'node:fs'
import {
  parseArgs,
} from 'node:util'
import {
  pathToFileURL,
} from 'node:url'
import {
  readArtifacts,
} from './core/artifact.ts'
import type {
  GameArtifact,
} from './core/artifact.ts'
import {
  pairedBootstrapRateDelta,
  seededRandom,
  sumOf,
} from './core/statistics.ts'
import {
  voteRateCount,
} from './runs/vote-direction.ts'
import {
  ARCHITECTURE_REPORT_SCHEMA,
} from './architecture-report/types.ts'
import type {
  ArchitectureBenchmarkReport,
  ArchitectureComparison,
} from './architecture-report/types.ts'
import {
  observe,
} from './architecture-report/observe.ts'
import {
  observationPromotionEvidenceEligible,
  summarizeVariant,
} from './architecture-report/summarize.ts'
import {
  assertMatchedVariants,
} from './architecture-report/matched-variants.ts'
import {
  renderArchitectureReport,
} from './architecture-report/render.ts'

export {
  ARCHITECTURE_REPORT_SCHEMA,
} from './architecture-report/types.ts'
export type {
  ArchitectureBenchmarkReport,
  ArchitectureComparison,
  ArchitectureComponentEvidenceSummary,
  ArchitectureDecisionQuality,
  ArchitectureKindSummary,
  ArchitectureModelSummary,
  ArchitectureRoleSummary,
  ArchitectureSafetySummary,
  ArchitectureVariantSummary,
  LatencySummary,
} from './architecture-report/types.ts'
export {
  assertMatchedVariants,
} from './architecture-report/matched-variants.ts'
export type {
  MatchedVariantInput,
} from './architecture-report/matched-variants.ts'
export {
  renderArchitectureReport,
} from './architecture-report/render.ts'

export function architectureReport(artifacts: readonly GameArtifact[]): ArchitectureBenchmarkReport {
  if (!artifacts.length) throw new Error('architecture report requires at least one artifact')
  const games = artifacts.map(observe)
  const banks = new Set(games.map((g) => g.meta.bank))
  if (banks.size !== 1) throw new Error('architecture report cannot mix seed banks')
  const cells = new Set<string>()
  for (const game of games) {
    const cell = `${game.meta.variant}\0${game.meta.caseId}`
    if (cells.has(cell)) {
      throw new Error(
        `duplicate architecture result for variant ${game.meta.variant}, case ${game.meta.caseId}`,
      )
    }
    cells.add(cell)
  }
  const caseIds = [...new Set(games.map((g) => g.meta.caseId))].sort()
  // Preserve artifact order: the runner writes the declared baseline first.
  // Alphabetical sorting can silently turn "candidate" into the baseline.
  const variantIds = [...new Set(games.map((g) => g.meta.variant))]
  const byVariant = new Map(
    variantIds.map((id) => [id, games.filter((game) => game.meta.variant === id)]),
  )
  const variants = variantIds.map((id) => summarizeVariant(id, byVariant.get(id)!))

  const comparisons: ArchitectureComparison[] = []
  if (variantIds.length > 1) {
    const baseline = variantIds[0]!
    const baselineByCase = new Map(byVariant.get(baseline)!.map((g) => [g.meta.caseId, g]))
    for (const candidate of variantIds.slice(1)) {
      const pairs = byVariant.get(candidate)!.flatMap((candidateGame) => {
        const baselineGame = baselineByCase.get(candidateGame.meta.caseId)
        if (!baselineGame) return []
        assertMatchedVariants(baselineGame, candidateGame)
        return [{
          baseline: baselineGame,
          candidate: candidateGame,
        }]
      })
      const deltas = pairs.map(({ baseline: base, candidate: next }) => ({
        wins: Number(next.won) - Number(base.won),
        forced: next.forced - base.forced,
        degraded: next.degraded - base.degraded,
        cost: next.cost - base.cost,
      }))
      comparisons.push({
        baseline,
        candidate,
        matchedCases: deltas.length,
        wins: sumOf(deltas, (delta) => delta.wins),
        forcedViolations: sumOf(deltas, (delta) => delta.forced),
        degraded: sumOf(deltas, (delta) => delta.degraded),
        cost: sumOf(deltas, (delta) => delta.cost),
        promotionEvidenceEligible: pairs.every(
          ({ baseline: base, candidate: next }) =>
            observationPromotionEvidenceEligible(base)
            && observationPromotionEvidenceEligible(next),
        ),
        targetWinRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: Number(game.won),
            trials: 1,
          }),
          seededRandom(
            `${games[0]!.meta.bank}:${baseline}:${candidate}:wins`,
          ),
        ),
        cleanInitialProposalRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.cleanInitialProposals,
            trials: game.initialProposals,
          }),
          seededRandom(
            `${games[0]!.meta.bank}:${baseline}:${candidate}:proposals`,
          ),
        ),
        voteTruthAccuracyDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'truth'),
          seededRandom(
            `${games[0]!.meta.bank}:${baseline}:${candidate}:votes`,
          ),
        ),
        voteDirtyTeamApproveRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'dirty-team-approve'),
          seededRandom(
            `${games[0]!.meta.bank}:${baseline}:${candidate}:dirty-team-approve`,
          ),
        ),
        voteCleanTeamRejectRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'clean-team-reject'),
          seededRandom(
            `${games[0]!.meta.bank}:${baseline}:${candidate}:clean-team-reject`,
          ),
        ),
      })
    }
  }

  return {
    schema: ARCHITECTURE_REPORT_SCHEMA,
    bank: games[0]!.meta.bank,
    cases: caseIds,
    variants,
    comparisons,
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  })
  if (!positionals.length) {
    console.error('usage: node server/eval/architecture-report.ts <artifacts.jsonl> [...more] [--json] [--out file]')
    process.exit(1)
  }
  const report = architectureReport(positionals.flatMap((file) => readArtifacts(file)))
  const rendered = values.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderArchitectureReport(report)}\n`
  if (values.out) fs.writeFileSync(values.out, rendered)
  else process.stdout.write(rendered)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
