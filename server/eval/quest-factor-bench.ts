// Held-out, API-free Phase 5B ablation for the first mechanical likelihood factor.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import {
  QUEST_FACTOR_BUNDLE_VERSION,
  QUEST_WEIGHTED_BELIEF_VERSION,
  questWeightedBeliefModel,
} from '../agents/belief/quest-card-factor.ts'
import {
  CALIBRATION_COMPATIBILITY_SCORER_VERSION,
  calibrationCompatibilityScorer,
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
  beliefCalibrationReport,
  pairedCalibrationDelta,
  type BeliefCalibrationReport,
  type BeliefPredictionRow,
  type PairedCalibrationDelta,
} from './belief-calibration.ts'
import {
  PHASE4_POLICY_BANK,
  PHASE4_POLICY_BANK_ID,
} from './good-policy-bank.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'
import type { GameArtifact } from './artifact.ts'
import type { AgentSpec } from '../agents/types.ts'

export const PHASE5_QUEST_EVAL_VERSION = 'phase5-quest-eval-v1'
export const PHASE5_QUEST_BANK_ID = `${PHASE4_POLICY_BANK_ID}-quest-ablation`

const policyScorer = createGoodProposalVoteScorer({
  selectionMode: 'seeded-band',
})

function components(
  belief: string,
  factors: string,
  scorer: string,
): Record<string, string> {
  return {
    brain: 'brain-spec-v1',
    mode: 'structured-only',
    belief,
    factors,
    policy: 'composed-policy-v1',
    scorer,
    planner: 'planner-off',
    voice: 'voice-off',
    evaluation: PHASE5_QUEST_EVAL_VERSION,
  }
}

export function phase5QuestVariants(): readonly ArchitectureVariant[] {
  return [
    {
      id: 'uniform-policy',
      components: components(
        'exact-constraints-v1',
        'off',
        GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: policyScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: 'quest-weighted-policy',
      components: components(
        QUEST_WEIGHTED_BELIEF_VERSION,
        QUEST_FACTOR_BUNDLE_VERSION,
        GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        beliefModel: questWeightedBeliefModel,
        scorer: policyScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: 'uniform-calibration',
      components: components(
        'exact-constraints-v1',
        'off',
        CALIBRATION_COMPATIBILITY_SCORER_VERSION,
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        scorer: calibrationCompatibilityScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      id: 'quest-weighted-calibration',
      components: components(
        QUEST_WEIGHTED_BELIEF_VERSION,
        QUEST_FACTOR_BUNDLE_VERSION,
        CALIBRATION_COMPATIBILITY_SCORER_VERSION,
      ),
      paid: false,
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        beliefModel: questWeightedBeliefModel,
        scorer: calibrationCompatibilityScorer,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
  ]
}

function predictionRows(
  artifacts: readonly GameArtifact[],
  variant: string,
): BeliefPredictionRow[] {
  const rows: BeliefPredictionRow[] = []
  for (const artifact of artifacts.filter(
    (candidate) => candidate.architecture?.variant === variant,
  )) {
    const meta = artifact.architecture!
    const prefix = `${meta.bank}:${meta.caseId}`
    const populationId =
      `${meta.bank}:${artifact.tags?.opponentPopulation ?? 'heuristic-opponents'}`
    const playerIds = new Set<string>()
    const teamIds = new Set<string>()
    for (const trace of artifact.decisionTraces ?? []) {
      for (const marginal of trace.beliefPlayerMarginals ?? []) {
        if (
          marginal.seat === meta.targetSeat
          || marginal.evilProbability === 0
          || marginal.evilProbability === 1
        ) {
          continue
        }
        const id =
          `${prefix}:q${trace.beliefThroughSeq}:player:${marginal.seat}`
        if (playerIds.has(id)) continue
        playerIds.add(id)
        rows.push({
          id,
          gameId: prefix,
          populationId,
          split: 'test',
          target: 'player-evil',
          probability: marginal.evilProbability,
          observed: artifact.players[marginal.seat].alignment === 'evil',
        })
      }
      for (const assessment of trace.beliefTeamAssessments ?? []) {
        const id =
          `${prefix}:q${trace.beliefThroughSeq}:team:${assessment.candidateId}`
        if (teamIds.has(id)) continue
        teamIds.add(id)
        rows.push({
          id,
          gameId: prefix,
          populationId,
          split: 'test',
          target: 'team-clean',
          probability: assessment.cleanProbability,
          observed: assessment.team.every(
            (seat) => artifact.players[seat].alignment === 'good',
          ),
        })
      }
    }
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id))
}

export interface Phase5QuestBenchReport {
  architecture: ArchitectureBenchmarkReport
  calibration: {
    uniform: BeliefCalibrationReport
    weighted: BeliefCalibrationReport
    delta: PairedCalibrationDelta
  }
}

export function phase5QuestCalibration(
  artifacts: readonly GameArtifact[],
): Phase5QuestBenchReport['calibration'] {
  const uniform = predictionRows(artifacts, 'uniform-calibration')
  const weighted = predictionRows(
    artifacts,
    'quest-weighted-calibration',
  )
  return {
    uniform: beliefCalibrationReport(uniform),
    weighted: beliefCalibrationReport(weighted),
    delta: pairedCalibrationDelta(uniform, weighted),
  }
}

export async function runPhase5QuestBench(
  options: {
    cases?: readonly ArchitectureBankCase[]
    out?: string
    opponentKind?: Extract<AgentSpec['type'], 'heuristic' | 'random'>
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<Phase5QuestBenchReport> {
  const artifacts = await runArchitectureBench({
    variants: phase5QuestVariants(),
    cases: options.cases ?? PHASE4_POLICY_BANK,
    bankId: PHASE5_QUEST_BANK_ID,
    opponentKind: options.opponentKind,
    out: options.out,
    onProgress: options.onProgress,
  })
  return {
    architecture: architectureReport(artifacts),
    calibration: phase5QuestCalibration(artifacts),
  }
}

function renderCalibration(
  report: Phase5QuestBenchReport['calibration'],
): string {
  const metric = (value: number | null): string =>
    value === null ? 'n/a' : value.toFixed(6)
  return [
    'CALIBRATION held-out paired rows',
    `uniform ${report.uniform.overall.rows} rows, Brier ${
      metric(report.uniform.overall.brier)
    }, log loss ${metric(report.uniform.overall.logLoss)}`,
    `weighted ${report.weighted.overall.rows} rows, Brier ${
      metric(report.weighted.overall.brier)
    }, log loss ${metric(report.weighted.overall.logLoss)}`,
    `delta weighted-uniform: Brier ${
      report.delta.brier >= 0 ? '+' : ''
    }${report.delta.brier.toFixed(6)}, log loss ${
      report.delta.logLoss >= 0 ? '+' : ''
    }${report.delta.logLoss.toFixed(6)}`,
  ].join('\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: `data/eval/${PHASE5_QUEST_BANK_ID}.jsonl`,
      },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      opponents: { type: 'string', default: 'heuristic' },
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
  if (!['heuristic', 'random'].includes(values.opponents!)) {
    throw new Error('--opponents must be heuristic or random')
  }
  assertFreshArchitectureOutput(values.out!)
  const report = await runPhase5QuestBench({
    cases: PHASE4_POLICY_BANK.slice(0, limit),
    out: values.out,
    opponentKind: values.opponents as 'heuristic' | 'random',
    onProgress: values.quiet
      ? undefined
      : (line) => console.log(line),
  })
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderArchitectureReport(report.architecture)}\n`
        + `${renderCalibration(report.calibration)}\n`,
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
