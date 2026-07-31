// test-lane: fast
// Contract test: the per-request timeout covers the WHOLE exchange, not just
// fetch(). A provider can return headers promptly and then stall the response
// body; the timer must stay armed across res.json()/res.text() so a stalled
// body aborts at TIMEOUT_MS (and maps to "OpenRouter timeout"), just like a
// stalled fetch. Regression: a sim once froze ~25min on a body that never
// finished, because the timer was cleared the instant fetch() resolved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOpenRouter } from '../../server/llm/openrouter.ts'

const realFetch = globalThis.fetch

function abortError(): Error {
  const e = new Error('This operation was aborted')
  e.name = 'AbortError'
  return e
}

// undici (Node's fetch) surfaces a body-read abort NOT as a top-level AbortError
// but as a TypeError 'terminated' with the AbortError nested in .cause. Mirror
// that shape so the test actually exercises the production mapping instead of a
// friendlier error the code would trivially match on `.name`.
function terminatedError(): Error {
  const e = new TypeError('terminated')
  ;(e as any).cause = abortError()
  return e
}

// A promise that never settles on its own — it rejects like a real stalled body
// read only once the request's AbortSignal fires.
function hangUntilAbort<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal.aborted) return reject(terminatedError())
    signal.addEventListener('abort', () => reject(terminatedError()), { once: true })
  })
}

test('a stalled response body aborts at the timeout and maps to OpenRouter timeout', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENROUTER_MAX_SPEND_USD
  try {
    // Headers arrive fine (ok: true), but the body never finishes on its own.
    globalThis.fetch = (async (_url: string, init: any) => {
      const signal: AbortSignal = init.signal
      return {
        ok: true,
        status: 200,
        json: () => hangUntilAbort(signal),
        text: () => hangUntilAbort(signal),
      } as unknown as Response
    }) as typeof fetch

    const client = createOpenRouter({ quiet: true, timeoutMs: 20 })
    await assert.rejects(
      client.call('some/model', [{ role: 'user', content: 'hi' }], { tag: 't' }),
      (e: unknown) => e instanceof Error && /OpenRouter timeout after 20ms/.test(e.message),
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a stalled error body (non-ok status) also aborts at the timeout', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENROUTER_MAX_SPEND_USD
  try {
    // A 500 whose error body never streams: res.text() must abort, not hang.
    globalThis.fetch = (async (_url: string, init: any) => {
      const signal: AbortSignal = init.signal
      return {
        ok: false,
        status: 500,
        json: () => hangUntilAbort(signal),
        text: () => hangUntilAbort(signal),
      } as unknown as Response
    }) as typeof fetch

    const client = createOpenRouter({ quiet: true, timeoutMs: 20 })
    await assert.rejects(
      client.call('some/model', [{ role: 'user', content: 'hi' }], { tag: 't' }),
      (e: unknown) => e instanceof Error && /OpenRouter timeout after 20ms/.test(e.message),
    )
  } finally {
    globalThis.fetch = realFetch
  }
})
