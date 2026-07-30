// API-free Phase 5C diagnosis of good-side vote-policy conversion.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import {
  QUEST_FACTOR_BUNDLE_VERSION,
  QUEST_WEIGHTED_BELIEF_VERSION,
  questWeightedBeliefModel,
} from '../agents/belief/quest-card-factor.ts'
import {
  CANDIDATE_SCORER_VERSION,
  createGoodProposalVoteScorer,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  goodProposalScorer,
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
import {
  phase5VoteConversionReport,
  renderPhase5VoteConversionReport,
  type VoteConversionReport,
} from './vote-conversion-report.ts'
import type { AgentSpec } from '../agents/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const PHASE5_VOTE_CONVERSION_EVAL_VERSION =
  'phase5-vote-conversion-eval-v1'
export const PHASE5_VOTE_CONVERSION_BANK_ID =
  `${PHASE4_POLICY_BANK_ID}-vote-conversion`

export const PHASE5_VOTE_CONVERSION_VARIANTS = {
  compatibility: 'compatibility',
  proposalOnly: 'quest-proposal-only',
  topUtility: 'quest-proposal-top-v1',
  seededBand: 'quest-proposal-seeded-v1',
} as const

const topUtilityScorer = createGoodProposalVoteScorer({
  selectionMode: 'top-utility',
})
const seededBandScorer = createGoodProposalVoteScorer({
  selectionMode: 'seeded-band',
})

function components(
  belief: string,
  factors: string,
  scorer: string,
  evaluationRole: 'baseline' | 'candidate' | 'ablation',
): Record<string, string> {
  return {
    brain: 'brain-spec-v1',
    belief,
    factors,
    policy: 'composed-policy-v1',
    scorer,
    planner: 'planner-off',
    voice: 'voice-off',
    evaluation: PHASE5_VOTE_CONVERSION_EVAL_VERSION,
    evaluationRole,
  }
}

export function phase5VoteConversionVariants():
  readonly ArchitectureVariant[] {
  return [
    {
      id: PHASE5_VOTE_CONVERSION_VARIANTS.compatibility,
      components: components(
        'exact-constraints-v1',
        'off',
        CANDIDATE_SCORER_VERSION,
        'baseline',
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: PHASE5_VOTE_CONVERSION_VARIANTS.proposalOnly,
      components: components(
        QUEST_WEIGHTED_BELIEF_VERSION,
        QUEST_FACTOR_BUNDLE_VERSION,
        GOOD_PROPOSAL_SCORER_VERSION,
        'candidate',
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        beliefModel: questWeightedBeliefModel,
        scorer: goodProposalScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: PHASE5_VOTE_CONVERSION_VARIANTS.topUtility,
      components: components(
        QUEST_WEIGHTED_BELIEF_VERSION,
        QUEST_FACTOR_BUNDLE_VERSION,
        GOOD_PROPOSAL_VOTE_SCORER_VERSION,
        'ablation',
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        beliefModel: questWeightedBeliefModel,
        scorer: topUtilityScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: PHASE5_VOTE_CONVERSION_VARIANTS.seededBand,
      components: components(
        QUEST_WEIGHTED_BELIEF_VERSION,
        QUEST_FACTOR_BUNDLE_VERSION,
        GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
        'ablation',
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        beliefModel: questWeightedBeliefModel,
        scorer: seededBandScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
  ]
}

export interface Phase5VoteConversionPopulationReport {
  architecture: ArchitectureBenchmarkReport
  conversion: VoteConversionReport
}

export interface Phase5VoteConversionBenchReport {
  bank: string
  byPopulation: Partial<Record<
    Extract<AgentSpec['type'], 'heuristic' | 'random'>,
    Phase5VoteConversionPopulationReport
  >>
}

export async function runPhase5VoteConversionBench(
  options: {
    cases?: readonly ArchitectureBankCase[]
    out?: string
    opponentKinds?: readonly Extract<
      AgentSpec['type'],
      'heuristic' | 'random'
    >[]
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<Phase5VoteConversionBenchReport> {
  const cases = options.cases ?? PHASE4_POLICY_BANK
  const opponentKinds = options.opponentKinds ?? ['heuristic', 'random']
  if (
    !opponentKinds.length
    || new Set(opponentKinds).size !== opponentKinds.length
  ) {
    throw new Error('Phase 5C requires unique opponent populations')
  }
  const byPopulation: Phase5VoteConversionBenchReport['byPopulation'] = {}
  for (const opponentKind of opponentKinds) {
    const artifacts = await runArchitectureBench({
      variants: phase5VoteConversionVariants(),
      cases,
      bankId: PHASE5_VOTE_CONVERSION_BANK_ID,
      opponentKind,
      out: options.out,
      onProgress: options.onProgress,
    })
    byPopulation[opponentKind] = {
      architecture: architectureReport(artifacts),
      conversion: phase5VoteConversionReport(artifacts),
    }
  }
  return {
    bank: PHASE5_VOTE_CONVERSION_BANK_ID,
    byPopulation,
  }
}

function render(report: Phase5VoteConversionBenchReport): string {
  const lines: string[] = []
  for (const population of ['heuristic', 'random'] as const) {
    const selected = report.byPopulation[population]
    if (!selected) continue
    lines.push(
      renderArchitectureReport(selected.architecture),
      renderPhase5VoteConversionReport(selected.conversion),
    )
  }
  return lines.join('\n\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: `data/eval/${PHASE5_VOTE_CONVERSION_BANK_ID}.jsonl`,
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
  const opponentKinds = values.opponents === 'both'
    ? ['heuristic', 'random'] as const
    : [values.opponents as 'heuristic' | 'random']
  assertFreshArchitectureOutput(values.out!)
  const report = await runPhase5VoteConversionBench({
    cases: PHASE4_POLICY_BANK.slice(0, limit),
    out: values.out,
    opponentKinds,
    onProgress: values.quiet
      ? undefined
      : (line) => console.log(line),
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
