// test-lane: contract
// The post-game projection is a second chokepoint, not a live widening. No
// engine or agent module may import it, and no live path may pull in
// server/postgame. This is deliberately a source scan: the type is separate,
// but an accidental import can still be smuggled through a namespace or a
// re-export that a type-only review would miss.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { repoPath } from '../support/repo-root.ts'

const IMPORT_POSTGAME = /from\s+['"][^'"]*\/postgame\/[^'"]*['"]/
const NAMES_POSTGAME_VIEW = /\bviewForPostgame\b/

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(full)
    }
  }
  return found
}

test('no engine or agent module imports the post-game projection', () => {
  const root = repoPath()
  const offenders: string[] = []
  for (const file of sourceFiles(repoPath('server'))) {
    const relative = path.relative(root, file).replaceAll('\\', '/')
    if (relative === 'server/engine/view.ts') continue
    if (relative.startsWith('server/postgame/')) continue
    const source = readFileSync(file, 'utf8')
    if (NAMES_POSTGAME_VIEW.test(source) && (
      relative.startsWith('server/engine/')
      || relative.startsWith('server/agents/')
    )) {
      offenders.push(`${relative}: references viewForPostgame`)
    }
    if (IMPORT_POSTGAME.test(source) && (
      relative.startsWith('server/engine/')
      || relative.startsWith('server/agents/')
    )) {
      offenders.push(`${relative}: imports server/postgame`)
    }
    if (NAMES_POSTGAME_VIEW.test(source)) {
      offenders.push(`${relative}: references viewForPostgame outside server/postgame`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the projection lives outside the live view module and is explicit', () => {
  const viewSource = readFileSync(repoPath('server/engine/view.ts'), 'utf8')
  const typesSource = readFileSync(repoPath('server/engine/types.ts'), 'utf8')
  assert.match(viewSource, /export function viewForPostgame\(/)
  assert.match(viewSource, /export type PostgameView =/)
  assert.doesNotMatch(typesSource, /PostgameView/)
  assert.doesNotMatch(viewSource, IMPORT_POSTGAME)
})
