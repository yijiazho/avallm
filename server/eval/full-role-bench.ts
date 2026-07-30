// API-free playing-strength comparison for the complete Phase 7 role stack.
//
// Phase 7F2B proved causal correctness: the configured role layer drives the
// action and exact replay reconstructs it. It did not measure whether the stack
// plays better. The last strength measurements were adverse (Phase 4D's 540-game
// run) and population dependent (Phase 5C's sign flip), so this bench reuses
// frozen banks and the same matched-case paired comparison to answer the one
// question a default promotion or a demo depends on.
//
// Scope, stated plainly: a bank's target seats decide which layers can be
// causal. `phase4-good-v1` targets Merlin, Percival, and Servant, so it
// measures the good half; `phase7-evil-v1` (NB-011) targets Morgana, Assassin,
// Mordred, and the generic Minion, so it measures the evil half. Both sides are
// run from the same variant ladder and the same matched-case paired comparison.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createComposedAgent } from '../agents/composed.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
} from '../agents/belief/identity.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../agents/analysis/observer-types.ts'
import {
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../agents/analysis/evil-objective-types.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../agents/policy/evil-quest-card.ts'
import {
  CANDIDATE_SCORER_VERSION,
  fullRolePolicyScorer,
  goodProposalScorer,
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
import {
  PHASE7_EVIL_POLICY_BANK,
  PHASE7_EVIL_POLICY_BANK_ID,
} from './evil-policy-bank.ts'
import {
  routedRoleObjectiveModel,
} from '../agents/analysis/role-objective-router.ts'
import type { AgentSpec } from '../agents/types.ts'
import type { Role } from '../engine/types.ts'
import type { ArchitectureBankCase } from './architecture-bank.ts'

export const PHASE7_FULL_ROLE_EVAL_VERSION = 'phase7-full-role-eval-v1'
export const PHASE7_FULL_ROLE_BANK_ID =
  `${PHASE4_POLICY_BANK_ID}-full-role`
export const PHASE7_FULL_ROLE_EVIL_BANK_ID =
  `${PHASE7_EVIL_POLICY_BANK_ID}-full-role`

/** Which half of the role stack a bank's target seats can make causal. */
export type Phase7FullRoleSide = 'good' | 'evil'

export interface Phase7FullRoleBank {
  side: Phase7FullRoleSide
  id: string
  cases: readonly ArchitectureBankCase[]
  /** One line naming exactly what this bank does and does not measure. */
  scope: string
}

export const PHASE7_FULL_ROLE_BANKS:
  Readonly<Record<Phase7FullRoleSide, Phase7FullRoleBank>> = Object.freeze({
    good: Object.freeze({
      side: 'good',
      id: PHASE7_FULL_ROLE_BANK_ID,
      cases: PHASE4_POLICY_BANK,
      scope:
        `${PHASE4_POLICY_BANK_ID} targets Merlin, Percival, and Servant, so the `
        + 'evil role layers are not causal here.',
    }),
    evil: Object.freeze({
      side: 'evil',
      id: PHASE7_FULL_ROLE_EVIL_BANK_ID,
      cases: PHASE7_EVIL_POLICY_BANK,
      scope:
        `${PHASE7_EVIL_POLICY_BANK_ID} targets Morgana, Assassin, Mordred, and `
        + 'the generic Minion, so the good role layers are not causal here and '
        + 'Oberon is not covered.',
    }),
  })

export const PHASE7_FULL_ROLE_VARIANTS = {
  compatibility: 'compatibility',
  proposalOnly: 'good-proposal-only',
  baseComposed: 'base-composed',
  fullRole: 'full-role',
} as const

export type Phase7FullRolePopulation =
  Extract<AgentSpec['type'], 'heuristic' | 'random'>

const common = (
  mode: 'compatibility' | 'structured-only',
  scorer: string,
  evaluationRole: 'baseline' | 'candidate' | 'ablation',
): Record<string, string> => ({
  evaluation: PHASE7_FULL_ROLE_EVAL_VERSION,
  evaluationRole,
  mode,
  brain: 'brain-spec-v1',
  policy: 'composed-policy-v1',
  scorer,
  planner: 'planner-off',
  voice: 'voice-off',
})

/**
 * Declared labels are per target role, not per variant. The router resolves no
 * role objective for a Servant seat, so no joint identity is projected there
 * and declaring one would be untrue. The configured graph is identical either
 * way; only the labels that can be causal for this target differ.
 */
const fullRoleComponents = (targetRole: Role): Record<string, string> => ({
  ...common('structured-only', fullRolePolicyScorer.version, 'candidate'),
  observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
  ...(routedRoleObjectiveModel(targetRole) === 'off'
    ? {}
    : {
        identityModel: JOINT_IDENTITY_MODEL_VERSION,
        roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
      }),
  evilQuestCardPolicy: EVIL_QUEST_ROBUST_POLICY_VERSION,
  populationAssumption: 'heterogeneous-independent',
})

/**
 * The declared order is the comparison order: `architectureReport` treats the
 * first variant as the paired baseline, so compatibility stays first.
 */
export function phase7FullRoleVariantsFor(
  targetRole: Role,
): readonly ArchitectureVariant[] {
  return Object.freeze([
    {
      id: PHASE7_FULL_ROLE_VARIANTS.compatibility,
      descriptor: `${PHASE7_FULL_ROLE_EVAL_VERSION}:compatibility`,
      paid: false,
      components: common(
        'compatibility',
        CANDIDATE_SCORER_VERSION,
        'baseline',
      ),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
      }),
    },
    {
      // Isolates the channel: structured proposal value with compatibility
      // votes. If the win-rate loss disappears here, the defect is in the vote
      // value function, not the proposal one.
      id: PHASE7_FULL_ROLE_VARIANTS.proposalOnly,
      descriptor: `${PHASE7_FULL_ROLE_EVAL_VERSION}:good-proposal-only`,
      paid: false,
      components: common(
        'structured-only',
        goodProposalScorer.version,
        'ablation',
      ),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
        scorer: goodProposalScorer,
      }),
    },
    {
      id: PHASE7_FULL_ROLE_VARIANTS.baseComposed,
      descriptor: `${PHASE7_FULL_ROLE_EVAL_VERSION}:base-composed`,
      paid: false,
      components: common(
        'structured-only',
        goodProposalVoteScorer.version,
        'ablation',
      ),
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
        scorer: goodProposalVoteScorer,
      }),
    },
    {
      id: PHASE7_FULL_ROLE_VARIANTS.fullRole,
      descriptor: `${PHASE7_FULL_ROLE_EVAL_VERSION}:full-role`,
      paid: false,
      components: fullRoleComponents(targetRole),
      // The canonical full-role configuration, identical to the Phase 7F
      // role-bank arm, so a promotion or demo inherits this exact number.
      createTargetAgent: (context) => createComposedAgent({
        seed: context.seed,
        onDecisionTrace: context.onDecisionTrace,
        scorer: fullRolePolicyScorer,
        roleObjectiveRouter: true,
        evilQuestCardPolicy: 'robust-heterogeneous',
      }),
    },
  ])
}

export interface Phase7FullRoleBenchReport {
  version: typeof PHASE7_FULL_ROLE_EVAL_VERSION
  side: Phase7FullRoleSide
  bank: string
  cases: number
  /** Keyed by population, then by the bank's target role. */
  byPopulation: Partial<Record<
    Phase7FullRolePopulation,
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

export async function runPhase7FullRoleBench(
  options: {
    bank?: Phase7FullRoleBank
    cases?: readonly ArchitectureBankCase[]
    out?: string
    opponentKinds?: readonly Phase7FullRolePopulation[]
    onProgress?: ArchitectureBenchOpts['onProgress']
  } = {},
): Promise<Phase7FullRoleBenchReport> {
  const bank = options.bank ?? PHASE7_FULL_ROLE_BANKS.good
  const cases = options.cases ?? bank.cases
  const opponentKinds = options.opponentKinds ?? ['heuristic', 'random']
  if (
    !opponentKinds.length
    || new Set(opponentKinds).size !== opponentKinds.length
  ) {
    throw new Error('the full-role bench requires unique opponent populations')
  }
  const groups = caseGroups(cases)
  // A --cases slice can drop whole target roles and table sizes. Say so rather
  // than letting the case count imply the comparison covered the bank it is
  // named after.
  const fullRoles = new Set(bank.cases.map((entry) => entry.targetRole))
  if (groups.length !== fullRoles.size || cases.length !== bank.cases.length) {
    options.onProgress?.(
      `partial bank: ${cases.length} of ${bank.cases.length} cases, `
      + `target roles ${groups.map((group) => group.targetRole).join(', ')} `
      + `of ${[...fullRoles].join(', ')}`,
    )
  }
  const byPopulation: Phase7FullRoleBenchReport['byPopulation'] = {}
  for (const opponentKind of opponentKinds) {
    const byRole: Record<string, ArchitectureBenchmarkReport> = {}
    for (const group of groups) {
      options.onProgress?.(
        `population ${opponentKind}, target ${group.targetRole}, `
        + `${group.cases.length} cases`,
      )
      const artifacts = await runArchitectureBench({
        variants: phase7FullRoleVariantsFor(group.targetRole),
        cases: group.cases,
        // Population-qualified so one output file stays self-describing. A
        // shared id would repeat every variant/case cell across populations,
        // which architectureReport rejects as a duplicate result.
        bankId: `${bank.id}-${opponentKind}`,
        opponentKind,
        out: options.out,
        onProgress: options.onProgress,
      })
      byRole[group.targetRole] = architectureReport(artifacts)
    }
    byPopulation[opponentKind] = Object.freeze(byRole)
  }
  return {
    version: PHASE7_FULL_ROLE_EVAL_VERSION,
    side: bank.side,
    bank: bank.id,
    cases: cases.length,
    byPopulation,
  }
}

function render(report: Phase7FullRoleBenchReport): string {
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
  lines.push(`scope: ${PHASE7_FULL_ROLE_BANKS[report.side].scope}`)
  if (report.side === 'evil') {
    // targetWinRate is alignment relative and reads correctly for an evil
    // seat. The other two rates are defined from the good side (a clean team,
    // a truthful vote), so an evil target scores low on them by playing well.
    lines.push(
      'read targetWinRate only: clean-proposal and vote-truth are good-side',
      'definitions and invert for an evil target seat.',
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      side: { type: 'string', default: 'good' },
      'target-role': { type: 'string' },
      out: { type: 'string' },
      cases: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      opponents: { type: 'string', default: 'both' },
    },
  })
  if (values.side !== 'good' && values.side !== 'evil') {
    throw new Error('--side must be good or evil')
  }
  const bank = PHASE7_FULL_ROLE_BANKS[values.side]
  // Per-role groups are reported independently, so restricting to one role is
  // an exact shard of the same run rather than a different comparison. It is
  // how a 240-deal bank stays runnable in parallel and re-runnable one role at
  // a time.
  const targetRole = values['target-role']
  const selected = targetRole === undefined
    ? bank.cases
    : bank.cases.filter((entry) => entry.targetRole === targetRole)
  if (!selected.length) {
    throw new Error(
      `--target-role must be one of ${
        [...new Set(bank.cases.map((entry) => entry.targetRole))].join(', ')
      }`,
    )
  }
  const limit = values.cases === undefined
    ? selected.length
    : Number(values.cases)
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > selected.length
  ) {
    throw new Error(
      `--cases must be an integer from 1 to ${selected.length}`,
    )
  }
  if (!['heuristic', 'random', 'both'].includes(values.opponents!)) {
    throw new Error('--opponents must be heuristic, random, or both')
  }
  const opponentKinds: readonly Phase7FullRolePopulation[] =
    values.opponents === 'both'
      ? ['heuristic', 'random']
      : [values.opponents as Phase7FullRolePopulation]
  // Every narrowing flag has to reach the default path. Two shards that differ
  // only by population would otherwise append to one file concurrently, and
  // artifacts here run to hundreds of kilobytes, so the interleaved writes tear
  // JSON lines apart. assertFreshArchitectureOutput cannot catch that: both
  // processes check before either writes. The unnarrowed path is unchanged.
  const out = values.out ?? `data/eval/${bank.id}${
    targetRole ? `-${targetRole}` : ''
  }${values.opponents === 'both' ? '' : `-${values.opponents}`}.jsonl`
  assertFreshArchitectureOutput(out)
  const report = await runPhase7FullRoleBench({
    bank,
    cases: selected.slice(0, limit),
    out,
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
