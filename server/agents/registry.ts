// AgentSpec -> AvalonAgent. The one place that knows how to construct agents.

import { createComposedAgent } from './composed.ts'
import { createHeuristicAgent } from './heuristic.ts'
import { createLlmAgent } from './llm.ts'
import { createRandomAgent } from './random.ts'
import { getClient } from '../llm/client.ts'
import { rosterById } from '../llm/roster.ts'
import {
  fullRolePolicyScorer,
  goodProposalVoteScorer,
} from './policy/score.ts'
import { promptOverridesOf, resolveModel } from './defs.ts'
import { createBoundedPlannerVoice } from './communication/planner-voice-adapter.ts'
import type { AgentDef } from './defs.ts'
import type { ComposedAgentOptions } from './composed.ts'
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
  switch (preset) {
    case 'good-base':
      return { scorer: goodProposalVoteScorer }
    case 'full-role':
      return {
        scorer: fullRolePolicyScorer,
        roleObjectiveRouter: true,
        evilQuestCardPolicy: 'robust-heterogeneous',
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
        onDecisionTrace: ctx.onDecisionTrace,
        ...composedBrainOptions(spec.brain),
      })
    case 'llm':
      return createLlmAgent({
        modelId: spec.model,
        client: getClient(),
        brain: spec.brain,
        onDecisionTrace: ctx.onDecisionTrace,
      })
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
      const adapters = def.engine.adapter === 'bounded-llm'
        ? createBoundedPlannerVoice({
            client: dependencies.client ?? getClient(),
            model: rosterById(resolveModel(def, modelOverride)).slug,
            tagPrefix: `agent/${def.id}`,
          })
        : {}
      return createComposedAgent({
        seed: ctx.seed,
        onDecisionTrace: ctx.onDecisionTrace,
        ...composedBrainOptions(def.engine.brain),
        ...adapters,
      })
    }
    case 'llm':
      return createLlmAgent({
        modelId: resolveModel(def, modelOverride),
        client: dependencies.client ?? getClient(),
        agentId: def.id,
        label: `${def.name}${def.version ? ` v${def.version}` : ''}`,
        prompts: promptOverridesOf(def.engine),
        temperature: def.engine.temperature,
        brain: def.engine.brain,
        onDecisionTrace: ctx.onDecisionTrace,
      })
  }
}
