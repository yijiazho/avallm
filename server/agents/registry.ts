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
import { questWeightedBeliefModel } from './belief/quest-card-factor.ts'
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
        // BELIEF-002. Hard feasibility still decides which worlds exist; this
        // reweights inside that set under a capped log-likelihood, so a
        // SUCCESSFUL quest finally means something. The constraints-only
        // belief learns nothing from one, because evil may always choose to
        // play success, and that blindness was measurable: on the wide bank's
        // servant cell it cost 10.5 points of clean proposals against
        // heuristic opponents and 4.4 against random, with dirty-team approval
        // 10 points worse in both.
        //
        // `good-base` deliberately does NOT get this. This module's contract is
        // that a preset matches a measured arm exactly, and only full-role was
        // gated.
        beliefModel: questWeightedBeliefModel,
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
        onDecisionTrace: ctx.onDecisionTrace,
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
        temperature: def.engine.temperature,
        brain: def.engine.brain,
        onDecisionTrace: ctx.onDecisionTrace,
      })
    default: {
      // Assigning to `never` keeps the switch exhaustive at build time: a new
      // engine variant fails to compile here instead of falling through silently.
      const unhandled: never = def.engine
      throw new Error(`unsupported agent engine ${String(unhandled)}`)
    }
  }
}
