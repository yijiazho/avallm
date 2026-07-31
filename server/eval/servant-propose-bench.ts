// The gate the servant propose refinement shipped without.
//
// The servant score layer landed with an admitted hole: it is propose-only, and
// the promotion metric the register trusts (`voteDirtyTeamApproveRate`) is a
// vote metric, so nothing gated it. Its own suite proves the layer changes the
// pick and picks the publicly cleanest survivor, but that is the model grading
// its own homework: the candidates it reorders are tied under the servant's own
// posterior, so "cleanest" there means cleanest by the very index the layer
// ranks on. This bench asks the question from outside, against the archived
// deal, on the same frozen bank the servant flatness was measured on.
//
// Two arms, one difference. The baseline is the scorer directly beneath the
// refinement in the chain, so the arms differ by exactly one layer. At a servant
// seat the good role layer declines (it claims Merlin and Percival only), which
// is what makes `roleObjectiveScorer` the honest baseline rather than a handicap:
// it behaves as the deterministic good proposal policy there.
//
// Compatibility rides along as a reference for the reason NB-013 gives: NB-010
// measured the composed policy as adverse against the checked-in behavior, so
// both arms could differ from each other while both sat below compatibility.
// Without that row a win for the refinement over its own base reads as a win
// outright.
//
// Both free populations run, because NB-010's central lesson is that this
// channel's sign is set by whether the opponents can exploit it. Everything here
// is API-free and makes no provider call.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import {
  CANDIDATE_SCORER_VERSION,
  roleObjectiveScorer,
  servantRoleScorer,
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
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const SERVANT_PROPOSE_EVAL_VERSION = 'servant-propose-eval-v1'
export const SERVANT_PROPOSE_BANK_ID =
  `${PHASE4_POLICY_BANK_ID}-servant-propose`

export const SERVANT_PROPOSE_VARIANTS = {
  base: 'good-role-base',
  servant: 'servant-public-read',
  compatibility: 'compatibility',
} as const

export type ServantProposePopulation = Extract<
  AgentSpec['type'],
  'heuristic' | 'random'
>

/** The 60 servant-target cases; the other 120 target Merlin and Percival. */
export function servantProposeCases(
  cases: readonly ArchitectureBankCase[] = PHASE4_POLICY_BANK,
): readonly ArchitectureBankCase[] {
  return cases.filter((entry) => entry.targetRole === 'servant')
}

const components = (
  scorer: string,
  evaluationRole: 'baseline' | 'candidate' | 'reference',
): Record<string, string> => ({
  evaluation: SERVANT_PROPOSE_EVAL_VERSION,
  evaluationRole,
  brain: 'brain-spec-v1',
  belief: 'exact-constraints-v1',
  factors: 'off',
  policy: 'composed-policy-v1',
  scorer,
  planner: 'planner-off',
  voice: 'voice-off',
})

/**
 * Declared order is comparison order: `architectureReport` pairs every later
 * variant against the first.
 */
export function servantProposeVariants(): readonly ArchitectureVariant[] {
  return Object.freeze([
    {
      id: SERVANT_PROPOSE_VARIANTS.base,
      descriptor: `${SERVANT_PROPOSE_EVAL_VERSION}:good-role-base`,
      paid: false,
      components: components(roleObjectiveScorer.version, 'baseline'),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: roleObjectiveScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: SERVANT_PROPOSE_VARIANTS.servant,
      descriptor: `${SERVANT_PROPOSE_EVAL_VERSION}:servant-public-read`,
      paid: false,
      components: components(servantRoleScorer.version, 'candidate'),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: servantRoleScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: SERVANT_PROPOSE_VARIANTS.compatibility,
      descriptor: `${SERVANT_PROPOSE_EVAL_VERSION}:compatibility`,
      paid: false,
      components: components(CANDIDATE_SCORER_VERSION, 'reference'),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
  ])
}

export interface ServantProposeReport {
  version: typeof SERVANT_PROPOSE_EVAL_VERSION
  bank: string
  cases: number
  byPopulation: Partial<
    Record<ServantProposePopulation, ArchitectureBenchmarkReport>
  >
}

export async function runServantProposeBench(
  options: {
    cases?: readonly ArchitectureBankCase[]
    out?: string
    opponentKinds?: readonly ServantProposePopulation[]
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<ServantProposeReport> {
  const cases = servantProposeCases(options.cases ?? PHASE4_POLICY_BANK)
  if (!cases.length) {
    throw new Error('the servant propose bench requires servant-target cases')
  }
  const full = servantProposeCases()
  if (cases.length !== full.length) {
    // The bank is player-count major, so a --cases slice drops whole table
    // sizes. Say so rather than letting the count imply full coverage.
    options.onProgress?.(
      `partial bank: ${cases.length} of ${full.length} servant cases`,
    )
  }
  const opponentKinds = options.opponentKinds ?? ['heuristic', 'random']
  if (
    !opponentKinds.length
    || new Set(opponentKinds).size !== opponentKinds.length
  ) {
    throw new Error('the servant propose bench requires unique populations')
  }
  const byPopulation: ServantProposeReport['byPopulation'] = {}
  for (const opponentKind of opponentKinds) {
    options.onProgress?.(
      `population ${opponentKind}, ${cases.length} servant cases`,
    )
    const artifacts = await runArchitectureBench({
      variants: servantProposeVariants(),
      cases,
      // Population-qualified so one output file stays self-describing and no
      // variant/case cell repeats, which architectureReport rejects.
      bankId: `${SERVANT_PROPOSE_BANK_ID}-${opponentKind}`,
      opponentKind,
      out: options.out,
      onProgress: options.onProgress,
    })
    byPopulation[opponentKind] = architectureReport(artifacts)
  }
  return {
    version: SERVANT_PROPOSE_EVAL_VERSION,
    bank: SERVANT_PROPOSE_BANK_ID,
    cases: cases.length,
    byPopulation,
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: `data/eval/${SERVANT_PROPOSE_BANK_ID}.jsonl`,
      },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  })
  const all = servantProposeCases()
  const limit = values.cases === undefined ? all.length : Number(values.cases)
  if (!Number.isInteger(limit) || limit < 1 || limit > all.length) {
    throw new Error(`--cases must be an integer from 1 to ${all.length}`)
  }
  assertFreshArchitectureOutput(values.out!)
  const report = await runServantProposeBench({
    cases: all.slice(0, limit),
    out: values.out,
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  for (const [population, populationReport] of Object.entries(
    report.byPopulation,
  )) {
    process.stdout.write(
      `\npopulation ${population}\n`
      + `${renderArchitectureReport(populationReport)}\n`,
    )
  }
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
