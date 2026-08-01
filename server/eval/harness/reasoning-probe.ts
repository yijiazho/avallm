// Reasoning-suppression probe: measure HOW (or whether) a candidate model's
// hidden reasoning can be turned off, BEFORE it earns a roster seat. This is
// the "how do we suppress reasoning" probe the onboarding playbook
// (docs/model-onboarding.md § 2) calls for — the one we ran by hand for
// gpt-oss / kimi / deepseek, whose per-model traps are recorded in
// server/llm/reasoning-policy.ts.
//
// It sweeps a fixed set of reasoning configs against a representative JSON ASK
// and reports, per config: mean reasoning tokens, blank-content rate, and mean
// cost. The winning config (rt≈0, no blanks, cheapest) IS the reasoning-policy
// entry to add. A model that errors on every disable flag is reasoning-
// mandatory (canSuppress:false) — usually a reject unless the ASK budget can
// absorb the reasoning tokens.
//
//   node server/eval/reasoning-probe.ts --model openai/gpt-oss-120b [--samples 5]
//
// It deliberately goes through the shared OpenRouter client (the same
// chokepoint the game uses) so the numbers reflect real play, overriding the
// reasoning field per variant via callOpts — exactly the escape hatch the
// client exposes for this purpose. Sweeping through the policy-applying client
// is the point: you cannot measure what a model's policy SHOULD be through the
// object that already applies one, so each call forces its own reasoning body.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { extractObject } from '../../agents/parse.ts'
import type { OpenRouterClient } from '../../llm/openrouter.ts'

// The suppression search space. `send` is what rides the request's `reasoning`
// field; null means send NOTHING (measures the model's default behavior). These
// are the exact levers reasoning-policy.ts can encode, so a winning variant
// maps 1:1 to a POLICIES entry: null → suppress:null, an object → suppress:obj.
export interface Variant { name: string; send: Record<string, unknown> | null }
export const VARIANTS: Variant[] = [
  { name: 'none-sent', send: null },
  { name: 'effort:none', send: { effort: 'none' } },
  { name: 'effort:minimal', send: { effort: 'minimal' } },
  { name: 'effort:low', send: { effort: 'low' } },
  { name: 'enabled:false', send: { enabled: false } },
]

export interface VariantResult {
  name: string
  calls: number
  blanks: number          // empty / unparseable-JSON replies
  transient: number       // samples skipped on a transient failure (rate limit / timeout / 5xx)
  reasoningTokens: number // mean per call (the signal: >0 = leaking)
  cost: number            // mean per call
  error?: string          // a TERMINAL rejection, e.g. HTTP 400 "reasoning cannot be disabled"
}

// A transient failure (rate limit, timeout, 5xx) is NOT a property of the
// reasoning flag — only a genuine parameter rejection (a 400-class error like
// "reasoning cannot be disabled") disqualifies a variant. Out-of-budget (the
// spend ceiling) is terminal too: retrying won't help. Everything transient we
// skip and keep going, so one rate-limited call can't poison the verdict — the
// exact failure mode of the `:free` slugs this probe is often pointed at.
function isTransient(msg: string): boolean {
  if (/spend ceiling/i.test(msg)) return false
  return /\bOpenRouter (?:429|408|5\d\d)\b/.test(msg) || /timeout after/i.test(msg)
}

// A representative structured ASK: short, demands strict JSON, mirrors the
// game's smallest real decision so the reasoning behavior generalizes to play.
const SYSTEM =
  'You are a player in a hidden-role game. Reply with ONLY a JSON object: '
  + '{"vote":"approve"|"reject","why":"<=8 words"}.'
const USER =
  'A 3-player team is proposed for a quest that fails if any member is evil. '
  + 'You have no information yet. Vote.'

export interface ProbeOpts {
  client: OpenRouterClient
  slug: string
  samples?: number
}

export async function reasoningProbe(opts: ProbeOpts): Promise<VariantResult[]> {
  const samples = opts.samples ?? 5
  const results: VariantResult[] = []
  for (const v of VARIANTS) {
    const tag = `probe/reason/${v.name}`
    let blanks = 0
    let transient = 0
    let error: string | undefined
    for (let i = 0; i < samples; i++) {
      try {
        const content = await opts.client.call(opts.slug, [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER },
        ], {
          tag,
          temperature: 0.4,
          max_tokens: 400,
          // Force EXACTLY this reasoning body (or nothing). allowReasoning:true
          // is the client's "send no reasoning field" path; an explicit object
          // is sent verbatim. No response_format: we want to SEE raw blanks,
          // not the client's silent blank-under-json retry, which would mask
          // the very failure mode we're measuring.
          ...(v.send === null ? { allowReasoning: true } : { reasoning: v.send }),
        })
        if (!extractObject(content)) blanks++
      } catch (e: unknown) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 120)
        // Transient (rate limit / timeout / 5xx): skip this sample but keep the
        // variant alive — a later clean sample still earns it a recommendation.
        // Only a terminal rejection stops the variant and disqualifies it.
        if (isTransient(msg)) { transient++; continue }
        error = msg
        break
      }
    }
    // Read the reasoning tokens + cost the client already accounted for per tag.
    const spend = opts.client.getSpend()[tag]
    const calls = spend?.calls ?? 0
    results.push({
      name: v.name,
      calls,
      blanks,
      transient,
      reasoningTokens: calls ? spend!.reasoning / calls : 0,
      cost: calls ? spend!.cost / calls : 0,
      error,
    })
  }
  return results
}

export interface Recommendation {
  canSuppress: boolean
  // The suppress value for a reasoning-policy.ts entry. `undefined` = no clean
  // win found (distinct from `null`, which is a real "suppress by omission").
  suppress: Record<string, unknown> | null | undefined
  variant?: string
  note: string
}

// Pure + offline-testable: pick the reasoning-policy entry a sweep implies.
// "Clean" = the call actually ran, never blanked, and leaked ~no reasoning.
export function recommendPolicy(results: VariantResult[]): Recommendation {
  const clean = (r: VariantResult) =>
    !r.error && r.calls > 0 && r.blanks === 0 && r.reasoningTokens < 1

  // Prefer the simplest clean control: sending nothing (suppress:null) beats
  // sending a flag — fewer moving parts, and it can't trip a per-model flag trap.
  const noneSent = results.find((r) => r.name === 'none-sent')
  if (noneSent && clean(noneSent)) {
    return {
      canSuppress: true, suppress: null, variant: 'none-sent',
      note: 'Reasons ~0 by default — suppress by sending nothing (suppress: null).',
    }
  }

  // Otherwise the cheapest clean flag wins (cost tie-breaks equal suppression).
  const cleanFlags = results
    .filter((r) => r.name !== 'none-sent' && clean(r))
    .sort((a, b) => a.cost - b.cost)
  if (cleanFlags.length) {
    const w = cleanFlags[0]!
    const send = VARIANTS.find((v) => v.name === w.name)!.send
    return {
      canSuppress: true, suppress: send, variant: w.name,
      note: `Suppressed by ${w.name} (rt≈0, no blanks). Add as suppress: ${JSON.stringify(send)}.`,
    }
  }

  // No clean variant. Transient failures make the sweep inconclusive rather than
  // conclusive-negative, so surface that first: a rate-limited `:free` slug can
  // starve the true suppressor of a clean sample. Otherwise: if every disable
  // flag errored, reasoning is mandatory; else it's controllable-but-leaky.
  const anyTransient = results.some((r) => r.transient > 0)
  const allErrored = results.every((r) => r.error || r.calls === 0)
  return {
    canSuppress: false,
    suppress: undefined,
    note: anyTransient
      ? 'Inconclusive — transient failures (rate limits / timeouts) skipped samples. '
        + 'Rerun, ideally against the paid (non-:free) slug.'
      : allErrored
        ? 'Reasoning appears MANDATORY (every disable flag errored) — canSuppress: false. '
          + 'Likely a reject unless the ASK budget can absorb the reasoning tokens.'
        : 'No clean suppression found (leaks or blanks on every variant) — needs a larger '
          + 'max_tokens, or is not a fit. Inspect the table before adding.',
  }
}

// ---- CLI ----

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      samples: { type: 'string', default: '5' },
    },
  })
  if (!values.model) {
    console.error('usage: node server/eval/reasoning-probe.ts --model <slug> [--samples 5]')
    process.exit(1)
  }
  const { getClient } = await import('../../llm/client.ts')
  const client = getClient()
  const samples = Number(values.samples)
  const results = await reasoningProbe({ client, slug: values.model, samples })

  console.log(`\nReasoning-suppression sweep — ${values.model} (${samples} samples/variant)\n`)
  console.log('variant          calls  blanks  rt/call    $/call   note')
  for (const r of results) {
    const note = r.error
      ? `ERR: ${r.error}`
      : r.transient
        ? `(${r.transient} transient sample${r.transient === 1 ? '' : 's'} skipped)`
        : ''
    console.log(
      `${r.name.padEnd(15)} ${String(r.calls).padStart(5)}  ${String(r.blanks).padStart(6)}  `
      + `${r.reasoningTokens.toFixed(0).padStart(7)}  ${('$' + r.cost.toFixed(5)).padStart(9)}   ${note}`,
    )
  }
  const rec = recommendPolicy(results)
  console.log(`\nRecommendation: ${rec.note}`)
  console.log(`Total probe spend: $${client.getTotalCost().toFixed(4)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
