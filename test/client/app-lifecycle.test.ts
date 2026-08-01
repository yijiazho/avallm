// test-lane: fast
// App owns browser routing and the network lifetimes attached to each route.
// These source contracts keep hash navigation observable and prevent a closed
// EventSource ref from masquerading as a live subscription after cleanup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.tsx',
)
const app = fs.readFileSync(appPath, 'utf8')

test('App follows hash navigation and releases the listener', () => {
  assert.match(app, /window\.addEventListener\('hashchange', syncFromHash\)/)
  assert.match(app, /window\.removeEventListener\('hashchange', syncFromHash\)/)
  assert.match(app, /if \(sameScreen\(screenRef\.current, next\)\) return/)
})

test('route restoration responds to screen changes', () => {
  assert.match(app, /\}, \[screen, enterLobby\]\)/)
  assert.match(app, /\}, \[screen, openGame, showScreen\]\)/)
})

test('closed route streams are nulled so they can be restored', () => {
  assert.match(app, /esRef\.current\?\.close\(\)[\s\S]*?esRef\.current = null/)
  assert.match(app, /lobbyEsRef\.current\?\.close\(\)[\s\S]*?lobbyEsRef\.current = null/)
})

test('decision submissions are single-flight and recover from failures', () => {
  assert.match(app, /if \(!gameId \|\| !gameToken \|\| decisionAbortRef\.current\) return/)
  assert.match(app, /signal: ctrl\.signal/)
  assert.match(app, /catch \(e\)[\s\S]*?setError\(e instanceof Error/)
  assert.match(app, /if \(!accepted && decisionAbortRef\.current === ctrl\)/)
})

test('the action bar is replaced while a decision is pending', () => {
  assert.match(app, /: decisionPending\s*\? <div className="action-bar waiting">/)
  assert.match(app, /decisionAbortRef\.current = null\s*setDecisionPending\(false\)/)
})

test('reveal loading rejects error payloads and retries transient failures', () => {
  const effect = app.match(/const loadReveal = async \(\) => \{([\s\S]*?)\n    \}\n    void loadReveal\(\)/)
  assert.ok(effect, 'App no longer owns the retryable reveal loader')
  assert.match(effect[1]!, /if \(!res\.ok\)[\s\S]*?throw new Error/)
  assert.match(effect[1]!, /const data: RevealPayload = await res\.json\(\)/)
  assert.match(effect[1]!, /window\.setTimeout\(\(\) => void loadReveal\(\), 2_000\)/)
  assert.match(app, /ctrl\.abort\(\)[\s\S]*?window\.clearTimeout\(retryTimer\)/)
})

test('agent library loading validates, reports, and retries failures', () => {
  const loader = app.match(/const loadLibrary = async \(\) => \{([\s\S]*?)\n    \}\n    void loadLibrary\(\)/)
  assert.ok(loader, 'App no longer owns the retryable agent-library loader')
  assert.match(loader[1]!, /if \(!res\.ok\)[\s\S]*?throw new Error/)
  assert.match(loader[1]!, /const data: unknown = await res\.json\(\)[\s\S]*?if \(!isLibrary\(data\)\)/)
  assert.match(loader[1]!, /setLibraryError\([\s\S]*?window\.setTimeout\(\(\) => void loadLibrary\(\), 2_000\)/)
  assert.match(app, /Array\.isArray\(candidate\.agents\)[\s\S]*?Array\.isArray\(candidate\.models\)/)
  assert.match(app, /error=\{error \?\? libraryError\}/)
})
