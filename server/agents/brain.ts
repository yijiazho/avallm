import { EXACT_BELIEF_MODEL_VERSION } from './belief/types.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from './belief/language-factor.ts'
import { BELIEF_RENDERER_VERSION } from './communication/belief-summary.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './analysis/observer-types.ts'

export const BRAIN_SPEC_VERSION = 'brain-spec-v1'
export const COMPAT_CERTAINTIES_VISIBILITY = 'compat-certainties-v1'
export const RAW_LLM_POLICY_VERSION = 'prompt-guided-v1'
export const HEURISTIC_POLICY_VERSION = 'heuristic-policy-v2'
export const RANDOM_POLICY_VERSION = 'random-v1'
export const COMPOSED_POLICY_VERSION = 'composed-policy-v1'
export const PROMPT_COMMUNICATION_VERSION = 'prompt-voice-v1'
export const PLAN_COMMUNICATION_VERSION = 'plan-voice-v2'
export const EXPERIMENTAL_BELIEF_MODE = 'exact-summary-v1'
export type ExperimentalBeliefMode = typeof EXPERIMENTAL_BELIEF_MODE
export type AgentExecutionMode =
  | 'raw-llm'
  | 'heuristic'
  | 'random'
  | 'external'
  | 'compatibility'
  | 'structured-only'
  | 'hybrid'

export type BeliefComponent =
  | 'none'
  | typeof EXACT_BELIEF_MODEL_VERSION
  | 'external'
export type BeliefVisibility =
  | 'none'
  | typeof COMPAT_CERTAINTIES_VISIBILITY
  | typeof BELIEF_RENDERER_VERSION
  | 'external'
export type PolicyComponent =
  | typeof RAW_LLM_POLICY_VERSION
  | typeof HEURISTIC_POLICY_VERSION
  | typeof RANDOM_POLICY_VERSION
  | typeof COMPOSED_POLICY_VERSION
  | 'external'
export type CommunicationComponent =
  | 'none'
  | typeof PROMPT_COMMUNICATION_VERSION
  | typeof PLAN_COMMUNICATION_VERSION
  | 'external'
export type LanguageEvidenceComponent =
  | 'off'
  | typeof LANGUAGE_FACTOR_BUNDLE_VERSION
  | 'external'
export type ObserverModelComponent =
  | 'off'
  | typeof PUBLIC_OBSERVER_MODEL_VERSION
  | 'external'

/**
 * A fully resolved strategic configuration. Model choice, persona, and prompt
 * guidance deliberately do not live here.
 */
export interface BrainSpec {
  version: typeof BRAIN_SPEC_VERSION
  mode: AgentExecutionMode
  belief: BeliefComponent
  beliefVisibility: BeliefVisibility
  policy: PolicyComponent
  communication: CommunicationComponent
  languageEvidence: LanguageEvidenceComponent
  observerModel: ObserverModelComponent
}

/** User/definition-facing overrides for the current raw-LLM brain. */
export interface LlmBrainConfig {
  belief?: typeof EXACT_BELIEF_MODEL_VERSION
  beliefVisibility?:
    | typeof COMPAT_CERTAINTIES_VISIBILITY
    | typeof BELIEF_RENDERER_VERSION
  policy?: typeof RAW_LLM_POLICY_VERSION
  communication?: typeof PROMPT_COMMUNICATION_VERSION
  languageEvidence?: 'off'
  observerModel?: 'off'
}

export interface LlmBrainSource {
  type?: 'llm'
  brain?: LlmBrainConfig
  /** Phase 2 compatibility input; mapped once into beliefVisibility. */
  beliefMode?: ExperimentalBeliefMode
}

type BrainSource =
  | LlmBrainSource
  | { type: 'heuristic' }
  | { type: 'random' }
  | {
      type: 'composed'
      languageEvidence?: typeof LANGUAGE_FACTOR_BUNDLE_VERSION
      observerModel?: typeof PUBLIC_OBSERVER_MODEL_VERSION
    }
  | { type: 'stdio' }

const DEFAULT_LLM_BRAIN: BrainSpec = Object.freeze({
  version: BRAIN_SPEC_VERSION,
  mode: 'raw-llm',
  belief: EXACT_BELIEF_MODEL_VERSION,
  beliefVisibility: COMPAT_CERTAINTIES_VISIBILITY,
  policy: RAW_LLM_POLICY_VERSION,
  communication: PROMPT_COMMUNICATION_VERSION,
  languageEvidence: 'off',
  observerModel: 'off',
})

const assertOneOf = (
  field: string,
  value: unknown,
  choices: readonly string[],
): string => {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new Error(`brain.${field} must be one of: ${choices.join(', ')}`)
  }
  return value
}

function resolveLlmBrain(source: LlmBrainSource): BrainSpec {
  const supplied = source.brain
  if (
    supplied !== undefined
    && (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
  ) {
    throw new Error('brain must be an object')
  }
  const raw = (supplied ?? {}) as Record<string, unknown>
  const allowed = new Set([
    'belief',
    'beliefVisibility',
    'policy',
    'communication',
    'languageEvidence',
    'observerModel',
  ])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`brain: unknown component "${key}"`)
  }

  const legacyVisibility = source.beliefMode === EXPERIMENTAL_BELIEF_MODE
    ? BELIEF_RENDERER_VERSION
    : undefined
  if (source.beliefMode !== undefined && legacyVisibility === undefined) {
    throw new Error(`beliefMode must be "${EXPERIMENTAL_BELIEF_MODE}"`)
  }
  if (
    legacyVisibility
    && raw.beliefVisibility !== undefined
    && raw.beliefVisibility !== legacyVisibility
  ) {
    throw new Error('beliefMode conflicts with brain.beliefVisibility')
  }

  const brain: BrainSpec = {
    version: BRAIN_SPEC_VERSION,
    mode: 'raw-llm',
    belief: assertOneOf(
      'belief',
      raw.belief ?? DEFAULT_LLM_BRAIN.belief,
      [EXACT_BELIEF_MODEL_VERSION],
    ) as BrainSpec['belief'],
    beliefVisibility: assertOneOf(
      'beliefVisibility',
      legacyVisibility ?? raw.beliefVisibility ?? DEFAULT_LLM_BRAIN.beliefVisibility,
      [COMPAT_CERTAINTIES_VISIBILITY, BELIEF_RENDERER_VERSION],
    ) as BrainSpec['beliefVisibility'],
    policy: assertOneOf(
      'policy',
      raw.policy ?? DEFAULT_LLM_BRAIN.policy,
      [RAW_LLM_POLICY_VERSION],
    ) as BrainSpec['policy'],
    communication: assertOneOf(
      'communication',
      raw.communication ?? DEFAULT_LLM_BRAIN.communication,
      [PROMPT_COMMUNICATION_VERSION],
    ) as BrainSpec['communication'],
    languageEvidence: assertOneOf(
      'languageEvidence',
      raw.languageEvidence ?? DEFAULT_LLM_BRAIN.languageEvidence,
      ['off'],
    ) as BrainSpec['languageEvidence'],
    observerModel: assertOneOf(
      'observerModel',
      raw.observerModel ?? DEFAULT_LLM_BRAIN.observerModel,
      ['off'],
    ) as BrainSpec['observerModel'],
  }
  return brain
}

export function resolveBrain(source: BrainSource): BrainSpec {
  switch (source.type ?? 'llm') {
    case 'llm':
      return resolveLlmBrain(source as LlmBrainSource)
    case 'heuristic':
      return {
        version: BRAIN_SPEC_VERSION,
        mode: 'heuristic',
        belief: EXACT_BELIEF_MODEL_VERSION,
        beliefVisibility: 'none',
        policy: HEURISTIC_POLICY_VERSION,
        communication: 'none',
        languageEvidence: 'off',
        observerModel: 'off',
      }
    case 'random':
      return {
        version: BRAIN_SPEC_VERSION,
        mode: 'random',
        belief: 'none',
        beliefVisibility: 'none',
        policy: RANDOM_POLICY_VERSION,
        communication: 'none',
        languageEvidence: 'off',
        observerModel: 'off',
      }
    case 'composed':
      return {
        version: BRAIN_SPEC_VERSION,
        mode: 'compatibility',
        belief: EXACT_BELIEF_MODEL_VERSION,
        beliefVisibility: 'none',
        policy: COMPOSED_POLICY_VERSION,
        communication: PLAN_COMMUNICATION_VERSION,
        languageEvidence: source.languageEvidence ?? 'off',
        observerModel: source.observerModel ?? 'off',
      }
    case 'stdio':
      return {
        version: BRAIN_SPEC_VERSION,
        mode: 'external',
        belief: 'external',
        beliefVisibility: 'external',
        policy: 'external',
        communication: 'external',
        languageEvidence: 'external',
        observerModel: 'external',
      }
  }
}

/** The component bundle persisted in new architecture artifacts. */
export function brainComponents(brain: BrainSpec): Record<string, string> {
  return {
    brain: brain.version,
    mode: brain.mode,
    belief: brain.belief,
    beliefVisibility: brain.beliefVisibility,
    policy: brain.policy,
    communication: brain.communication,
    languageEvidence: brain.languageEvidence,
    observerModel: brain.observerModel,
  }
}

export function usesCompactBeliefSummary(brain: BrainSpec): boolean {
  return brain.beliefVisibility === BELIEF_RENDERER_VERSION
}
