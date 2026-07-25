// Per-model-family reasoning suppression. Values are MEASURED, not guessed
// (see server/eval/reasoning-probe.ts and docs/model-onboarding.md § 1). The
// openrouter chokepoint suppresses by default using this table; call sites
// cannot forget.
//
// The traps this encodes: deepseek needs effort:'none' (low maps UP);
// kimi burns ~3k reasoning tokens/turn unless 'none'; gemini flash reasons
// ONLY IF a reasoning opt is present (suppress by sending nothing);
// gpt-oss needs effort:'low' or it emits empty content.

export interface ReasoningPolicy {
  family: string
  suppress: Record<string, unknown> | null // null = suppress by sending nothing
  canSuppress: boolean
}

interface PolicyRule extends ReasoningPolicy {
  match: RegExp
}

export const POLICIES: PolicyRule[] = [
  { family: 'deepseek', match: /^deepseek\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'moonshot', match: /^moonshotai\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'glm', match: /^z-ai\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'qwen', match: /^qwen\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'openai-reasoning', match: /^openai\/(gpt-oss|o\d)/, suppress: { effort: 'low' }, canSuppress: true },
  { family: 'openai-gpt5', match: /^openai\/gpt-5/, suppress: { effort: 'minimal' }, canSuppress: true },
  { family: 'openai', match: /^openai\//, suppress: null, canSuppress: true },
  { family: 'xai', match: /^x-ai\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'seed', match: /^bytedance-seed\//, suppress: { effort: 'none' }, canSuppress: true },
  // nvidia: measured via reasoning-probe.ts on nemotron-3-super — effort:'none'
  // zeroes reasoning tokens; effort:'low'/'minimal' do NOT suppress (they reason
  // as much or more). Same shape as deepseek/seed.
  { family: 'nvidia', match: /^nvidia\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'gemini-pro', match: /^google\/gemini-3\.1-pro/, suppress: null, canSuppress: false },
  { family: 'gemini-flash', match: /^google\/gemini-3(\.\d+)?-flash/, suppress: null, canSuppress: true },
  { family: 'anthropic', match: /^anthropic\//, suppress: null, canSuppress: true },
  { family: 'mistral', match: /^mistralai\//, suppress: null, canSuppress: true },
]

const UNKNOWN: ReasoningPolicy = { family: 'unknown', suppress: null, canSuppress: true }

export function policyFor(model: string): ReasoningPolicy {
  if (typeof model !== 'string') return UNKNOWN
  return POLICIES.find((p) => p.match.test(model)) ?? UNKNOWN
}

export function suppressionFor(model: string): {
  value: Record<string, unknown> | null
  canSuppress: boolean
  family: string
} {
  const p = policyFor(model)
  return { value: p.suppress, canSuppress: p.canSuppress, family: p.family }
}
