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
  // deepseek + qwen re-probed 2026-07 against v4-pro / qwen3.7-plus: the family
  // rows already here hold for the newer members (effort:'none' → rt 0). Qwen is
  // the loudest default on the roster — 1256 rt/call unsuppressed.
  { family: 'deepseek', match: /^deepseek\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'moonshot', match: /^moonshotai\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'glm', match: /^z-ai\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'qwen', match: /^qwen\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'openai-reasoning', match: /^openai\/(gpt-oss|o\d)/, suppress: { effort: 'low' }, canSuppress: true },
  // gpt-5 nano is measured (probe, 2026-07): it reasons ~0 by DEFAULT, and the
  // wider gpt-5 rule below is actively wrong for it — effort:'minimal' leaks
  // ~33 rt/call and 'low' ~41. Narrower rule first so the nano seat sends
  // nothing. The general gpt-5 row is unprobed; re-measure before seating one.
  { family: 'openai-gpt5-nano', match: /^openai\/gpt-5(\.\d+)?-nano/, suppress: null, canSuppress: true },
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
  // Probed 2026-07 (docs/model-onboarding.md living record). All four of these
  // measured rt≈0 under BOTH effort:'none' and enabled:false; effort:'none' is
  // written here to keep one idiom across the table. xiaomi and tencent are the
  // sharp ones: left unsuppressed they don't merely leak, they blank 5/5 under
  // the JSON ASK — so a missing policy row for these families would read as a
  // broken model, not a chatty one.
  //
  // A clean probe is necessary, not sufficient: minimax passed this sweep and
  // still leaked in play (see below). Five samples of one short ASK is a weak
  // sample; Step 3's real game is what confirms a row.
  { family: 'xiaomi', match: /^xiaomi\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'tencent', match: /^tencent\//, suppress: { effort: 'none' }, canSuppress: true },
  // minimax is BENCHED in roster.ts (its probe result did not survive a real
  // game — 3 leaked calls out of 191). The row stays per the retirement
  // pattern so restoring is one uncommented entry, but treat this suppress
  // value as unproven: it is exactly what failed.
  { family: 'minimax', match: /^minimax\//, suppress: { effort: 'none' }, canSuppress: true },
  { family: 'upstage', match: /^upstage\//, suppress: null, canSuppress: true },
]

const UNKNOWN: ReasoningPolicy = { family: 'unknown', suppress: null, canSuppress: true }

export function policyFor(model: string): ReasoningPolicy {
  if (typeof model !== 'string') return UNKNOWN
  return POLICIES.find((p) => p.match.test(model)) ?? UNKNOWN
}
