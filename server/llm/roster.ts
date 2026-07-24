// The model roster — the cast of characters. Bots ARE models, openly badged.
// Slugs deliberately limited to ones measured in datingsim's MODELS.md
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
  {
    id: 'deepseek', displayName: 'DeepSeek', slug: 'deepseek/deepseek-v4-flash',
    badge: { color: '#4D6BFE' }, tier: 'cheap',
  },
  {
    id: 'gemini', displayName: 'Gemini', slug: 'google/gemini-3.1-flash-lite',
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
]

// Default 6-bot table (7p game with one human), spread across model families.
// (Haiku held the 6th seat until it was benched on cost; GPT-OSS held the last
// until it was benched on reliability — see above. GPT-OSS was the roster's
// only OpenAI seat, so with it out Gemini Flash fills the seat — which doubles
// up the Google family rather than leaving the seat empty.)
export const DEFAULT_TABLE = ['deepseek', 'gemini', 'seed', 'kimi', 'glm', 'gemini-flash']

// What a personality-only agent (no model in its def) plays on when the seat
// doesn't override. Provisional: deepseek is just the cheap starting point —
// the real pick is whatever balances cost, interesting table talk, and good
// play once we've measured that.
export const DEFAULT_MODEL = 'deepseek'

export function rosterById(id: string): RosterEntry {
  const entry = ROSTER.find((r) => r.id === id)
  if (!entry) throw new Error(`unknown roster model id: ${id}`)
  return entry
}
