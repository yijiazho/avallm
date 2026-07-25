// The model roster — the cast of characters. Bots ARE models, openly badged.
// Slugs deliberately limited to ones vetted via docs/model-onboarding.md
// (rate cards + reasoning-suppression behavior verified there); prices are
// $/M prompt/completion as of 2026-07 and only inform tier labels — real
// cost accounting uses OpenRouter's usage.cost.
//
// TIERS are a blend, not a raw rate card. This game spends ~2800 prompt tokens
// against ~100 completion tokens per call (solved from two measured games and
// confirmed within 1% on three more, 2026-07), so PROMPT price dominates the
// bill roughly 27:1 — a model with a cheap prompt rate and an alarming
// completion rate is cheap HERE. Tier by `2800·prompt + 100·completion` in
// µ$/call: cheap < 500, mid < 1200, premium above. That ordering is why Kimi
// (1881) is premium while Qwen (1024) is mid, and why DeepSeek Pro is premium
// on prompt price alone despite the gentlest completion rate of the three.
// Re-derive the mix if call-params.ts budgets change materially.

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
    badge: { color: '#1A73E8' }, tier: 'mid',
  },
  {
    id: 'gemini-flash', displayName: 'Gemini Flash', slug: 'google/gemini-3-flash-preview',
    badge: { color: '#34A853' }, tier: 'premium',
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
    badge: { color: '#16A8A8' }, tier: 'premium',
  },
  {
    id: 'glm', displayName: 'GLM', slug: 'z-ai/glm-4.6',
    badge: { color: '#8B5CF6' }, tier: 'premium',
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
    badge: { color: '#F0424C' }, tier: 'mid',
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
  // Five new families (Xiaomi, Tencent, Alibaba/Qwen, Mistral, Upstage) plus an
  // OpenAI seat to replace benched GPT-OSS and a smarter DeepSeek sibling. A
  // sixth, MiniMax, was seated and benched a playtest later — see below.
  // Seven of the eight ship; each is drawn like any other seated model.
  {
    id: 'deepseek-pro', displayName: 'DeepSeek Pro', slug: 'deepseek/deepseek-v4-pro',
    badge: { color: '#2A3EB1' }, tier: 'premium',
  },
  {
    id: 'mimo', displayName: 'MiMo', slug: 'xiaomi/mimo-v2.5',
    badge: { color: '#F7A600' }, tier: 'cheap',
  },
  {
    id: 'hunyuan', displayName: 'Hunyuan', slug: 'tencent/hy3',
    badge: { color: '#0052D9' }, tier: 'cheap',
  },
  // MiniMax is benched on reliability, one playtest after being seated. It is
  // the only model so far to PASS the suppression probe and then fail in play:
  // effort:'none' measured rt 0 across 5 samples, but a real game leaked
  // reasoning on 3 of 191 calls — the Step 1 → Step 3 gap the playbook warns
  // about. It also degraded twice in that game (propose returned an
  // out-of-range seat; finalize broke the stick/team contract) and, partly
  // from paying for reasoning nobody asked for, cost 2-4× the other new seats.
  // Kept commented (not deleted) so it's a one-line restore — its
  // reasoning-policy family and Arcana glyph are still wired up. Re-probe with
  // more samples before restoring; 5 was not enough to catch this.
  // {
  //   id: 'minimax', displayName: 'MiniMax', slug: 'minimax/minimax-m3',
  //   badge: { color: '#C2185B' }, tier: 'mid',
  // },
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
    badge: { color: '#10A37F' }, tier: 'mid',
  },
  {
    id: 'solar', displayName: 'Solar', slug: 'upstage/solar-pro-3',
    badge: { color: '#00838F' }, tier: 'cheap',
  },
]

// Every seated model — the pool a table draws from. Auto-fill paths
// (leftoverPool in agents/packs.ts, defaultTable in the client's App.tsx)
// SHUFFLE this whole pool, so order is discarded on every path a human
// touches. It survives in exactly one place: the server's fallback when a
// caller posts no table at all (server.ts) takes the first `botCount` off the
// front. The client never hits that — its setup screen always posts a table —
// so treat the order below as a tiebreak for API/sim callers, nothing more.
//
// The leading six are the historical default table, one model family per seat.
// (Seat churn: Haiku was benched on cost and Seed took its seat; GPT-OSS was
// benched on reliability — see above — and after a brief Gemini Flash stopgap
// that doubled the Google family, Nemotron (NVIDIA) took the seat once it
// cleared docs/model-onboarding.md.) The tail is the 2026-07 batch plus Gemini
// Flash, ordered by measured playtest quality so the fallback path stays sane:
// clean games first, then the two that degraded once, then the expensive seats.
// Because the pool is drawn flat, a table CAN now seat two Google or two
// DeepSeek variants; they're distinct models, distinctly badged.
//
// Because this names EVERY seated model, benching one means deleting it here
// as well as commenting out its ROSTER entry: a leftover id would resolve to
// no agent def and 500 the lobby. test/llm-policies.test.ts walks this list
// through rosterById, so that mistake reddens the suite rather than shipping.
export const DEFAULT_TABLE = [
  'deepseek-flash', 'gemini-flash-lite', 'seed', 'kimi', 'glm', 'nemotron',
  'hunyuan', 'solar', 'gpt-nano', 'mistral', 'mimo', 'qwen',
  'deepseek-pro', 'gemini-flash',
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
