// NB-013 gate: does pricing the dirty-approval branch actually help?
//
// NB-010 localized the base good policy's adverse win rate to the vote channel
// and named permissiveness at an information-poor seat as one cause, hidden
// behind a symmetric vote-truth metric. The first half of NB-013 split that
// metric by error direction. This bench is the second half's gate: one arm holds
// the measured Phase 4B vote value, the other prices approving a dirty team, and
// nothing else differs. The register states the bar plainly: a promotion needs
// the dirty-team approval rate to fall, not the symmetric accuracy to rise.
//
// Both free populations run, because NB-010's central lesson is that this
// channel's sign is set by whether the opponents can exploit it. Everything here
// is API-free and makes no provider call.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import {
  CANDIDATE_SCORER_VERSION,
  createGoodProposalVoteScorer,
  goodProposalVoteScorer,
} from '../agents/policy/score.ts'
import {
  assertFreshArchitectureOutput,
  runArchitectureBench,
  type ArchitectureBenchOpts,
  type ArchitectureVariant,
} from './architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
  type ArchitectureBenchmarkReport,
} from './architecture-report.ts'
import {
  PHASE4_POLICY_BANK,
  PHASE4_POLICY_BANK_ID,
} from './good-policy-bank.ts'
import type { AgentSpec } from '../agents/types.ts'
import type { Role } from '../engine/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const NB013_VOTE_OBJECTIVE_EVAL_VERSION = 'nb013-vote-objective-eval-v1'
export const NB013_VOTE_OBJECTIVE_BANK_ID =
  `${PHASE4_POLICY_BANK_ID}-vote-objective`

export const NB013_VOTE_OBJECTIVE_VARIANTS = {
  symmetric: 'symmetric-vote-value',
  boardSwing: 'board-swing-vote-value',
  compatibility: 'compatibility',
} as const

export type Nb013Population = Extract<
  AgentSpec['type'],
  'heuristic' | 'random'
>

const boardSwingScorer = createGoodProposalVoteScorer({
  selectionMode: 'top-utility',
  voteValue: 'board-swing',
})

const components = (
  scorer: string,
  evaluationRole: 'baseline' | 'candidate' | 'reference',
): Record<string, string> => ({
  evaluation: NB013_VOTE_OBJECTIVE_EVAL_VERSION,
  evaluationRole,
  mode: 'structured-only',
  brain: 'brain-spec-v1',
  belief: 'exact-constraints-v1',
  factors: 'off',
  policy: 'composed-policy-v1',
  scorer,
  planner: 'planner-off',
  voice: 'voice-off',
})

/**
 * The gate is the first two arms: one difference, the vote value function. The
 * baseline is the same deterministic vote policy the Phase 7 bench calls
 * `base-composed`, so the comparison inherits that arm's measured behavior
 * instead of inventing a reference point.
 *
 * Compatibility rides along third because the gate alone cannot answer the
 * question a default promotion turns on. NB-010 measured the composed policy as
 * adverse against compatibility, so an arm could improve on its sibling while
 * both stayed worse than the checked-in behavior. Declared order is comparison
 * order: `architectureReport` pairs every later variant against the first.
 */
export function nb013VoteObjectiveVariants(): readonly ArchitectureVariant[] {
  return Object.freeze([
    {
      id: NB013_VOTE_OBJECTIVE_VARIANTS.symmetric,
      descriptor: `${NB013_VOTE_OBJECTIVE_EVAL_VERSION}:symmetric`,
      paid: false,
      components: components(goodProposalVoteScorer.version, 'baseline'),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: goodProposalVoteScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: NB013_VOTE_OBJECTIVE_VARIANTS.boardSwing,
      descriptor: `${NB013_VOTE_OBJECTIVE_EVAL_VERSION}:board-swing`,
      paid: false,
      components: components(boardSwingScorer.version, 'candidate'),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: boardSwingScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      // The checked-in behavior, present as a reference rather than as the
      // gate. Its comparison shares the structured baseline, so it restates
      // NB-010's adverse gap on the same games the gate is read from.
      id: NB013_VOTE_OBJECTIVE_VARIANTS.compatibility,
      descriptor: `${NB013_VOTE_OBJECTIVE_EVAL_VERSION}:compatibility`,
      paid: false,
      components: {
        ...components(CANDIDATE_SCORER_VERSION, 'reference'),
        mode: 'compatibility',
      },
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
  ])
}

export interface Nb013VoteObjectiveReport {
  version: typeof NB013_VOTE_OBJECTIVE_EVAL_VERSION
  bank: string
  cases: number
  /** Keyed by population, then by the bank's target role. */
  byPopulation: Partial<Record<
    Nb013Population,
    Readonly<Record<string, ArchitectureBenchmarkReport>>
  >>
}

/** Stable target-role groups in bank order. */
function caseGroups(
  cases: readonly ArchitectureBankCase[],
): readonly Readonly<{
  targetRole: Role
  cases: readonly ArchitectureBankCase[]
}>[] {
  const order: Role[] = []
  const grouped = new Map<Role, ArchitectureBankCase[]>()
  for (const bankCase of cases) {
    const existing = grouped.get(bankCase.targetRole)
    if (existing) {
      existing.push(bankCase)
      continue
    }
    order.push(bankCase.targetRole)
    grouped.set(bankCase.targetRole, [bankCase])
  }
  return order.map((targetRole) => Object.freeze({
    targetRole,
    cases: Object.freeze(grouped.get(targetRole)!),
  }))
}

export async function runNb013VoteObjectiveBench(
  options: {
    cases?: readonly ArchitectureBankCase[]
    out?: string
    opponentKinds?: readonly Nb013Population[]
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<Nb013VoteObjectiveReport> {
  const cases = options.cases ?? PHASE4_POLICY_BANK
  const opponentKinds = options.opponentKinds ?? ['heuristic', 'random']
  if (
    !opponentKinds.length
    || new Set(opponentKinds).size !== opponentKinds.length
  ) {
    throw new Error('the NB-013 bench requires unique opponent populations')
  }
  const groups = caseGroups(cases)
  // The bank is player-count major, so a --cases slice can drop whole target
  // roles and table sizes. Say so rather than letting the case count imply the
  // comparison covered the bank it is named after.
  const bankRoles = new Set(
    PHASE4_POLICY_BANK.map((entry) => entry.targetRole),
  )
  if (
    groups.length !== bankRoles.size
    || cases.length !== PHASE4_POLICY_BANK.length
  ) {
    options.onProgress?.(
      `partial bank: ${cases.length} of ${PHASE4_POLICY_BANK.length} cases, `
      + `target roles ${groups.map((group) => group.targetRole).join(', ')} `
      + `of ${[...bankRoles].join(', ')}`,
    )
  }
  const byPopulation: Nb013VoteObjectiveReport['byPopulation'] = {}
  for (const opponentKind of opponentKinds) {
    const byRole: Record<string, ArchitectureBenchmarkReport> = {}
    for (const group of groups) {
      options.onProgress?.(
        `population ${opponentKind}, target ${group.targetRole}, `
        + `${group.cases.length} cases`,
      )
      const artifacts = await runArchitectureBench({
        variants: nb013VoteObjectiveVariants(),
        cases: group.cases,
        // Population-qualified so one output file stays self-describing and no
        // variant/case cell repeats, which architectureReport rejects.
        bankId: `${NB013_VOTE_OBJECTIVE_BANK_ID}-${opponentKind}`,
        opponentKind,
        out: options.out,
        onProgress: options.onProgress,
      })
      byRole[group.targetRole] = architectureReport(artifacts)
    }
    byPopulation[opponentKind] = Object.freeze(byRole)
  }
  return {
    version: NB013_VOTE_OBJECTIVE_EVAL_VERSION,
    bank: NB013_VOTE_OBJECTIVE_BANK_ID,
    cases: cases.length,
    byPopulation,
  }
}

/**
 * The gate reads one line per cell. Stated as the register states it: the
 * dirty-team approval rate has to fall, and the win rate must not fall with it.
 */
export function renderNb013Gate(report: Nb013VoteObjectiveReport): string {
  const lines: string[] = [
    `NB-013 gate: dirty-approve must fall and win must not fall. The gate is `
    + `the ${NB013_VOTE_OBJECTIVE_VARIANTS.boardSwing} rows; `
    + `${NB013_VOTE_OBJECTIVE_VARIANTS.compatibility} rows are the reference.`,
    'population role      candidate                win delta            '
    + 'dirty-approve delta  clean-reject delta',
  ]
  const number = (value: number | null): string =>
    value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${(100 * value).toFixed(1)}%`
  const interval = (
    estimate: Readonly<{ low: number; high: number }> | null,
  ): string =>
    estimate === null
      ? ''
      : ` (${number(estimate.low)} to ${number(estimate.high)})`
  for (const population of ['heuristic', 'random'] as const) {
    const selected = report.byPopulation[population]
    if (!selected) continue
    for (const [targetRole, roleReport] of Object.entries(selected)) {
      for (const comparison of roleReport.comparisons) {
        const cell = (
          delta: Readonly<{
            delta: number | null
            interval95: Readonly<{ low: number; high: number }> | null
          }>,
        ): string =>
          `${number(delta.delta)}${interval(delta.interval95)}`.padEnd(20)
        lines.push(
          `${population.padEnd(10)} ${targetRole.padEnd(9)} `
          + `${comparison.candidate.padEnd(24)} `
          + `${cell(comparison.targetWinRateDelta)} `
          + `${cell(comparison.voteDirtyTeamApproveRateDelta)} `
          + `${cell(comparison.voteCleanTeamRejectRateDelta)}`,
        )
      }
    }
  }
  return lines.join('\n')
}

function render(report: Nb013VoteObjectiveReport): string {
  const lines: string[] = []
  for (const population of ['heuristic', 'random'] as const) {
    const selected = report.byPopulation[population]
    if (!selected) continue
    for (const [targetRole, roleReport] of Object.entries(selected)) {
      lines.push(
        `population ${population}, target ${targetRole}`,
        renderArchitectureReport(roleReport),
      )
    }
  }
  lines.push('', renderNb013Gate(report))
  lines.push(
    'scope: phase4-good-v1 targets Merlin, Percival, and Servant only, so this',
    'measures the good half of the vote objective and nothing on the evil side.',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: `data/eval/${NB013_VOTE_OBJECTIVE_BANK_ID}.jsonl`,
      },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      opponents: { type: 'string', default: 'both' },
    },
  })
  const limit = values.cases === undefined
    ? PHASE4_POLICY_BANK.length
    : Number(values.cases)
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > PHASE4_POLICY_BANK.length
  ) {
    throw new Error(
      `--cases must be an integer from 1 to ${PHASE4_POLICY_BANK.length}`,
    )
  }
  if (!['heuristic', 'random', 'both'].includes(values.opponents!)) {
    throw new Error('--opponents must be heuristic, random, or both')
  }
  const opponentKinds: readonly Nb013Population[] =
    values.opponents === 'both'
      ? ['heuristic', 'random']
      : [values.opponents as Nb013Population]
  assertFreshArchitectureOutput(values.out!)
  const report = await runNb013VoteObjectiveBench({
    cases: PHASE4_POLICY_BANK.slice(0, limit),
    out: values.out,
    opponentKinds,
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${render(report)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
