// Migration phase 7F2A; see docs/agent-architecture-migration.md.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../../agents/composed.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../../agents/analysis/observer-types.ts'
import {
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../../agents/analysis/evil-objective-types.ts'
import { JOINT_IDENTITY_MODEL_VERSION } from '../../agents/belief/identity.ts'
import {
  CANDIDATE_SCORER_VERSION,
  assassinMerlinTargetScorer,
  evilRoleObjectiveScorer,
  fullRolePolicyScorer,
  goodProposalVoteScorer,
  morganaRoleScorer,
  mordredBlindnessRoleScorer,
  roleObjectiveScorer,
  type CandidateScorer,
} from '../../agents/policy/score.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../../agents/policy/evil-quest-card.ts'
import {
  ARCHITECTURE_BANK,
  ARCHITECTURE_BANK_ID,
  type ArchitectureBankCase,
} from '../banks/architecture-bank.ts'
import {
  assertFreshArchitectureOutput,
  runArchitectureBench,
  type ArchitectureBenchOpts,
  type ArchitectureVariant,
} from '../harness/architecture-bench.ts'
import {
  architectureReport,
  type ArchitectureBenchmarkReport,
  type ArchitectureVariantSummary,
} from '../architecture-report.ts'
import {
  runVirtualAssassinEvaluation,
  type VirtualAssassinEvidence,
} from '../harness/virtual-assassin.ts'
import { artifactPlayerAt, type GameArtifact } from '../core/artifact.ts'
import type { Role } from '../../engine/types.ts'

export const PHASE7_ROLE_EVAL_VERSION = 'phase7-role-eval-v1'
export const PHASE7_ROLE_EVAL_BANK_ID = `${ARCHITECTURE_BANK_ID}-phase7-roles`

export const PHASE7_ROLE_EVAL_ARMS = Object.freeze([
  'compatibility',
  'base-composed',
  'observer-only',
  'isolated-role',
  'full-role',
] as const)

export type Phase7RoleEvalArm = typeof PHASE7_ROLE_EVAL_ARMS[number]

export interface Phase7RoleEvidenceRow {
  readonly schema: 1
  readonly evaluation: typeof PHASE7_ROLE_EVAL_VERSION
  readonly rowId: string
  readonly caseId: string
  readonly logicalArm: Phase7RoleEvalArm
  readonly rawVariantId: string
  readonly rawAgentDescriptor: string
  readonly rawIdentityDigest: string
  readonly configuredScorer: string
  readonly targetRole: Role
  readonly targetSeat: number
  readonly winner: 'good' | 'evil'
  readonly targetWon: boolean
  readonly logDigest: string
  readonly decisionDigest: string
  readonly calls: number
  readonly cost: number
  readonly degradation: number
  readonly forcedViolations: number
  readonly exactAdmission: Readonly<{
    eligible: boolean
    decisions: number
    exact: number
    structural: number
  }>
  readonly safety: Readonly<{
    hiddenChecks: number
    hiddenViolations: number
    attributionChecks: number
    attributionViolations: number
  }>
  readonly terminal: boolean
}

export interface Phase7RoleEvalRun {
  readonly rows: readonly Phase7RoleEvidenceRow[]
  readonly artifacts: readonly GameArtifact[]
  readonly architecture: ArchitectureBenchmarkReport
  readonly virtualAssassin: readonly VirtualAssassinEvidence[]
}

export function resolvePhase7RoleOutputPaths(
  out: string,
  virtualOut?: string,
): Readonly<{ out: string; virtualOut: string }> {
  const resolvedOut = resolve(out)
  const resolvedVirtualOut = resolve(
    virtualOut ?? `${resolvedOut}.virtual-assassin.jsonl`,
  )
  const identity = (value: string): string =>
    process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
  if (identity(resolvedOut) === identity(resolvedVirtualOut)) {
    throw new Error('--out and --virtual-out must resolve to different files')
  }
  return Object.freeze({
    out: resolvedOut,
    virtualOut: resolvedVirtualOut,
  })
}

const commonComponents = (
  scorer: string,
): Record<string, string> => ({
  evaluation: PHASE7_ROLE_EVAL_VERSION,
  brain: 'brain-spec-v1',
  policy: 'composed-policy-v1',
  scorer,
  planner: 'planner-off',
  voice: 'voice-off',
})

const routedComponents = (
  scorer: CandidateScorer,
): Record<string, string> => ({
  ...commonComponents(scorer.version),
  observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
  identityModel: JOINT_IDENTITY_MODEL_VERSION,
  roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
})

function isolatedScorer(role: Role): {
  id: string
  scorer: CandidateScorer
  routed: boolean
} {
  switch (role) {
    case 'merlin':
    case 'percival':
      return { id: `isolated-good-role-${role}`, scorer: roleObjectiveScorer, routed: true }
    case 'servant':
      return { id: 'isolated-good-base-servant', scorer: goodProposalVoteScorer, routed: false }
    case 'morgana':
      return { id: 'isolated-morgana', scorer: morganaRoleScorer, routed: true }
    case 'mordred':
      return { id: 'isolated-mordred', scorer: mordredBlindnessRoleScorer, routed: true }
    case 'assassin':
      return { id: 'isolated-assassin', scorer: assassinMerlinTargetScorer, routed: true }
    case 'oberon':
    case 'minion':
      return { id: `isolated-shared-evil-${role}`, scorer: evilRoleObjectiveScorer, routed: true }
  }
}

function composedVariant(input: {
  id: string
  scorer?: CandidateScorer
  observer?: boolean
  router?: boolean
  robustQuest?: boolean
  components: Record<string, string>
}): ArchitectureVariant {
  return {
    id: input.id,
    descriptor: `phase7-role-eval:${input.id}`,
    paid: false,
    components: {
      ...input.components,
      ...(input.robustQuest
        ? {
            evilQuestCardPolicy: EVIL_QUEST_ROBUST_POLICY_VERSION,
            populationAssumption: 'heterogeneous-independent',
          }
        : {}),
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      ...(context.onDecisionTrace === undefined
        ? {}
        : { onDecisionTrace: context.onDecisionTrace }),
      ...(input.scorer ? { scorer: input.scorer } : {}),
      ...(input.observer ? { publicObserver: true } : {}),
      ...(input.router ? { roleObjectiveRouter: true } : {}),
      ...(input.robustQuest
        ? { evilQuestCardPolicy: 'robust-heterogeneous' }
        : {}),
    }),
  }
}

export function phase7RoleVariantsFor(
  role: Role,
): readonly ArchitectureVariant[] {
  const isolated = isolatedScorer(role)
  const compatibility = commonComponents(CANDIDATE_SCORER_VERSION)
  const base = commonComponents(goodProposalVoteScorer.version)
  return Object.freeze([
    composedVariant({
      id: 'compatibility',
      components: compatibility,
    }),
    composedVariant({
      id: 'base-composed',
      scorer: goodProposalVoteScorer,
      components: base,
    }),
    composedVariant({
      id: 'observer-only',
      scorer: goodProposalVoteScorer,
      observer: true,
      components: {
        ...base,
        observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
      },
    }),
    composedVariant({
      id: isolated.id,
      scorer: isolated.scorer,
      router: isolated.routed,
      components: isolated.routed
        ? routedComponents(isolated.scorer)
        : base,
    }),
    composedVariant({
      id: 'full-role',
      scorer: fullRolePolicyScorer,
      router: true,
      robustQuest: true,
      // Servant has no role-specific layer. The resolved identity remains
      // the complete configured graph, while per-case labels match the
      // components that can actually be causal for the target role.
      components: role === 'servant'
        ? {
            ...commonComponents(fullRolePolicyScorer.version),
            observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
          }
        : routedComponents(fullRolePolicyScorer),
    }),
  ])
}

const armFor = (rawVariantId: string): Phase7RoleEvalArm =>
  rawVariantId === 'compatibility'
    ? 'compatibility'
    : rawVariantId === 'base-composed'
      ? 'base-composed'
      : rawVariantId === 'observer-only'
        ? 'observer-only'
        : rawVariantId === 'full-role'
          ? 'full-role'
          : 'isolated-role'

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function phase7RoleEvidenceRow(
  artifact: GameArtifact,
): Phase7RoleEvidenceRow {
  const meta = artifact.architecture
  if (!meta) throw new Error(`${artifact.id}: missing architecture metadata`)
  const summaries = architectureReport([artifact]).variants
  if (summaries.length !== 1) {
    throw new Error(`${artifact.id}: expected one architecture summary`)
  }
  const summary: ArchitectureVariantSummary = summaries[0]!
  const manifest = artifact.strategyVersions?.resolvedArchitecture
  if (!manifest) throw new Error(`${artifact.id}: missing resolved identity`)
  const target = artifactPlayerAt(artifact, meta.targetSeat)
  const componentEvidence = summary.componentEvidence
  if (!componentEvidence) {
    throw new Error(`${artifact.id}: missing exact component evidence`)
  }
  const rowId = `${meta.caseId}:${armFor(meta.variant)}`
  return Object.freeze({
    schema: 1,
    evaluation: PHASE7_ROLE_EVAL_VERSION,
    rowId,
    caseId: meta.caseId,
    logicalArm: armFor(meta.variant),
    rawVariantId: meta.variant,
    rawAgentDescriptor: target.agent,
    rawIdentityDigest: manifest.identityDigest,
    configuredScorer:
      manifest.identity.configuredPipeline.scoring.configuredScorer,
    targetRole: meta.targetRole,
    targetSeat: meta.targetSeat,
    winner: artifact.winner,
    targetWon: target.alignment === artifact.winner,
    logDigest: sha256(artifact.log),
    decisionDigest: sha256(
      (artifact.decisionTraces ?? []).map((trace) => ({
        decisionId: trace.decisionId,
        request: trace.request,
        action: trace.action,
        chosenCandidateId: trace.chosenCandidateId,
      })),
    ),
    calls: summary.calls,
    cost: summary.cost,
    degradation: summary.degraded,
    forcedViolations: summary.forcedViolations,
    exactAdmission: Object.freeze({
      eligible: componentEvidence.promotionEvidenceEligible,
      decisions: componentEvidence.decisions,
      exact: componentEvidence.exact,
      structural: componentEvidence.structural,
    }),
    safety: Object.freeze({
      hiddenChecks: summary.safety.hiddenInformationChecks,
      hiddenViolations: summary.safety.hiddenInformationViolations,
      attributionChecks: summary.safety.traceAttributionChecks,
      attributionViolations: summary.safety.traceAttributionViolations,
    }),
    terminal: artifact.log.at(-1)?.type === 'gameOver',
  })
}

export function serializePhase7RoleEvidence(
  rows: readonly Phase7RoleEvidenceRow[],
): string {
  return [...rows]
    .sort((left, right) => left.rowId.localeCompare(right.rowId))
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n'
}

export function serializeVirtualAssassinEvidence(
  rows: readonly VirtualAssassinEvidence[],
): string {
  return [...rows]
    .sort((left, right) =>
      left.historyId.localeCompare(right.historyId)
      || left.predictorSeat - right.predictorSeat)
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n'
}

export async function runPhase7RoleEval(options: {
  cases?: readonly ArchitectureBankCase[]
  onProgress?: ArchitectureBenchOpts['onProgress']
} = {}): Promise<Phase7RoleEvalRun> {
  const cases = options.cases ?? ARCHITECTURE_BANK
  const artifacts: GameArtifact[] = []
  for (const bankCase of cases) {
    artifacts.push(...await runArchitectureBench({
      variants: phase7RoleVariantsFor(bankCase.targetRole),
      cases: [bankCase],
      bankId: PHASE7_ROLE_EVAL_BANK_ID,
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: options.onProgress }),
    }))
  }
  const rows = Object.freeze(artifacts.map(phase7RoleEvidenceRow)
    .sort((left, right) => left.rowId.localeCompare(right.rowId)))
  return Object.freeze({
    rows,
    artifacts: Object.freeze(artifacts),
    architecture: architectureReport(artifacts),
    virtualAssassin: runVirtualAssassinEvaluation(),
  })
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
        default: 'data/eval/phase7-role-evidence-v1.jsonl',
      },
      'virtual-out': { type: 'string' },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
    },
  })
  const limit = values.cases === undefined
    ? ARCHITECTURE_BANK.length
    : Number(values.cases)
  if (!Number.isInteger(limit) || limit < 1 || limit > ARCHITECTURE_BANK.length) {
    throw new Error(`--cases must be an integer from 1 to ${ARCHITECTURE_BANK.length}`)
  }
  const outputs = resolvePhase7RoleOutputPaths(
    values.out!,
    values['virtual-out'],
  )
  assertFreshArchitectureOutput(outputs.out)
  assertFreshArchitectureOutput(outputs.virtualOut)
  const result = await runPhase7RoleEval({
    cases: ARCHITECTURE_BANK.slice(0, limit),
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  mkdirSync(dirname(outputs.out), { recursive: true })
  mkdirSync(dirname(outputs.virtualOut), { recursive: true })
  writeFileSync(outputs.out, serializePhase7RoleEvidence(result.rows))
  writeFileSync(
    outputs.virtualOut,
    serializeVirtualAssassinEvidence(result.virtualAssassin),
  )
  process.stdout.write(
    `${result.rows.length} role evidence rows and `
    + `${result.virtualAssassin.length} virtual Assassin guesses -> `
    + `${outputs.out}, ${outputs.virtualOut}\n`,
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
