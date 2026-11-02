// test-lane: fast
// The shared data root: environment precedence is pure and explicit, and every
// consumer derives its directory from the one resolved base.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  dataDir,
  gamesDir,
  resolveDataDirBase,
  useDataDirBase,
  userAgentsDir,
} from '../../server/data-dir.ts'

test('AVALON_DATA_DIR wins over the Railway mount path', () => {
  assert.equal(resolveDataDirBase({
    AVALON_DATA_DIR: '/mnt/avalon',
    RAILWAY_VOLUME_MOUNT_PATH: '/mnt/railway',
  }), '/mnt/avalon')
})

test('an empty or whitespace value counts as unset', () => {
  assert.equal(resolveDataDirBase({
    AVALON_DATA_DIR: '   ',
    RAILWAY_VOLUME_MOUNT_PATH: '/mnt/railway',
  }), '/mnt/railway')
  assert.equal(resolveDataDirBase({ AVALON_DATA_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: '' }), undefined)
})

test('the Railway mount path is the fallback', () => {
  assert.equal(resolveDataDirBase({ RAILWAY_VOLUME_MOUNT_PATH: '/mnt/railway' }), '/mnt/railway')
})

test('an unconfigured root still points at the repo-local data directory', () => {
  useDataDirBase(undefined)
  const root = dataDir()
  assert.equal(path.basename(root), 'data')
  assert.equal(userAgentsDir(), path.join(root, 'agents'))
  assert.equal(gamesDir(), path.join(root, 'games'))
})

test('one base drives both the agent and game directories', () => {
  useDataDirBase('/mnt/avalon')
  assert.equal(dataDir(), '/mnt/avalon')
  assert.equal(userAgentsDir(), '/mnt/avalon/agents')
  assert.equal(gamesDir(), '/mnt/avalon/games')
  useDataDirBase(undefined)
})
