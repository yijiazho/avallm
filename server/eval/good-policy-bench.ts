// Reproducible, API-free Phase 4 policy comparison.
//
// Compatibility, structured-only, and fake-client hybrid agents play the
// same pinned good-side seats against identical heuristic tables. The fake
// planner exercises only the bounded candidate surface and never calls a
// provider.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import { createBoundedPlannerVoice } from '../agents/communication/planner-voice-adapter.ts'
import {
  createGoodProposalVoteScorer,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
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
import type { ArchitectureBankCase } from './architecture-bank.ts'
import type { CallOpts, Msg } from '../llm/openrouter.ts'

export const PHASE4_POLICY_EVAL_VERSION = 'phase4-policy-eval-v1'
export const PHASE4_FAKE_PLANNER_VERSION = 'bounded-llm-planner-v2'
export const PHASE4_FAKE_VOICE_VERSION = 'bounded-llm-voice-v1'

const scorer = createGoodProposalVoteScorer({
  selectionMode: 'seeded-band',
})

function fakeClient(): {
  call: (
    model: string,
    messages: Msg[],
    opts?: CallOpts,
  ) => Promise<string>
} {
  return {
    async call(_model, messages, opts) {
      if (opts?.tag?.endsWith('/planner')) {
        const input = JSON.parse(messages[1].content) as {
          structuredCandidateId: string
          context: {
            viableCandidates: Array<{
              id: string
              reasonCodes: string[]
            }>
          }
        }
        const selected = input.context.viableCandidates.find(
          (candidate) => candidate.id !== input.structuredCandidateId,
        ) ?? input.context.viableCandidates.find(
          (candidate) => candidate.id === input.structuredCandidateId,
        )
        if (!selected) return '{}'
        return JSON.stringify({
          candidateId: selected.id,
          ...(selected.id === input.structuredCandidateId
            ? {}
            : { reasonCodes: selected.reasonCodes }),
        })
      }
      return JSON.stringify({ text: 'The committed plan stands.' })
    },
  }
}

export function phase4PolicyVariants(): readonly ArchitectureVariant[] {
  const adapters = createBoundedPlannerVoice({
    client: fakeClient(),
    model: 'api-free/fake-client',
    tagPrefix: 'phase4-policy',
  })
  const baseComponents = {
    brain: 'brain-spec-v1',
    belief: 'exact-constraints-v1',
    factors: 'off',
    policy: 'composed-policy-v1',
    voice: 'voice-off',
    evaluation: PHASE4_POLICY_EVAL_VERSION,
  }
  return [
    {
      id: 'compatibility',
      components: {
        ...baseComponents,
        scorer: 'compatibility-scorer-v1',
        planner: 'planner-off',
      },
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: 'structured-only',
      components: {
        ...baseComponents,
        scorer: GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
        planner: 'planner-off',
      },
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: 'hybrid',
      components: {
        ...baseComponents,
        scorer: GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
        planner: PHASE4_FAKE_PLANNER_VERSION,
        voice: PHASE4_FAKE_VOICE_VERSION,
      },
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer,
        onDecisionTrace: context.onDecisionTrace,
        ...adapters,
      }),
    },
  ]
}

export async function runPhase4PolicyBench(
  options: {
    cases?: readonly ArchitectureBankCase[]
    out?: string
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<ArchitectureBenchmarkReport> {
  const artifacts = await runArchitectureBench({
    variants: phase4PolicyVariants(),
    cases: options.cases ?? PHASE4_POLICY_BANK,
    bankId: PHASE4_POLICY_BANK_ID,
    out: options.out,
    onProgress: options.onProgress,
  })
  return architectureReport(artifacts)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: `data/eval/${PHASE4_POLICY_BANK_ID}.jsonl`,
      },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
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
  assertFreshArchitectureOutput(values.out!)
  const report = await runPhase4PolicyBench({
    cases: PHASE4_POLICY_BANK.slice(0, limit),
    out: values.out,
    onProgress: values.quiet
      ? undefined
      : (line) => console.log(line),
  })
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderArchitectureReport(report)}\n`,
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
