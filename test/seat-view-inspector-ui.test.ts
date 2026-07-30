import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  createSeatViewInspectorUiServer,
  startSeatViewInspectorUi,
} from '../server/eval/seat-view-inspector-ui.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

async function textAt(url: string): Promise<{
  status: number
  headers: Headers
  text: string
}> {
  const response = await fetch(url)
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  }
}

function requestWithHost(url: string, host: string): Promise<{
  status: number
  body: string
}> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers: { Host: host },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

test('seat microscope binds only to IPv4 loopback on an ephemeral port', async (t) => {
  const running = await startSeatViewInspectorUi()
  t.after(() => running.close())

  const address = running.server.address()
  assert.ok(address && typeof address !== 'string')
  assert.equal(address.address, '127.0.0.1')
  assert.ok(address.port > 0)
  assert.equal(running.url, `http://127.0.0.1:${address.port}/`)

  await assert.rejects(
    startSeatViewInspectorUi({ port: 65_536 }),
    /port must be an integer from 0 to 65535/,
  )
})

test('the synchronous constructor is explicitly seat-view-only', () => {
  assert.throws(
    () => createSeatViewInspectorUiServer({
      mode: 'native-policy',
    } as unknown as Parameters<typeof createSeatViewInspectorUiServer>[0]),
    /supports seat-view mode only/,
  )
})

test('non-loopback Host headers are rejected without reflecting the host', async (t) => {
  const running = await startSeatViewInspectorUi()
  t.after(() => running.close())
  const marker = 'host-marker-must-not-reflect.example'
  const response = await requestWithHost(running.url, marker)

  assert.equal(response.status, 403)
  assert.ok(!response.body.includes(marker))
  assert.match(response.body, /loopback Host/)
})

test('HTML, CSS, and JavaScript assets are local, hardened, and product-independent', async (t) => {
  const running = await startSeatViewInspectorUi()
  t.after(() => running.close())

  const [html, css, javascript] = await Promise.all([
    textAt(running.url),
    textAt(`${running.url}styles.css`),
    textAt(`${running.url}app.js`),
  ])

  assert.equal(html.status, 200)
  assert.equal(html.headers.get('cache-control'), 'no-store')
  assert.match(html.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  assert.match(html.text, /Seat Decision <span>Microscope/)
  assert.match(
    html.text,
    /Inspect what one seat could know and how an admitted run used it/,
  )
  assert.match(html.text, /Exact-admitted policy run when available/)
  assert.match(html.text, /How knowledge shaped this decision/)
  assert.match(
    html.text,
    /Policy stages come only from exact admission; seat-view mode remains evidence-only/,
  )
  assert.match(html.text, /Decision components/)
  assert.doesNotMatch(html.text, /Reconstruct what one player could know/)
  assert.doesNotMatch(html.text, /How knowledge could shape play/)
  assert.doesNotMatch(html.text, /Only the evidence chamber is populated/)
  assert.doesNotMatch(html.text, /Role components/)
  assert.match(javascript.text, /trace evidence eligible/)
  assert.match(javascript.text, /SeatDecisionInspection projection/)
  assert.doesNotMatch(javascript.text, /'promotion eligible'/)
  assert.doesNotMatch(javascript.text, /SeatViewInspection projection/)
  assert.match(html.text, /raw input never\s+enters browser JavaScript/)
  assert.ok(!html.text.includes('<textarea'))
  assert.ok(!html.text.includes('client/'))

  assert.equal(css.status, 200)
  assert.match(css.text, /--public: #7bc9c2/)
  assert.match(css.text, /--private: #9b8fd8/)
  assert.match(css.text, /prefers-reduced-motion/)
  assert.match(css.text, /html\s*\{[^}]*overflow-x:\s*clip/s)
  assert.match(css.text, /select\s*\{[^}]*min-width:\s*0/s)

  assert.equal(javascript.status, 200)
  assert.match(javascript.text, /textContent/)
  assert.ok(!javascript.text.includes('innerHTML'))
  assert.ok(!javascript.text.includes("method: 'POST'"))
})

test('frozen fixture selection returns only allow-listed projection data', async (t) => {
  const running = await startSeatViewInspectorUi({
    initialFixture: 'servant-vote-after-evidence',
  })
  t.after(() => running.close())

  const metadataResponse = await fetch(`${running.url}api/fixtures`)
  const metadata = await metadataResponse.json() as {
    selectedId: string
    fixtures: { id: string; decision: unknown; self: unknown }[]
  }
  assert.equal(metadata.selectedId, 'servant-vote-after-evidence')
  assert.ok(metadata.fixtures.length > 1)
  assert.deepEqual(
    Object.keys(metadata.fixtures[0]).sort(),
    ['decision', 'id', 'self'],
  )

  const response = await fetch(
    `${running.url}api/fixture?id=${encodeURIComponent(metadata.selectedId)}`,
  )
  const inspection = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200)
  assert.deepEqual(
    Object.keys(inspection).sort(),
    [
      'decisionPoint',
      'omissions',
      'policyRun',
      'privateKnowledge',
      'provenance',
      'publicBoard',
      'schema',
      'self',
      'visibleHistory',
    ],
  )
  const serialized = JSON.stringify(inspection)
  const policyRun = inspection.policyRun as {
    status: string
    value?: {
      scoreLayers: { status: string; journal?: unknown[] }
      commitment: { committedMechanicalAction?: unknown; voice?: unknown }
    }
  }
  assert.equal(policyRun.status, 'present')
  assert.equal(policyRun.value?.scoreLayers.status, 'present')
  assert.ok((policyRun.value?.scoreLayers.journal?.length ?? 0) > 0)
  assert.ok(policyRun.value?.commitment.committedMechanicalAction)
  assert.ok(policyRun.value?.commitment.voice)
  for (const forbidden of [
    'baselineDecision',
    '"req"',
    '"view"',
    '"seed"',
    'pendingCards',
    'pendingVotes',
    'trueDeal',
    'architectureIdentityDigest',
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden)
  }
})

test('custom snapshot files are projected before serving and never retained by the handler', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-microscope-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const fixture = structuredClone(readDecisionFixtures()[0])
  const marker = 'raw-custom-marker-must-not-cross'
  Object.assign(fixture, { baselineDecision: { kind: marker } })
  Object.assign(fixture.view, { harmlessUnknownInput: marker })
  const file = path.join(directory, 'custom.json')
  fs.writeFileSync(file, JSON.stringify(fixture))

  const running = await startSeatViewInspectorUi({ fixtureFile: file })
  t.after(() => running.close())
  const response = await fetch(`${running.url}api/fixture?id=${fixture.id}`)
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.ok(!text.includes(marker))
  assert.ok(!text.includes('baselineDecision'))
  assert.ok(!text.includes('harmlessUnknownInput'))
})

test('seat-view-only mode preserves the boundary projection without inventing policy stages', async (t) => {
  const running = await startSeatViewInspectorUi({ mode: 'seat-view' })
  t.after(() => running.close())
  const metadata = await fetch(`${running.url}api/fixtures`).then(
    (response) => response.json(),
  ) as { selectedId: string }
  const inspection = await fetch(
    `${running.url}api/fixture?id=${encodeURIComponent(metadata.selectedId)}`,
  ).then((response) => response.json()) as {
    schema: number
    policyRun: { status: string; reason: string }
  }

  assert.equal(inspection.schema, 2)
  assert.equal(inspection.policyRun.status, 'absent')
  assert.match(inspection.policyRun.reason, /No exact admitted policy run/)
})

test('invalid custom files fail before native execution and do not echo raw values', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-microscope-invalid-'))
  try {
    const fixture = structuredClone(readDecisionFixtures()[0])
    const marker = 'private-seed-value-must-not-echo'
    Object.assign(fixture.view, { seed: marker })
    const file = path.join(directory, 'invalid.json')
    fs.writeFileSync(file, JSON.stringify(fixture))

    await assert.rejects(
      startSeatViewInspectorUi({ fixtureFile: file }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /raw Game field "seed"/)
        assert.ok(!error.message.includes(marker))
        return true
      },
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
