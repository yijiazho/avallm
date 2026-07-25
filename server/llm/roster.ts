// The model roster — the cast of characters. Bots ARE models, openly badged.
// Slugs deliberately limited to ones vetted via docs/model-onboarding.md
// (rate cards + reasoning-suppression behavior verified there); prices are
// $/M prompt/completion as of 2026-07 and only inform tier labels — real
// cost accounting uses OpenRouter's usage.cost.

export interface RosterEntry {
  id: string           // stable internal id
  displayName: string  // what the table shows
  slug: string         // OpenRouter model slug
  badge: { color: string }
  tier: 'cheap' | 'mid' | 'premium'
}

export const ROSTER: RosterEntry[] = [
  // Ids name the SPECIFIC model, not just the family: a family can seat more
  // than one entry (google already seats two), so "deepseek"/"gemini" would be
  // ambiguous the moment a second sibling joins.
  {
    id: 'deepseek-flash', displayName: 'DeepSeek Flash', slug: 'deepseek/deepseek-v4-flash',
    badge: { color: '#4D6BFE' }, tier: 'cheap',
  },
  {
    id: 'gemini-flash-lite', displayName: 'Gemini Flash Lite', slug: 'google/gemini-3.1-flash-lite',
    badge: { color: '#1A73E8' }, tier: 'cheap',
  },
  {
    id: 'gemini-flash', displayName: 'Gemini Flash', slug: 'google/gemini-3-flash-preview',
    badge: { color: '#34A853' }, tier: 'mid',
  },
  // Haiku is temporarily benched: at ~$1/$5 per M tokens it runs an order of
  // magnitude pricier than every other seat here, which dominates the spend on
  // a hobby budget. Kept commented (not deleted) so it's a one-line restore
  // when we want the premium seat back — its reasoning-suppression policy and
  // Arcana glyph are still wired up.
  // {
  //   id: 'haiku', displayName: 'Haiku', slug: 'anthropic/claude-haiku-4.5',
  //   badge: { color: '#D97757' }, tier: 'premium',
  // },
  {
    id: 'kimi', displayName: 'Kimi', slug: 'moonshotai/kimi-k2.5',
    badge: { color: '#16A8A8' }, tier: 'mid',
  },
  {
    id: 'glm', displayName: 'GLM', slug: 'z-ai/glm-4.6',
    badge: { color: '#8B5CF6' }, tier: 'mid',
  },
  // GPT-OSS is benched on reliability, not cost. As the cheapest seat it was
  // the source of nearly every mechanical failure in playtests: its reasoning-
  // suppression policy doesn't hold (frequent >100-token leaks), it returns
  // blank under response_format (burning a paid call before the fallback), and
  // its erratic voting reads as a false evil tell. Kept commented (not deleted)
  // so it's a one-line restore — its reasoning-suppression policy and Arcana
  // glyph are still wired up.
  // {
  //   id: 'gpt-oss', displayName: 'GPT-OSS', slug: 'openai/gpt-oss-120b',
  //   badge: { color: '#10A37F' }, tier: 'cheap',
  // },
  {
    id: 'seed', displayName: 'Seed', slug: 'bytedance-seed/seed-2.0-lite',
    badge: { color: '#F0424C' }, tier: 'cheap',
  },
  // Onboarded 2026-07 via docs/model-onboarding.md. Reasoning-suppression probe
  // (reasoning-probe.ts) found effort:'none' is the clean flag (effort:'low'/
  // 'minimal' do NOT suppress — the usual per-model trap); see the nvidia family
  // in reasoning-policy.ts. Paid slug (not :free) so live games don't hit the
  // free-tier per-minute rate limit; at $0.085/$0.40 per M it's cheap tier.
  {
    id: 'nemotron', displayName: 'Nemotron', slug: 'nvidia/nemotron-3-super-120b-a12b',
    badge: { color: '#76B900' }, tier: 'cheap',
  },
  // Onboarded 2026-07 as a batch (docs/model-onboarding.md living record).
  // Six new families (Xiaomi, Tencent, MiniMax, Alibaba/Qwen, Mistral, Upstage)
  // plus an OpenAI seat to replace benched GPT-OSS and a smarter DeepSeek sibling.
  // All are in DEFAULT_TABLE, but behind the curated six — see the ordering note
  // there, which is what decides who actually sits at a given table.
  {
    id: 'deepseek-pro', displayName: 'DeepSeek Pro', slug: 'deepseek/deepseek-v4-pro',
    badge: { color: '#2A3EB1' }, tier: 'mid',
  },
  {
    id: 'mimo', displayName: 'MiMo', slug: 'xiaomi/mimo-v2.5',
    badge: { color: '#F7A600' }, tier: 'cheap',
  },
  {
    id: 'hunyuan', displayName: 'Hunyuan', slug: 'tencent/hy3',
    badge: { color: '#0052D9' }, tier: 'cheap',
  },
  {
    id: 'minimax', displayName: 'MiniMax', slug: 'minimax/minimax-m3',
    badge: { color: '#C2185B' }, tier: 'mid',
  },
  {
    id: 'qwen', displayName: 'Qwen', slug: 'qwen/qwen3.7-plus',
    badge: { color: '#5B4BF5' }, tier: 'mid',
  },
  {
    id: 'mistral', displayName: 'Mistral', slug: 'mistralai/mistral-small-2603',
    badge: { color: '#FA520F' }, tier: 'cheap',
  },
  {
    id: 'gpt-nano', displayName: 'GPT Nano', slug: 'openai/gpt-5.4-nano',
    badge: { color: '#10A37F' }, tier: 'cheap',
  },
  {
    id: 'solar', displayName: 'Solar', slug: 'upstage/solar-pro-3',
    badge: { color: '#00838F' }, tier: 'cheap',
  },
]

// The curated core, one model family per seat — the six we'd actually pick.
// (Seat churn: Haiku was benched on cost and Seed took its seat; GPT-OSS was
// benched on reliability — see above — and after a brief Gemini Flash stopgap
// that doubled the Google family, Nemotron (NVIDIA) took the seat once it
// cleared docs/model-onboarding.md. Nemotron restores one-family-per-seat and
// was the cheapest seat measured in its onboarding playtest.)
//
// This is a separate export because the MEMBERSHIP SPLIT is the real lever,
// not the ordering. Both auto-fill paths — leftoverPool in agents/packs.ts and
// defaultTable in the client's App.tsx — shuffle within "preferred" and within
// "the rest", so position inside a group is discarded. What survives the
// shuffle is only which group a model lands in. Folding these six into
// DEFAULT_TABLE would put all fifteen in "preferred", empty "the rest", and
// silently flatten that two-tier draw without any call site changing.
export const CORE_TABLE = ['deepseek-flash', 'gemini-flash-lite', 'seed', 'kimi', 'glm', 'nemotron']

// Every seated model, core first. Ordering here only bites on ONE path: the
// server's fallback when a caller posts no table at all (server.ts), which
// takes the first `botCount` off the front. The client never hits it — its
// setup screen always posts a table. So treat this order as a tiebreak for
// API/sim callers, not as the product decision.
//
// The tail is the 2026-07 batch plus Gemini Flash, ordered by measured playtest
// quality so that fallback path stays sane: the three that ran a clean game
// (0 degrades, 0 reasoning leaks) first, then the two that degraded once, then
// the expensive and on-probation seats. MiniMax is last of the batch on
// purpose — 2 degrades and 3 reasoning leaks despite a clean probe — and the
// two doubled families (Google, DeepSeek) sit at the very back.
//
// Because this names EVERY seated model, benching one means deleting it here
// as well as commenting out its ROSTER entry: a leftover id would resolve to
// no agent def and 500 the lobby. test/llm-policies.test.ts walks this list
// through rosterById, so that mistake reddens the suite rather than shipping.
export const DEFAULT_TABLE = [
  ...CORE_TABLE,
  'hunyuan', 'solar', 'gpt-nano', 'mistral', 'mimo', 'qwen',
  'deepseek-pro', 'minimax', 'gemini-flash',
]

// What a personality-only agent (no model in its def) plays on when the seat
// doesn't override. Provisional: deepseek-flash is just the cheap starting
// point — the real pick is whatever balances cost, interesting table talk, and
// good play once we've measured that.
export const DEFAULT_MODEL = 'deepseek-flash'

export function rosterById(id: string): RosterEntry {
  const entry = ROSTER.find((r) => r.id === id)
  if (!entry) throw new Error(`unknown roster model id: ${id}`)
  return entry
}
