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
/**
 * The non-composed policies, as one runtime list rather than a type union.
 *
 * The policy names the agent kind: every manifest and trace already declares it
 * and readers already cross-check it, so a second label derived from it would
 * be a restatement rather than an independent fact. The list is the source of
 * truth rather than a convenience copy, because a set spelled out as a string
 * array or an `||` chain elsewhere is invisible to the compiler and survives a
 * change to the members without reddening anything. Retiring the `external`
 * mode had to be done by hand in four separate literal lists for exactly that
 * reason. Read this set through the predicates below instead of restating it.
 */
export const BELIEF_VISIBILITIES = Object.freeze([
  COMPAT_CERTAINTIES_VISIBILITY,
  BELIEF_RENDERER_VERSION,
] as const)

export const NON_COMPOSED_POLICIES = Object.freeze([
  RAW_LLM_POLICY_VERSION,
  HEURISTIC_POLICY_VERSION,
  RANDOM_POLICY_VERSION,
] as const)

export function isComposedPolicy(value: unknown): boolean {
  return value === COMPOSED_POLICY_VERSION
}

export function isNonComposedPolicy(value: unknown): boolean {
  return (NON_COMPOSED_POLICIES as readonly unknown[]).includes(value)
}

export type BeliefComponent =
  | 'none'
  | typeof EXACT_BELIEF_MODEL_VERSION
/** Absent visibility is its own state, so 'none' is not in the list. */
export type BeliefVisibility = 'none' | ConfigurableBeliefVisibility
export type ConfigurableBeliefVisibility =
  (typeof BELIEF_VISIBILITIES)[number]
export type PolicyComponent =
  | (typeof NON_COMPOSED_POLICIES)[number]
  | typeof COMPOSED_POLICY_VERSION
export type LanguageEvidenceComponent =
  | 'off'
  | typeof LANGUAGE_FACTOR_BUNDLE_VERSION
export type ObserverModelComponent =
  | 'off'
  | typeof PUBLIC_OBSERVER_MODEL_VERSION

/**
 * A fully resolved strategic configuration. Model choice, persona, and prompt
 * guidance deliberately do not live here.
 */
export interface BrainSpec {
  version: typeof BRAIN_SPEC_VERSION
  belief: BeliefComponent
  beliefVisibility: BeliefVisibility
  policy: PolicyComponent
  languageEvidence: LanguageEvidenceComponent
  observerModel: ObserverModelComponent
}

/**
 * User/definition-facing overrides for the raw-LLM brain.
 *
 * Only the components with more than one legal value belong here. The others
 * (belief, policy, languageEvidence, observerModel) each admit exactly one
 * value for a raw-LLM agent, which is the value they get anyway, so accepting
 * them let a definition restate a default and gain nothing. Writing one now
 * fails as an unknown component rather than being validated into a no-op. Add
 * a field back when a second value exists for it.
 */
export interface LlmBrainConfig {
  beliefVisibility?: ConfigurableBeliefVisibility
}

export interface LlmBrainSource {
  type?: 'llm'
  brain?: LlmBrainConfig
}

export type BrainSource =
  | LlmBrainSource
  | { type: 'heuristic' }
  | { type: 'random' }
  | {
      type: 'composed'
      languageEvidence?: typeof LANGUAGE_FACTOR_BUNDLE_VERSION
      observerModel?: typeof PUBLIC_OBSERVER_MODEL_VERSION
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
  for (const key of Object.keys(raw)) {
    if (key !== 'beliefVisibility') {
      throw new Error(`brain: unknown component "${key}"`)
    }
  }
  const beliefVisibility =
    raw.beliefVisibility ?? COMPAT_CERTAINTIES_VISIBILITY
  if (
    !(BELIEF_VISIBILITIES as readonly unknown[]).includes(beliefVisibility)
  ) {
    throw new Error(
      `brain.beliefVisibility must be one of: ${BELIEF_VISIBILITIES.join(', ')}`,
    )
  }
  return {
    version: BRAIN_SPEC_VERSION,
    belief: EXACT_BELIEF_MODEL_VERSION,
    beliefVisibility: beliefVisibility as BrainSpec['beliefVisibility'],
    policy: RAW_LLM_POLICY_VERSION,
    languageEvidence: 'off',
    observerModel: 'off',
  }
}

export function resolveBrain(source: BrainSource): BrainSpec {
  switch (source.type) {
    case undefined:
    case 'llm':
      return resolveLlmBrain(source)
    case 'heuristic':
      return {
        version: BRAIN_SPEC_VERSION,
        belief: EXACT_BELIEF_MODEL_VERSION,
        beliefVisibility: 'none',
        policy: HEURISTIC_POLICY_VERSION,
        languageEvidence: 'off',
        observerModel: 'off',
      }
    case 'random':
      return {
        version: BRAIN_SPEC_VERSION,
        belief: 'none',
        beliefVisibility: 'none',
        policy: RANDOM_POLICY_VERSION,
        languageEvidence: 'off',
        observerModel: 'off',
      }
    case 'composed':
      return {
        version: BRAIN_SPEC_VERSION,
        belief: EXACT_BELIEF_MODEL_VERSION,
        beliefVisibility: 'none',
        policy: COMPOSED_POLICY_VERSION,
        languageEvidence: source.languageEvidence ?? 'off',
        observerModel: source.observerModel ?? 'off',
      }
  }
}

/** The component bundle persisted in new architecture artifacts. */
export function brainComponents(brain: BrainSpec): Record<string, string> {
  return {
    brain: brain.version,
    belief: brain.belief,
    beliefVisibility: brain.beliefVisibility,
    policy: brain.policy,
    languageEvidence: brain.languageEvidence,
    observerModel: brain.observerModel,
  }
}

export function usesCompactBeliefSummary(brain: BrainSpec): boolean {
  return brain.beliefVisibility === BELIEF_RENDERER_VERSION
}
