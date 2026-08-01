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
