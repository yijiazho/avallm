// Loopback-only UI for exploring the allow-listed SeatViewInspection projection.
//
// This is development tooling, deliberately separate from the production HTTP
// server and client. The browser is never sent the fixture envelope, raw
// DecisionRequest, PlayerView, baseline decision, seed, or Game.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectSeatView,
  readSeatViewSnapshotFile,
  type SeatViewInspection,
  type SeatViewSnapshotFileEntry,
} from './seat-view-inspector.ts'
import {
  inspectSeatViewOnlyDecision,
  type SeatDecisionInspection,
} from './seat-decision-inspector.ts'
import {
  inspectNativeSeatDecisionFixtures,
} from './seat-decision-fixtures.ts'

const LOOPBACK_HOST = '127.0.0.1'
const ASSET_DIRECTORY = fileURLToPath(new URL('./seat-view-inspector-ui/', import.meta.url))

const ASSETS = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
])

export interface SeatViewInspectorUiOptions {
  fixtureFile?: string
  initialFixture?: string
  port?: number
  /**
   * Defaults to native-policy, which runs the policy and is why this entry
   * point is asynchronous. Seat-view is served here too, for the CLI flag.
   */
  mode?: 'native-policy' | 'seat-view'
}

/**
 * No mode here. Seat-view is the only projection this entry point can serve,
 * because it is the only one that needs no native policy run, and that is what
 * lets the server be constructed synchronously. Which projection you get is
 * settled by which function you call, so a mode field could only ever restate
 * the choice already made. Native-policy is startSeatViewInspectorUi.
 */
export interface SeatViewInspectorServerOptions {
  fixtureFile?: string
  initialFixture?: string
}

export interface RunningSeatViewInspectorUi {
  server: http.Server
  url: string
  close(): Promise<void>
}

interface FixtureProjection {
  id: string
  decision: SeatViewInspection['decisionPoint']
  self: SeatViewInspection['self']
}

interface ProjectedFixture {
  id: string
  inspection: SeatDecisionInspection
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    + "img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  value: unknown,
): void {
  setSecurityHeaders(response)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function sendError(
  response: http.ServerResponse,
  status: number,
  error: unknown,
): void {
  sendJson(response, status, { error: errorMessage(error) })
}

function hostIsLoopback(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

function fixtureId(entry: SeatViewSnapshotFileEntry, index: number): string {
  return entry.id ?? `snapshot-${index + 1}`
}

function inspectEntry(entry: SeatViewSnapshotFileEntry): SeatViewInspection {
  return inspectSeatView(entry.req, entry.view)
}

function createRequestHandler(
  entries: ProjectedFixture[],
  initialFixture: string | undefined,
): http.RequestListener {
  const projectedFixtures: FixtureProjection[] = entries.map(({ id, inspection }) => {
    return {
      id,
      decision: inspection.decisionPoint,
      self: inspection.self,
    }
  })
  const selectedId = initialFixture ?? projectedFixtures[0]?.id
  if (initialFixture && !projectedFixtures.some(({ id }) => id === initialFixture)) {
    throw new Error(`unknown initial fixture "${initialFixture}"`)
  }

  return async (request, response) => {
    if (!hostIsLoopback(request.headers.host)) {
      sendError(response, 403, 'seat microscope accepts only loopback Host headers')
      return
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    try {
      if (request.method === 'GET' && url.pathname === '/api/fixtures') {
        sendJson(response, 200, {
          fixtures: projectedFixtures,
          selectedId,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/fixture') {
        const id = url.searchParams.get('id')
        const index = projectedFixtures.findIndex((fixture) => fixture.id === id)
        if (index < 0) {
          sendError(response, 404, `unknown fixture "${id ?? ''}"`)
          return
        }
        sendJson(response, 200, entries[index].inspection)
        return
      }
      const asset = request.method === 'GET' ? ASSETS.get(url.pathname) : undefined
      if (asset) {
        setSecurityHeaders(response)
        response.statusCode = 200
        response.setHeader('Content-Type', asset.type)
        response.end(fs.readFileSync(path.join(ASSET_DIRECTORY, asset.file)))
        return
      }
      sendError(response, 404, 'not found')
    } catch (error) {
      sendError(response, 400, error)
    }
  }
}

/** The seat-view-only server, built without listening. See the options doc. */
export function createSeatViewInspectorUiServer(
  options: SeatViewInspectorServerOptions = {},
): http.Server {
  const entries = readSeatViewSnapshotFile(
    options.fixtureFile ?? 'test/fixtures/architecture-decision-views.json',
  )
  if (entries.length === 0) throw new Error('seat microscope needs at least one snapshot')
  // Transform once, before the request handler exists. The server closure retains
  // only fixture ids and validated SeatViewInspection values.
  const projected = entries.map((entry, index): ProjectedFixture => ({
    id: fixtureId(entry, index),
    inspection: inspectSeatViewOnlyDecision(inspectEntry(entry)),
  }))
  return http.createServer(createRequestHandler(projected, options.initialFixture))
}

export async function startSeatViewInspectorUi(
  options: SeatViewInspectorUiOptions = {},
): Promise<RunningSeatViewInspectorUi> {
  const port = options.port ?? 0
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('seat microscope port must be an integer from 0 to 65535')
  }
  const entries = readSeatViewSnapshotFile(
    options.fixtureFile ?? 'test/fixtures/architecture-decision-views.json',
  )
  if (entries.length === 0) throw new Error('seat microscope needs at least one snapshot')
  const projected = options.mode === 'seat-view'
    ? entries.map((entry, index): ProjectedFixture => ({
        id: fixtureId(entry, index),
        inspection: inspectSeatViewOnlyDecision(inspectEntry(entry)),
      }))
    : await inspectNativeSeatDecisionFixtures(entries)
  const server = http.createServer(
    createRequestHandler([...projected], options.initialFixture),
  )
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK_HOST, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    server.close()
    throw new Error('seat microscope failed to bind to IPv4 loopback')
  }
  return {
    server,
    url: `http://${LOOPBACK_HOST}:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
