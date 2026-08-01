// AgentSpec -> AvalonAgent. The one place that knows how to construct agents.

import { createComposedAgent } from './composed/agent.ts'
import { createHeuristicAgent } from './heuristic/agent.ts'
import { createLlmAgent } from './raw-llm/agent.ts'
import { createRandomAgent } from './random.ts'
import { getClient } from '../llm/client.ts'
import { rosterById } from '../llm/roster.ts'
import {
  fullRolePolicyScorer,
  goodProposalVoteScorer,
} from './policy/score.ts'
import { beliefModelFor } from './belief/factor-manifest.ts'
import { promptOverridesOf, resolveModel } from './defs.ts'
import { createBoundedPlannerVoice } from './communication/planner-voice-adapter.ts'
import type { AgentDef } from './defs.ts'
import type { ComposedAgentOptions } from './composed/agent.ts'
import type { OpenRouterClient } from '../llm/openrouter.ts'
import type {
  AgentContext,
  AgentSpec,
  AvalonAgent,
  ComposedBrainPreset,
} from './types.ts'

/**
 * The one place a composed preset becomes component wiring. Each preset matches
 * a measured evaluation arm exactly, so a seated brain and its recorded
 * comparison cannot drift apart.
 */
export function composedBrainOptions(
  preset: ComposedBrainPreset,
): Omit<ComposedAgentOptions, 'seed' | 'onDecisionTrace'> {
  // Which soft factor a preset runs is NOT decided here. `BELIEF_FACTORS` owns
  // it, so the table a reader consults and the wiring a shipped game executes
  // cannot disagree. No entry for this preset means the exact constraints-only
  // posterior, which is what `good-base` gets. Eval benches construct their own
  // arms directly and are outside this path on purpose; the manifest header
  // says why.
  const seated = beliefModelFor(preset)
  const beliefModel = seated ? { beliefModel: seated } : {}
  switch (preset) {
    case 'good-base':
      return { scorer: goodProposalVoteScorer, ...beliefModel }
    case 'full-role':
      return {
        scorer: fullRolePolicyScorer,
        roleObjectiveRouter: true,
        evilQuestCardPolicy: 'robust-heterogeneous',
        ...beliefModel,
      }
    default: {
      // Assigning to `never` keeps the switch exhaustive at build time: a new
      // preset fails to compile here instead of throwing at the first decision.
      const unhandled: never = preset
      throw new Error(`unsupported composed brain preset ${String(unhandled)}`)
    }
  }
}

export function createAgent(spec: AgentSpec, ctx: AgentContext): AvalonAgent {
  switch (spec.type) {
    case 'heuristic': return createHeuristicAgent(ctx)
    case 'random': return createRandomAgent(ctx)
    case 'composed':
      return createComposedAgent({
        seed: ctx.seed,
        ...(ctx.onDecisionTrace === undefined
          ? {}
          : { onDecisionTrace: ctx.onDecisionTrace }),
        ...composedBrainOptions(spec.brain),
      })
    case 'llm':
      return createLlmAgent({
        modelId: spec.model,
        client: getClient(),
        ...(spec.brain === undefined ? {} : { brain: spec.brain }),
        ...(ctx.onDecisionTrace === undefined
          ? {}
          : { onDecisionTrace: ctx.onDecisionTrace }),
      })
    default: {
      // Assigning to `never` keeps the switch exhaustive at build time: a new
      // agent kind fails to compile here instead of falling through silently.
      const unhandled: never = spec
      throw new Error(`unsupported agent spec ${String(unhandled)}`)
    }
  }
}

// Library agents (server/agents/defs.ts) — the config-driven construction
// path used by the web server and table setup. modelOverride is the seat-time
// (host's) model choice; see resolveModel for precedence.
export interface AgentFactoryDependencies {
  client?: OpenRouterClient
}

export function createAgentFromDef(
  def: AgentDef,
  ctx: AgentContext,
  modelOverride?: string,
  dependencies: AgentFactoryDependencies = {},
): AvalonAgent {
  switch (def.engine.type) {
    case 'heuristic': return createHeuristicAgent(ctx)
    case 'composed': {
      const boundedLlm = def.engine.adapter === 'bounded-llm'
      const adapters = boundedLlm
        ? createBoundedPlannerVoice({
            client: dependencies.client ?? getClient(),
            model: rosterById(resolveModel(def, modelOverride)).slug,
            tagPrefix: `agent/${def.id}`,
          })
        : {}
      return createComposedAgent({
        seed: ctx.seed,
        ...(ctx.onDecisionTrace === undefined
          ? {}
          : { onDecisionTrace: ctx.onDecisionTrace }),
        ...composedBrainOptions(def.engine.brain),
        ...(def.engine.adapter === 'bounded-llm'
          ? { planMemory: true }
          : {}),
        ...adapters,
        // A seated planner reads the private pin summary from its
        // planning-only context; a planner-less composed agent would only pay
        // to resolve reads nothing consumes, so pins ride the bounded-llm path.
        ...(boundedLlm ? { pinReads: true } : {}),
      })
    }
    case 'llm':
      return createLlmAgent({
        modelId: resolveModel(def, modelOverride),
        client: dependencies.client ?? getClient(),
        agentId: def.id,
        label: `${def.name}${def.version ? ` v${def.version}` : ''}`,
        prompts: promptOverridesOf(def.engine),
        ...(def.engine.temperature === undefined
          ? {}
          : { temperature: def.engine.temperature }),
        ...(def.engine.brain === undefined ? {} : { brain: def.engine.brain }),
        ...(ctx.onDecisionTrace === undefined
          ? {}
          : { onDecisionTrace: ctx.onDecisionTrace }),
      })
    default: {
      // Assigning to `never` keeps the switch exhaustive at build time: a new
      // engine variant fails to compile here instead of falling through silently.
      const unhandled: never = def.engine
      throw new Error(`unsupported agent engine ${String(unhandled)}`)
    }
  }
}
