// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { LruMap } from '../../server/shared/lru.ts'
import { repoUrl } from '../support/repo-root.ts'

test('an undefined key can be evicted without stalling', () => {
  const source = `
    import { LruMap } from ${JSON.stringify(repoUrl('server/shared/lru.ts').href)}
    const cache = new LruMap(1)
    cache.set(undefined, 1)
    cache.set('next', 2)
    if (cache.get(undefined) !== undefined || cache.get('next') !== 2) {
      process.exitCode = 1
    }
  `
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { encoding: 'utf8', timeout: 2_000 },
  )

  assert.equal(
    child.status,
    0,
    child.error?.message || child.stderr || child.stdout,
  )
})

test('a stored undefined value still counts as a recently used entry', () => {
  const cache = new LruMap<string, number | undefined>(2)
  cache.set('undefined-value', undefined)
  cache.set('older-defined-value', 1)

  cache.get('undefined-value')
  cache.set('new-value', 2)

  assert.equal(cache.get('older-defined-value'), undefined)
  assert.equal(cache.get('new-value'), 2)
})
