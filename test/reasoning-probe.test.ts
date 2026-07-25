// recommendPolicy is the pure core of the reasoning-suppression probe — it
// turns a measured sweep into the reasoning-policy.ts entry to add. These cases
// pin the decision rules offline (no network, no key), mirroring the real traps
// recorded in reasoning-policy.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reasoningProbe, recommendPolicy, type VariantResult } from '../server/eval/reasoning-probe.ts'
import type { OpenRouterClient, SpendEntry } from '../server/llm/openrouter.ts'

// Build a full 5-variant sweep, overriding only the interesting cells.
function sweep(over: Partial<Record<string, Partial<VariantResult>>>): VariantResult[] {
  const base = (name: string): VariantResult =>
    ({ name, calls: 5, blanks: 0, transient: 0, reasoningTokens: 500, cost: 0.0002, ...over[name] })
  return ['none-sent', 'effort:none', 'effort:minimal', 'effort:low', 'enabled:false'].map(base)
}

// A stub OpenRouter client for exercising reasoningProbe offline. `behavior`
// decides, per (tag, 0-based call index within that tag), whether the call
// throws or returns — and mimics the per-tag spend accounting the real client
// keeps, since reasoningProbe reads reasoning tokens back out of getSpend().
function makeStub(
  behavior: (tag: string, idx: number) => { throw?: string; content?: string; rt?: number; cost?: number },
): OpenRouterClient {
  const spend: Record<string, SpendEntry> = {}
  const seq: Record<string, number> = {}
  return {
    async call(model, _messages, opts = {}) {
      const tag = opts.tag ?? 'other'
      const idx = seq[tag] ?? 0
      seq[tag] = idx + 1
      const b = behavior(tag, idx)
      if (b.throw) throw new Error(b.throw)
      const e = (spend[tag] ??= {
        cost: 0, calls: 0, prompt: 0, completion: 0, reasoning: 0,
        reasoningLeakCalls: 0, providerViolationCalls: 0, model, providers: {},
      })
      e.calls++
      e.reasoning += b.rt ?? 0
      e.cost += b.cost ?? 0
      return b.content ?? '{"vote":"reject","why":"x"}'
    },
    getSpend: () => spend,
    getTotalCost: () => Object.values(spend).reduce((s, e) => s + e.cost, 0),
  }
}

test('gemini-flash shape: clean by default → suppress by sending nothing', () => {
  const rec = recommendPolicy(sweep({ 'none-sent': { reasoningTokens: 0 } }))
  assert.equal(rec.canSuppress, true)
  assert.equal(rec.suppress, null) // real "suppress by omission", not undefined
  assert.equal(rec.variant, 'none-sent')
})

test('deepseek shape: default reasons, effort:none is the clean flag', () => {
  const rec = recommendPolicy(sweep({
    'effort:none': { reasoningTokens: 0 },
    // effort:low is the classic trap — maps UP and keeps reasoning on.
    'effort:low': { reasoningTokens: 620 },
  }))
  assert.equal(rec.canSuppress, true)
  assert.deepEqual(rec.suppress, { effort: 'none' })
  assert.equal(rec.variant, 'effort:none')
})

test('gpt-oss shape: default blanks, effort:low is the only clean flag', () => {
  const rec = recommendPolicy(sweep({
    'none-sent': { blanks: 5 },
    'effort:none': { blanks: 4 },
    'effort:minimal': { blanks: 3 },
    'effort:low': { reasoningTokens: 0, blanks: 0 },
    'enabled:false': { blanks: 5 },
  }))
  assert.equal(rec.canSuppress, true)
  assert.deepEqual(rec.suppress, { effort: 'low' })
})

test('cheapest clean flag wins when several suppress', () => {
  const rec = recommendPolicy(sweep({
    'none-sent': { reasoningTokens: 400 },
    'effort:none': { reasoningTokens: 0, cost: 0.0003 },
    'enabled:false': { reasoningTokens: 0, cost: 0.0001 }, // cheaper clean win
  }))
  assert.deepEqual(rec.suppress, { enabled: false })
})

test('gemini-pro shape: every disable flag errors → reasoning mandatory', () => {
  const err = { error: 'OpenRouter 400: reasoning cannot be disabled', calls: 0 }
  const rec = recommendPolicy(sweep({
    'none-sent': { reasoningTokens: 1100 },
    'effort:none': err,
    'effort:minimal': { reasoningTokens: 900 },
    'effort:low': { reasoningTokens: 950 },
    'enabled:false': err,
  }))
  // none-sent still reasons and the disable flags that could turn it off errored:
  // no clean control exists, so canSuppress is false.
  assert.equal(rec.canSuppress, false)
  assert.equal(rec.suppress, undefined) // undefined = "no clean win", not null
  assert.match(rec.note, /mandatory|No clean suppression/i)
})

test('leaky-everywhere shape: controllable but never clean → no recommendation', () => {
  const rec = recommendPolicy(sweep({
    'none-sent': { reasoningTokens: 300 },
    'effort:none': { reasoningTokens: 120 },
    'effort:minimal': { reasoningTokens: 200 },
    'effort:low': { reasoningTokens: 400 },
    'enabled:false': { reasoningTokens: 90 },
  }))
  assert.equal(rec.canSuppress, false)
  assert.equal(rec.suppress, undefined)
  assert.match(rec.note, /No clean suppression/i)
})

test('reasoningProbe: a transient 429 on the winning flag does not disqualify it', async () => {
  // effort:none rate-limits on its first sample, then comes back clean; every
  // other variant leaks. The 429 must not poison effort:none's verdict.
  const client = makeStub((tag, idx) => {
    if (tag.endsWith('effort:none')) {
      return idx === 0 ? { throw: 'OpenRouter 429: Rate limit exceeded: free-models-per-min.' } : { rt: 0 }
    }
    return { rt: 500 }
  })
  const results = await reasoningProbe({ client, slug: 'vendor/model', samples: 3 })
  const none = results.find((r) => r.name === 'effort:none')!
  assert.equal(none.error, undefined)           // 429 was NOT recorded as terminal
  assert.equal(none.transient, 1)               // it was counted as a skipped sample
  assert.ok(none.calls >= 1 && none.reasoningTokens < 1) // clean on the surviving samples
  assert.deepEqual(recommendPolicy(results).suppress, { effort: 'none' }) // still recommended
})

test('reasoningProbe: a 400 rejection is terminal and disqualifies the variant', async () => {
  const client = makeStub((tag) =>
    tag.endsWith('enabled:false') ? { throw: 'OpenRouter 400: reasoning cannot be disabled' } : { rt: 500 })
  const results = await reasoningProbe({ client, slug: 'vendor/model', samples: 3 })
  const ef = results.find((r) => r.name === 'enabled:false')!
  assert.match(ef.error ?? '', /400/)
  assert.equal(ef.transient, 0)
  assert.equal(ef.calls, 0) // broke before any successful call
})

test('reasoningProbe: an all-transient sweep reports inconclusive, not mandatory', async () => {
  const client = makeStub(() => ({ throw: 'OpenRouter 429: rate limited' }))
  const results = await reasoningProbe({ client, slug: 'vendor/model', samples: 2 })
  const rec = recommendPolicy(results)
  assert.equal(rec.canSuppress, false)
  assert.match(rec.note, /Inconclusive/i)
})
