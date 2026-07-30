// Phase 0 architecture benchmark runner.
//
// It reuses the normal game runner, agent registry, artifact format, and fixed
// architecture bank. Only the selected role seat changes between variants;
// every opponent remains the same heuristic baseline. LLM variants require an
// explicit allowPaid flag so importing or smoke-testing this module cannot
// spend money accidentally.

import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createGame } from '../engine/game.ts'
import { createAgent, createAgentFromDef } from '../agents/registry.ts'
import { loadAgentLibrary, resolveModel } from '../agents/defs.ts'
import { runGame } from '../sim/runner.ts'
import { appendArtifact, toArtifact } from './artifact.ts'
import {
  ACTIVE_LANGUAGE_ARCHITECTURE_BANK,
  ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID,
  ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE,
  ARCHITECTURE_BANK,
  ARCHITECTURE_BANK_ID,
  STANDARD_ARCHITECTURE_BANK_PROFILE,
  validateArchitectureBank,
} from './architecture-bank.ts'
import type { AgentDef } from '../agents/defs.ts'
import type {
  AgentContext,
  AgentSpec,
  AvalonAgent,
} from '../agents/types.ts'
import type { OpenRouterClient, SpendEntry } from '../llm/openrouter.ts'
import type { GameArtifact } from './artifact.ts'
import type {
  ArchitectureBankCase,
  ArchitectureBankProfile,
} from './architecture-bank.ts'
import type { Seat } from '../engine/types.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
  type DecisionTrace,
} from '../agents/trace.ts'
import {
  brainComponents,
  resolveBrain,
  type AgentExecutionMode,
} from '../agents/brain.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from '../agents/belief/language-factor.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../agents/belief/types.ts'
import {
  validatePublicObserverSnapshot,
} from '../agents/analysis/observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../agents/analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentityHostJoin,
} from '../agents/belief/identity.ts'
import {
  PLAN_MEMORY_VERSION,
  validateAppliedPlanOutcomeHostJoin,
} from '../agents/cognition/plan-memory.ts'
import { COHERENCE_MODEL_VERSION } from '../agents/cognition/coherence.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../agents/analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  validatePrivateRoleObjectiveHostJoin,
} from '../agents/analysis/role-objectives.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
} from '../agents/analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../agents/analysis/evil-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from '../agents/analysis/role-objective-router.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  buildRoleUtilityProjection,
  validatePrivateRoleUtilityHostJoin,
} from '../agents/analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  buildEvilRoleUtilityProjection,
  validatePrivateEvilRoleUtilityHostJoin,
} from '../agents/analysis/evil-role-utility.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../agents/policy/score.ts'
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../agents/policy/candidates.ts'
import {
  authoritativeDecisionReplay,
  decisionTraceReplayJoin,
  exactTargetTraceCoverage,
  selectedDecisionReplayJoin,
} from './trace-replay.ts'
import {
  admitCanonicalDecisionTrace,
  snapshotDecisionTraceInput,
} from '../agents/admission/composed-trace.ts'
import {
  componentPayload,
  decisionComponentPlan,
  type DecisionComponentPlan,
} from '../agents/components/kernel.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../agents/components/native-score-components.ts'
import {
  projectResolvedArchitectureIdentity,
  type
  ResolvedArchitectureDescriptor,
  type
  ResolvedComposedBrain,
} from '../agents/components/resolved-brain.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../agents/policy/evil-quest-card.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
} from '../agents/analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../agents/analysis/morgana-role-utility.ts'

export interface ArchitectureVariant {
  id: string
  /**
   * Normal registry-backed variant. Custom factories are an API-free
   * evaluation seam and never enter the production agent registry.
   */
  agent?: AgentDef
  createTargetAgent?: (context: AgentContext) => AvalonAgent
  descriptor?: string
  /** Required for custom factories so a benchmark cannot omit cost intent. */
  paid?: boolean
  modelOverride?: string
  components: Record<string, string>
}

export interface ArchitectureBenchOpts {
  variants: readonly ArchitectureVariant[]
  cases?: readonly ArchitectureBankCase[]
  bankId?: string
  /**
   * Discussion-enabled banks require an explicit, versioned profile. Omitting
   * this field retains the frozen Phase 0 no-discussion contract.
   */
  bankProfile?: ArchitectureBankProfile
  /** Free, deterministic population used for every non-target seat. */
  opponentKind?: Extract<AgentSpec['type'], 'heuristic' | 'random'>
  out?: string
  allowPaid?: boolean
  onProgress?: (line: string) => void
}

type SpendMap = Record<string, SpendEntry>
type DecisionLatencySample = NonNullable<
  NonNullable<GameArtifact['telemetry']>['decisionLatency']
>['samples'][number]

export const PHASE0_COMPONENT_VERSIONS = {
  heuristicPolicy: 'heuristic-v1',
  promptGuidedPolicy: 'prompt-guided-v1',
  promptGuidedCommunication: 'prompt-voice-v1',
} as const

export function copySpend(spend: SpendMap): SpendMap {
  return structuredClone(spend)
}

export function spendDelta(before: SpendMap, after: SpendMap): SpendMap {
  const delta: SpendMap = {}
  for (const [tag, end] of Object.entries(after)) {
    const start = before[tag]
    const providers: Record<string, number> = {}
    for (const [provider, count] of Object.entries(end.providers)) {
      const change = count - (start?.providers[provider] ?? 0)
      if (change) providers[provider] = change
    }
    const entry: SpendEntry = {
      cost: end.cost - (start?.cost ?? 0),
      calls: end.calls - (start?.calls ?? 0),
      prompt: end.prompt - (start?.prompt ?? 0),
      completion: end.completion - (start?.completion ?? 0),
      reasoning: end.reasoning - (start?.reasoning ?? 0),
      reasoningLeakCalls: end.reasoningLeakCalls - (start?.reasoningLeakCalls ?? 0),
      providerViolationCalls: end.providerViolationCalls - (start?.providerViolationCalls ?? 0),
      model: end.model,
      providers,
    }
    if (
      entry.calls
      || entry.cost
      || entry.prompt
      || entry.completion
      || entry.reasoning
      || entry.reasoningLeakCalls
      || entry.providerViolationCalls
    ) {
      delta[tag] = entry
    }
  }
  return delta
}

export function assertFreshArchitectureOutput(file: string): void {
  if (!fs.existsSync(file)) return
  const stat = fs.statSync(file)
  if (stat.isFile() && stat.size === 0) return
  throw new Error(
    `${file}: refusing to append architecture results to an existing corpus; `
    + 'choose a fresh --out path or remove the old file first',
  )
}

function withDecisionTiming(
  agent: AvalonAgent,
  samples: DecisionLatencySample[],
): AvalonAgent {
  return {
    async decide(req, view) {
      const started = performance.now()
      try {
        return await agent.decide(req, view)
      } finally {
        samples.push({
          kind: req.kind,
          milliseconds: Math.max(0, performance.now() - started),
        })
      }
    },
    ...(agent.recordDecisionTrace
      ? {
          recordDecisionTrace: (trace: DecisionTrace) =>
            agent.recordDecisionTrace!.call(agent, trace),
        }
      : {}),
    ...(agent.recordFallbackTrace
      ? {
          recordFallbackTrace: (
            req: Parameters<NonNullable<
              AvalonAgent['recordFallbackTrace']
            >>[0],
            view: Parameters<NonNullable<
              AvalonAgent['recordFallbackTrace']
            >>[1],
            decision: Parameters<NonNullable<
              AvalonAgent['recordFallbackTrace']
            >>[2],
          ) => agent.recordFallbackTrace!.call(
            agent,
            req,
            view,
            decision,
          ),
        }
      : {}),
    ...(agent.recordAppliedDecisionOutcome
      ? {
          recordAppliedDecisionOutcome: (
            outcome: Parameters<NonNullable<
              AvalonAgent['recordAppliedDecisionOutcome']
            >>[0],
          ) => agent.recordAppliedDecisionOutcome!.call(agent, outcome),
        }
      : {}),
    ...(agent.dispose
      ? { dispose: () => agent.dispose!.call(agent) }
      : {}),
  }
}

function isPaid(variant: ArchitectureVariant): boolean {
  return variant.paid === true || variant.agent?.engine.type === 'llm'
}

export function defaultComponents(def: AgentDef, modelOverride?: string): Record<string, string> {
  const version = def.version ? `v${def.version}` : 'unversioned'
  if (def.engine.type === 'heuristic') {
    return {
      agent: `${def.id}@${version}`,
      model: 'none',
      ...brainComponents(resolveBrain(def.engine)),
    }
  }
  if (def.engine.type === 'stdio') {
    return {
      agent: `${def.id}@${version}`,
      model: 'external',
      ...brainComponents(resolveBrain(def.engine)),
    }
  }
  return {
    agent: `${def.id}@${version}`,
    model: resolveModel(def, modelOverride),
    ...brainComponents(resolveBrain(def.engine)),
  }
}

function resolvedVariantComponents(variant: ArchitectureVariant): Record<string, string> {
  if (!!variant.agent === !!variant.createTargetAgent) {
    throw new Error(
      `architecture variant ${variant.id} must supply exactly one agent or createTargetAgent`,
    )
  }
  if (variant.createTargetAgent) {
    if (typeof variant.paid !== 'boolean') {
      throw new Error(
        `custom architecture variant ${variant.id} must declare paid true or false`,
      )
    }
    for (const key of [
      'mode',
      'brain',
      'policy',
      'scorer',
      'planner',
      'voice',
    ]) {
      if (!variant.components[key]?.trim()) {
        throw new Error(
          `custom architecture variant ${variant.id} requires component ${key}`,
        )
      }
    }
    const modes: readonly AgentExecutionMode[] = [
      'raw-llm',
      'heuristic',
      'random',
      'external',
      'compatibility',
      'structured-only',
      'hybrid',
    ]
    if (!modes.includes(variant.components.mode as AgentExecutionMode)) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid mode ${variant.components.mode}`,
      )
    }
    const languageEnabled =
      variant.components.languageEvidence === LANGUAGE_FACTOR_BUNDLE_VERSION
    if (
      variant.components.identityModel !== undefined
      && variant.components.identityModel !== JOINT_IDENTITY_MODEL_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid identityModel`,
      )
    }
    if (
      variant.components.roleObjective !== undefined
      && variant.components.roleObjective !== ROLE_OBJECTIVE_MODEL_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid roleObjective`,
      )
    }
    if (
      variant.components.roleObjectiveRouter !== undefined
      && (
        variant.components.roleObjectiveRouter
          !== ROLE_OBJECTIVE_ROUTER_VERSION
        || variant.components.roleObjective !== undefined
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid roleObjectiveRouter`,
      )
    }
    if (
      variant.components.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
      && (
        variant.components.identityModel !== JOINT_IDENTITY_MODEL_VERSION
        || variant.components.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} roleObjective requires exact observer and identity models`,
      )
    }
    if (
      variant.components.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
      && (
        variant.components.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
        || variant.components.identityModel !== JOINT_IDENTITY_MODEL_VERSION
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} role objective router requires exact observer and identity models`,
      )
    }
    if (
      variant.components.roleUtility !== undefined
      && variant.components.roleUtility !== ROLE_UTILITY_PROJECTION_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid roleUtility`,
      )
    }
    if (
      variant.components.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
      && (
        (
          variant.components.roleObjective !== ROLE_OBJECTIVE_MODEL_VERSION
          && variant.components.roleObjectiveRouter
            !== ROLE_OBJECTIVE_ROUTER_VERSION
        )
        || ![
          ROLE_OBJECTIVE_SCORER_VERSION,
          ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          variant.components.scorer as typeof ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} roleUtility requires role objectives and a role scorer`,
      )
    }
    if (
      variant.components.evilRoleUtility !== undefined
      && variant.components.evilRoleUtility
        !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid evilRoleUtility`,
      )
    }
    if (
      variant.components.evilQuestCardPolicy !== undefined
      && variant.components.evilQuestCardPolicy
        !== EVIL_QUEST_ROBUST_POLICY_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid evilQuestCardPolicy`,
      )
    }
    if (
      variant.components.evilQuestCardPolicy
        === EVIL_QUEST_ROBUST_POLICY_VERSION
      && variant.components.populationAssumption
        !== 'heterogeneous-independent'
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} robust D3 requires heterogeneous-independent populationAssumption`,
      )
    }
    if (
      variant.components.evilQuestCardPolicy === undefined
      && variant.components.populationAssumption !== undefined
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} populationAssumption requires evilQuestCardPolicy`,
      )
    }
    if (
      variant.components.evilRoleUtility
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && (
        variant.components.roleObjectiveRouter
          !== ROLE_OBJECTIVE_ROUTER_VERSION
        || ![
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          variant.components.scorer as typeof EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} evilRoleUtility requires the router and an evil role scorer`,
      )
    }
    if (
      variant.components.morganaCounterfeitObjective !== undefined
      && variant.components.morganaCounterfeitObjective
        !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid morganaCounterfeitObjective`,
      )
    }
    if (
      variant.components.morganaRoleUtility !== undefined
      && variant.components.morganaRoleUtility
        !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid morganaRoleUtility`,
      )
    }
    if (
      variant.components.morganaRoleUtility
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      && (
        variant.components.morganaCounterfeitObjective
          !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
        || variant.components.evilRoleUtility
          !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
        || variant.components.roleObjectiveRouter
          !== ROLE_OBJECTIVE_ROUTER_VERSION
        || ![
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          variant.components.scorer as typeof MORGANA_ROLE_SCORER_VERSION,
        )
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} Morgana policy requires E1A, D2, router, and matching scorer`,
      )
    }
    if (
      variant.components.morganaCounterfeitObjective
        === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      && (
        variant.components.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
        || variant.components.belief !== EXACT_BELIEF_MODEL_VERSION
        || variant.components.languageEvidence !== 'off'
        || variant.components.factors !== 'off'
        || !['compatibility', 'structured-only', 'hybrid'].includes(
          variant.components.mode,
        )
      )
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} Morgana counterfeit objective requires host-reconstructable exact public and private sources`,
      )
    }
    const planMemoryEnabled =
      variant.components.planMemory === PLAN_MEMORY_VERSION
      && variant.components.coherence === COHERENCE_MODEL_VERSION
    const coherenceIntentValid = ['maintain', 'conceal', 'deceive'].includes(
      String(variant.components.coherenceIntent),
    )
    if (
      (variant.components.planMemory !== undefined
        || variant.components.coherence !== undefined
        || variant.components.coherenceIntent !== undefined)
      && (!planMemoryEnabled || !coherenceIntentValid)
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} has invalid plan-memory/coherence/intent components`,
      )
    }
    if (
      planMemoryEnabled !== coherenceIntentValid
    ) {
      throw new Error(
        `custom architecture variant ${variant.id} must declare coherenceIntent iff plan memory is enabled`,
      )
    }
    if (languageEnabled) {
      if (variant.components.belief !== undefined) {
        throw new Error(
          `custom architecture variant ${variant.id} must declare actual belief versions `
          + 'in decision traces, not architecture metadata',
        )
      }
      for (const key of ['mechanicalBelief', 'beliefPipeline']) {
        if (!variant.components[key]?.trim()) {
          throw new Error(
            `custom architecture variant ${variant.id} requires component ${key} `
            + 'when language evidence is enabled',
          )
        }
      }
      return {
        factors: 'off',
        observerModel: 'off',
        ...variant.components,
      }
    }
    return {
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'off',
      ...variant.components,
    }
  }
  const def = variant.agent!
  const resolved = defaultComponents(def, variant.modelOverride)
  for (const [key, value] of Object.entries(resolved)) {
    const supplied = variant.components[key]
    if (supplied !== undefined && supplied !== value) {
      throw new Error(
        `architecture variant ${variant.id} labels ${key}=${supplied}, `
        + `but its resolved runtime uses ${key}=${value}`,
      )
    }
  }
  return { ...variant.components, ...resolved }
}

export async function runArchitectureBench(opts: ArchitectureBenchOpts): Promise<GameArtifact[]> {
  if (!opts.variants.length) throw new Error('architecture benchmark requires at least one variant')
  const bankProfile =
    opts.bankProfile ?? STANDARD_ARCHITECTURE_BANK_PROFILE
  const activeLanguageBank =
    bankProfile === ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE
  const cases = opts.cases ?? (
    activeLanguageBank
      ? ACTIVE_LANGUAGE_ARCHITECTURE_BANK
      : ARCHITECTURE_BANK
  )
  const bankId = opts.bankId ?? (
    activeLanguageBank
      ? ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID
      : ARCHITECTURE_BANK_ID
  )
  if (
    (bankId === ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID)
    !== activeLanguageBank
  ) {
    throw new Error(
      `${ACTIVE_LANGUAGE_ARCHITECTURE_BANK_ID} requires the matching `
      + `${ACTIVE_LANGUAGE_ARCHITECTURE_BANK_PROFILE} bank profile`,
    )
  }
  const opponentKind = opts.opponentKind ?? 'heuristic'
  validateArchitectureBank(cases, {
    requireCoverage: opts.cases === undefined && !activeLanguageBank,
    profile: bankProfile,
  })

  const variantIds = new Set<string>()
  for (const variant of opts.variants) {
    if (variantIds.has(variant.id)) throw new Error(`duplicate architecture variant id: ${variant.id}`)
    variantIds.add(variant.id)
    resolvedVariantComponents(variant)
  }
  if (opts.variants.some(isPaid) && !opts.allowPaid) {
    throw new Error('LLM architecture variants spend money; pass allowPaid: true (CLI: --allow-paid)')
  }

  const artifacts: GameArtifact[] = []
  for (const c of cases) {
    for (const variant of opts.variants) {
      const game = createGame({
        id: `architecture-${bankId}${
          opponentKind === 'heuristic' ? '' : `-${opponentKind}`
        }-${c.id}-${variant.id}`,
        seed: c.seed,
        playerCount: c.playerCount,
        roles: [...c.roles],
        talk: c.talk,
      })
      const target = game.players.find((p) => p.role === c.targetRole)
      if (!target || target.seat !== c.expectedTargetSeat) {
        throw new Error(
          `${c.id}: target deal drifted; expected ${c.targetRole} at seat ${c.expectedTargetSeat}, `
          + `found ${target?.seat ?? 'no seat'}`,
        )
      }

      const agents = new Map<Seat, AvalonAgent>()
      const decisionTraces: DecisionTrace[] = []
      const targetLatencySamples: DecisionLatencySample[] = []
      let expectedComponentPlan: DecisionComponentPlan | undefined
      let expectedArchitectureDescriptor:
        ResolvedArchitectureDescriptor | undefined
      let expectComponentTrace = false
      const descriptors: string[] = game.players.map(() => opponentKind)
      for (const player of game.players) {
        const ctx = {
          seed: c.seed,
          seat: player.seat,
          onDecisionTrace: (trace: DecisionTrace) =>
            decisionTraces.push(structuredClone(trace)),
        }
        if (player.seat === target.seat) {
          const targetAgent = variant.createTargetAgent
            ? variant.createTargetAgent(ctx)
            : createAgentFromDef(
                variant.agent!,
                ctx,
                variant.modelOverride,
              )
          const possibleComposed = targetAgent as AvalonAgent & {
            resolvedBrain?: () => ResolvedComposedBrain
          }
          if (typeof possibleComposed.resolvedBrain === 'function') {
            expectedArchitectureDescriptor =
              possibleComposed.resolvedBrain().description
            expectedComponentPlan = structuredClone(
              decisionComponentPlan(possibleComposed.resolvedBrain()),
            )
            expectComponentTrace = true
          }
          agents.set(
            player.seat,
            withDecisionTiming(targetAgent, targetLatencySamples),
          )
          descriptors[player.seat] = variant.createTargetAgent
            ? (variant.descriptor ?? `experiment:${variant.id}`)
            : `def:${variant.agent!.id}`
        } else {
          agents.set(player.seat, createAgent({ type: opponentKind }, ctx))
        }
      }

      let before: SpendMap | undefined
      let client: OpenRouterClient | undefined
      if (isPaid(variant)) {
        const clientModule = await import('../llm/client.ts')
        client = clientModule.getClient()
        before = copySpend(client.getSpend())
      }
      const result = await runGame({ game, agents })
      if (variant.createTargetAgent) {
        const replayArtifact = toArtifact(game, {
          agents: descriptors,
          degraded: result.degraded,
          steps: result.steps,
          decisionTraces,
        })
        const traceCandidates = decisionTraces.map((trace) =>
          snapshotDecisionTraceInput(trace))
        const rejectedTrace = traceCandidates.find(
          (trace) => trace.kind === 'rejected',
        )
        if (rejectedTrace?.kind === 'rejected') {
          throw new Error(
            `custom architecture variant ${variant.id} emitted an unsafe trace payload: ${rejectedTrace.reason}`,
          )
        }
        const canonicalCandidates = traceCandidates.filter(
          (trace) => trace.kind === 'canonical-decision-trace-candidate',
        )
        const canonicalTraces = canonicalCandidates.map(
          (candidate) => candidate.trace,
        )
        const targetReplay = authoritativeDecisionReplay(
          replayArtifact,
          target.seat,
          canonicalTraces,
        )
        const targetSnapshots = targetReplay.snapshots
        if (!exactTargetTraceCoverage(
          targetSnapshots,
          canonicalTraces,
          target.seat,
        )) {
          throw new Error(
            `custom architecture variant ${variant.id} did not emit exactly one trace per target decision`,
          )
        }
        const expectedComponents = resolvedVariantComponents(variant)
        const tracedComponents: string[] = [
          'brain',
          'factors',
          'languageEvidence',
          'observerModel',
          'policy',
          'planner',
          'voice',
        ]
        const jointIdentity =
          expectedComponents.identityModel === JOINT_IDENTITY_MODEL_VERSION
        if (jointIdentity) tracedComponents.push('identityModel')
        const roleObjectiveRouter =
          expectedComponents.roleObjectiveRouter
          === ROLE_OBJECTIVE_ROUTER_VERSION
        if (roleObjectiveRouter) {
          tracedComponents.push('roleObjectiveRouter')
        }
        const actualRoleObjective = roleObjectiveRouter
          ? routedRoleObjectiveModel(c.targetRole)
          : expectedComponents.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
            && (c.targetRole === 'merlin' || c.targetRole === 'percival')
            ? ROLE_OBJECTIVE_MODEL_VERSION
            : 'off'
        const roleObjectiveApplicable =
          actualRoleObjective === ROLE_OBJECTIVE_MODEL_VERSION
        const evilRoleObjectiveApplicable =
          actualRoleObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        const roleUtilityConfigured =
          expectedComponents.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
        const evilRoleUtilityConfigured =
          expectedComponents.evilRoleUtility
            === EVIL_ROLE_UTILITY_PROJECTION_VERSION
        const morganaRoleUtilityConfigured =
          expectedComponents.morganaRoleUtility
            === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
        const planMemory =
          expectedComponents.planMemory === PLAN_MEMORY_VERSION
          && expectedComponents.coherence === COHERENCE_MODEL_VERSION
          && ['maintain', 'conceal', 'deceive'].includes(
            String(expectedComponents.coherenceIntent),
          )
        if (planMemory) tracedComponents.push('planMemory', 'coherence')
        if (
          expectedComponents.languageEvidence
          === LANGUAGE_FACTOR_BUNDLE_VERSION
        ) {
          tracedComponents.push('mechanicalBelief', 'beliefPipeline')
        } else {
          tracedComponents.push('belief')
        }
        let traceAdmissionRejection: string | undefined
        const mismatch = canonicalCandidates.find((candidate) => {
          const pendingTrace = candidate.trace
          const snapshot = targetSnapshots.get(pendingTrace.decisionId)
          if (!snapshot) return true
          const traceAdmission = admitCanonicalDecisionTrace({
            kind: 'finalized-artifact',
            trace: candidate,
            req: snapshot.req,
            view: snapshot.view,
            authoritativeAction: snapshot.original,
            deterministicSeed: c.seed,
            ...(expectComponentTrace
              ? {
                  expectComponentTrace: true,
                  expectedComponentPlan,
                  expectedArchitectureIdentity:
                    expectedArchitectureDescriptor
                      ? projectResolvedArchitectureIdentity(
                          expectedArchitectureDescriptor,
                        )
                      : undefined,
                }
              : {}),
          })
          if (traceAdmission.kind === 'rejected') {
            traceAdmissionRejection = traceAdmission.reason
            return true
          }
          const trace = traceAdmission.trace
          const strictComposedTrace = (
            trace.agentMode === 'compatibility'
            || trace.agentMode === 'structured-only'
            || trace.agentMode === 'hybrid'
          )
          const traceVersions = trace.componentVersions
          const currentComponentTrace =
            trace.version === COMPONENT_DECISION_TRACE_VERSION
          const boundedLanguage =
            expectedComponents.languageEvidence
            === LANGUAGE_FACTOR_BUNDLE_VERSION
          const exactPublicObserver =
            expectedComponents.observerModel
            === PUBLIC_OBSERVER_MODEL_VERSION
          return (
            trace.agentMode !== expectedComponents.mode
            || !traceVersions
            || traceVersions.belief !== trace.beliefModelVersion
            || (
              !currentComponentTrace
              && traceVersions.roleObjective !== (
                actualRoleObjective === 'off'
                  ? undefined
                  : actualRoleObjective
              )
            )
            || (
              !currentComponentTrace
              && traceVersions.configuredMorganaCounterfeitObjective
                !== expectedComponents.morganaCounterfeitObjective
            )
            || (
              !currentComponentTrace
              && traceVersions.configuredMorganaRoleUtility
                !== expectedComponents.morganaRoleUtility
            )
            || (
              expectedComponents.evilQuestCardPolicy
                === EVIL_QUEST_ROBUST_POLICY_VERSION
                ? (
                    !currentComponentTrace
                    || traceAdmission.facts.evilQuestCardPolicy.state
                      === 'not-configured'
                  )
                : traceAdmission.facts.evilQuestCardPolicy.state
                  !== 'not-configured'
            )
            || (
              !boundedLanguage
              && (
                traceVersions.mechanicalBelief !== undefined
                || traceVersions.beliefPipeline !== undefined
              )
            )
            || (() => {
              // Current component traces already passed the trusted
              // architecture-identity join and the one generic native score
              // replay above. Descriptor metadata names the configured
              // scorer, while the trace truthfully names the resolved layer.
              if (currentComponentTrace) {
                return expectedArchitectureDescriptor !== undefined
                  && expectedComponents.scorer
                    !== expectedArchitectureDescriptor.configuredPipeline
                      .scoring.configuredScorer
              }
              const rolePolicyApplicable =
                roleUtilityConfigured
                && roleObjectiveApplicable
                && (
                  trace.request.kind === 'propose'
                  || trace.request.kind === 'vote'
                )
              const rolePolicyApplied =
                rolePolicyApplicable
                && (
                  currentComponentTrace
                    ? trace.components !== undefined
                      && componentPayload(
                        trace.components,
                        GOOD_ROLE_UTILITY_COMPONENT,
                      ) !== undefined
                      && !trace.degradation.includes(
                        'role-objective-scorer-failed',
                      )
                    // A retired flat C2 payload can never be present.
                    : false
                )
              const evilPolicyApplicable =
                evilRoleUtilityConfigured
                && evilRoleObjectiveApplicable
                && (
                  trace.request.kind === 'propose'
                  || trace.request.kind === 'vote'
                )
              const evilPolicyApplied =
                evilPolicyApplicable
                && (
                  currentComponentTrace
                    ? trace.components !== undefined
                      && componentPayload(
                        trace.components,
                        EVIL_ROLE_UTILITY_COMPONENT,
                      ) !== undefined
                      && !trace.degradation.includes(
                        'evil-role-objective-scorer-failed',
                      )
                    // A retired flat D2 payload can never be present.
                    : false
                )
              const morganaPolicyApplied =
                morganaRoleUtilityConfigured
                && c.targetRole === 'morgana'
                && (
                  trace.request.kind === 'propose'
                  || trace.request.kind === 'vote'
                )
                && (
                  currentComponentTrace
                    ? trace.components !== undefined
                      && (
                        componentPayload(
                          trace.components,
                          MORGANA_ROLE_UTILITY_COMPONENT,
                        ) !== undefined
                        || componentPayload(
                          trace.components,
                          MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
                        ) !== undefined
                      )
                      && !trace.degradation.includes(
                        'morgana-role-objective-scorer-failed',
                      )
                    // A retired flat E1B payload can never be present.
                    : false
                )
              const configuredSeeded =
                expectedComponents.scorer
                  === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                || expectedComponents.scorer
                  === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                || expectedComponents.scorer
                  === MORGANA_ROLE_SEEDED_SCORER_VERSION
              const expectedResolvedScorer = morganaPolicyApplied
                ? expectedComponents.scorer
                : evilPolicyApplied
                  ? expectedComponents.scorer
                      === MORGANA_ROLE_SEEDED_SCORER_VERSION
                    ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                    : expectedComponents.scorer
                        === MORGANA_ROLE_SCORER_VERSION
                      ? EVIL_ROLE_OBJECTIVE_SCORER_VERSION
                      : expectedComponents.scorer
                : rolePolicyApplied
                  ? (
                      expectedComponents.scorer
                        === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                        || expectedComponents.scorer
                          === MORGANA_ROLE_SEEDED_SCORER_VERSION
                        ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                        : expectedComponents.scorer
                            === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
                          || expectedComponents.scorer
                            === MORGANA_ROLE_SCORER_VERSION
                          ? ROLE_OBJECTIVE_SCORER_VERSION
                          : expectedComponents.scorer
                    )
                  : configuredSeeded
                    ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
                    : (
                        expectedComponents.scorer
                          === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
                        || expectedComponents.scorer
                          === ROLE_OBJECTIVE_SCORER_VERSION
                        || expectedComponents.scorer
                          === MORGANA_ROLE_SCORER_VERSION
                      )
                      ? GOOD_PROPOSAL_VOTE_SCORER_VERSION
                      : expectedComponents.scorer
              return traceVersions.scorer !== expectedResolvedScorer
                || (
                  traceVersions.configuredScorer
                  !== (
                    expectedResolvedScorer === expectedComponents.scorer
                      ? undefined
                      : expectedComponents.scorer
                  )
                )
            })()
            || (
              !currentComponentTrace
              &&
              morganaRoleUtilityConfigured
              && c.targetRole === 'morgana'
              && (
                trace.request.kind === 'propose'
                || trace.request.kind === 'vote'
              )
                // The retired flat E1B payload can never be present, so a
                // historical trace can no longer evidence Morgana policy.
                ? true
                : (
                    traceVersions.morganaRoleUtility !== undefined
                    || trace.degradation.includes(
                      MORGANA_ROLE_UTILITY_DEGRADATION,
                    )
                  )
            )
            || (
              planMemory
                ? (
                    !['maintain', 'conceal', 'deceive'].includes(
                      String(trace.coherenceIntent),
                    )
                    || trace.coherenceIntent
                      !== expectedComponents.coherenceIntent
                    || !decisionTraceReplayJoin(snapshot, trace)
                    || (
                      trace.privatePlanOutcome === undefined
                        ? !trace.degradation.includes(
                            APPLIED_OUTCOME_DEGRADATION,
                          )
                      : (
                          !snapshot
                          || !validateAppliedPlanOutcomeHostJoin(
                            trace.privatePlanOutcome,
                            snapshot.req,
                            snapshot.original,
                            snapshot.view,
                          )
                          || !selectedDecisionReplayJoin(
                            targetReplay,
                            snapshot,
                            trace.privatePlanOutcome,
                          )
                          || trace.privatePlanOutcome.coherence.intent
                            !== trace.coherenceIntent
                        )
                    )
                  )
                : (
                    trace.privatePlanOutcome !== undefined
                    || traceVersions.planMemory !== undefined
                    || traceVersions.coherence !== undefined
                    || trace.coherenceIntent !== undefined
                    || trace.degradation.includes(
                      APPLIED_OUTCOME_DEGRADATION,
                    )
                  )
            )
            || (
              !currentComponentTrace
              &&
              roleUtilityConfigured
              && roleObjectiveApplicable
              && (
                trace.request.kind === 'propose'
                || trace.request.kind === 'vote'
              )
                // The retired flat C1 and C2 payloads can never be present, so
                // an applicable historical decision must declare the C2
                // degradation and no C2 version.
                ? (
                    !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
                    || traceVersions.roleUtility !== undefined
                  )
                : (
                    traceVersions.roleUtility !== undefined
                    || trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
                  )
            )
            || (
              !currentComponentTrace
              &&
              evilRoleUtilityConfigured
              && evilRoleObjectiveApplicable
              && (
                trace.request.kind === 'propose'
                || trace.request.kind === 'vote'
              )
                // The retired flat D1 and D2 payloads can never be present.
                // A coherent atomic weighted dependency failure is the only
                // remaining shape a historical trace can evidence.
                ? (() => {
                    const dependencyDegradation = [
                      'identity-projection-failed',
                      EVIL_ROLE_OBJECTIVE_DEGRADATION,
                      EVIL_ROLE_UTILITY_DEGRADATION,
                    ]
                    const expectedBaseScorer =
                      expectedComponents.scorer
                        === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                        ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
                        : GOOD_PROPOSAL_VOTE_SCORER_VERSION
                    if (
                      trace.quality === 'weighted'
                      && trace.privateIdentity === undefined
                      && traceVersions.evilRoleUtility === undefined
                      && traceVersions.scorer === expectedBaseScorer
                      && traceVersions.configuredScorer
                        === expectedComponents.scorer
                      && trace.degradation.length
                        === dependencyDegradation.length
                      && dependencyDegradation.every((code) =>
                        trace.degradation.includes(code))
                    ) return false
                    if (
                      dependencyDegradation.some((code) =>
                        trace.degradation.includes(code))
                    ) return true
                    return (
                      !trace.degradation.includes(
                        EVIL_ROLE_UTILITY_DEGRADATION,
                      )
                      || traceVersions.evilRoleUtility !== undefined
                    )
                  })()
                : (
                    traceVersions.evilRoleUtility !== undefined
                    || trace.degradation.includes(
                      EVIL_ROLE_UTILITY_DEGRADATION,
                    )
                  )
            )
            || (
              exactPublicObserver
                ? (
                    trace.publicObserver === undefined
                      ? !strictComposedTrace
                      : !validatePublicObserverSnapshot(trace.publicObserver)
                  )
                : trace.publicObserver !== undefined
            )
            || (
              jointIdentity
                ? (
                    trace.privateIdentity === undefined
                      ? !trace.degradation.includes('identity-projection-failed')
                      : (
                          trace.degradation.includes(
                            'identity-projection-failed',
                          )
                          || !validatePrivateIdentityHostJoin(
                            trace.privateIdentity,
                            game.config.roles,
                            trace.beliefPlayerMarginals,
                          )
                          || trace.privateIdentity.sourceBelief.modelVersion
                            !== trace.beliefModelVersion
                          || trace.privateIdentity.sourceBelief.throughSeq
                            !== trace.beliefThroughSeq
                          || trace.privateIdentity.sourceBelief.quality
                            !== trace.quality
                          || (
                            evilRoleObjectiveApplicable
                            && (
                              !trace.privateIdentity.scope.hiddenTeam
                              || trace.privateIdentity.hiddenTeamPosterior
                                === undefined
                            )
                          )
                        )
                  )
                : (
                    trace.privateIdentity !== undefined
                    || traceVersions.identityModel !== undefined
                  )
            )
            || (
              !currentComponentTrace
              &&
              roleObjectiveApplicable
                // The retired flat C1 payload can never be present, so only the
                // absent-objective path survives.
                ? (
                    !trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
                    || (
                      trace.privateIdentity === undefined
                        ? !trace.degradation.includes(
                            'identity-projection-failed',
                          )
                        : (
                            !snapshot
                            || !trace.publicObserver
                            || (() => {
                              try {
                                buildRoleObjectiveSnapshot({
                                  req: snapshot.req,
                                  view: snapshot.view,
                                  identity: trace.privateIdentity!,
                                  observer: trace.publicObserver,
                                  candidates: legalCandidates(
                                    snapshot.req,
                                    snapshot.view,
                                  ),
                                })
                                return true
                              } catch {
                                return false
                              }
                            })()
                          )
                    )
                  )
                : trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
            )
            || (
              !currentComponentTrace
              &&
              evilRoleObjectiveApplicable
                // The retired flat D1 payload can never be present, so only the
                // absent-objective path survives.
                ? (
                    !trace.degradation.includes(
                      EVIL_ROLE_OBJECTIVE_DEGRADATION,
                    )
                    || (
                      snapshot
                      && trace.publicObserver
                      && trace.privateIdentity
                      && (() => {
                        try {
                          buildEvilRoleObjectiveSnapshot({
                            req: snapshot.req,
                            view: snapshot.view,
                            identity: trace.privateIdentity!,
                            observer: trace.publicObserver,
                            candidates: legalCandidates(
                              snapshot.req,
                              snapshot.view,
                            ),
                          })
                          return true
                        } catch {
                          return false
                        }
                      })()
                    )
                  )
                : trace.degradation.includes(
                    EVIL_ROLE_OBJECTIVE_DEGRADATION,
                  )
            )
            || tracedComponents.some(
              (key) =>
                (
                  traceVersions as unknown as Record<string, string>
                )[key] !== expectedComponents[key],
            )
          )
        })
        if (!decisionTraces.length || mismatch) {
          const actual = mismatch
            ? {
                mode: mismatch.trace.agentMode,
                ...mismatch.trace.componentVersions,
              }
            : undefined
          throw new Error(
            `custom architecture variant ${variant.id} trace components do not match declared components in ${c.id} at ${mismatch?.trace.decisionId ?? 'missing-trace'}`
            + `: expected ${JSON.stringify(expectedComponents)}, `
            + `actual ${JSON.stringify(actual)}`
            + (
              traceAdmissionRejection
                ? `; trace admission rejected: ${traceAdmissionRejection}`
                : ''
            ),
          )
        }
      }
      const llmTags = before ? spendDelta(before, copySpend(client!.getSpend())) : undefined
      const telemetry = {
        ...(llmTags ? { llm: { tags: llmTags } } : {}),
        decisionLatency: {
          samples: structuredClone(targetLatencySamples),
        },
      }
      const artifact = toArtifact(game, {
        agents: descriptors,
        degraded: result.degraded,
        steps: result.steps,
        tags: {
          architectureBank: bankId,
          architectureCase: c.id,
          architectureVariant: variant.id,
          opponentPopulation: `${opponentKind}-opponents`,
        },
        architecture: {
          bank: bankId,
          caseId: c.id,
          targetRole: c.targetRole,
          targetSeat: target.seat,
          variant: variant.id,
          components: resolvedVariantComponents(variant),
        },
        telemetry,
        decisionTraces,
        ...(expectedArchitectureDescriptor
          ? {
              trustedArchitecture: {
                seat: target.seat,
                descriptor: expectedArchitectureDescriptor,
              },
            }
          : {}),
      })
      if (opts.out) appendArtifact(opts.out, artifact)
      artifacts.push(artifact)
      const targetWon = target.alignment === game.winner
      const cost = llmTags
        ? Object.values(llmTags).reduce((sum, entry) => sum + entry.cost, 0)
        : 0
      opts.onProgress?.(
        `${c.id.padEnd(13)} ${variant.id.padEnd(20)} ${targetWon ? 'win ' : 'loss'}`
        + `  degraded ${result.degraded.filter((d) => d.seat === target.seat).length}`
        + (cost ? `  $${cost.toFixed(4)}` : ''),
      )
    }
  }
  return artifacts
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string', default: 'autopilot' },
      candidate: { type: 'string' },
      out: { type: 'string', default: `data/eval/architecture-${ARCHITECTURE_BANK_ID}.jsonl` },
      'allow-paid': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  })
  assertFreshArchitectureOutput(values.out!)
  const library = loadAgentLibrary().agents
  const byId = (id: string): AgentDef => {
    const def = library.find((candidate) => candidate.id === id)
    if (!def) throw new Error(`no agent "${id}" in the library`)
    return def
  }
  const defs = [byId(values.baseline!), ...(values.candidate ? [byId(values.candidate)] : [])]
  const variants = defs.map((agent) => ({
    id: `${agent.id}-${agent.version ? `v${agent.version}` : 'unversioned'}`,
    agent,
    components: defaultComponents(agent),
  }))
  const artifacts = await runArchitectureBench({
    variants,
    out: values.out,
    allowPaid: values['allow-paid'],
    onProgress: values.quiet ? undefined : (line) => console.log(line),
  })
  console.log(`\n${artifacts.length} architecture game(s) -> ${values.out}`)
  console.log(`report: node server/eval/architecture-report.ts ${values.out}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
