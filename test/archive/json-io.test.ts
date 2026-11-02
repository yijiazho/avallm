// test-lane: fast
// Shared JSON file I/O: atomic replace, named malformed-file errors, and temp
// files that a directory scan must ignore.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isTempFile, readJsonFile, writeJsonAtomic } from '../../server/json-io.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-json-io-'))

after(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

test('writeJsonAtomic creates parents and replaces the previous value', () => {
  const file = path.join(root, 'nested', 'record.json')
  writeJsonAtomic(file, { value: 1 })
  assert.deepEqual(readJsonFile(file), { value: 1 })
  writeJsonAtomic(file, { value: 2 })
  assert.deepEqual(readJsonFile(file), { value: 2 })
})

test('pretty output remains valid JSON', () => {
  const file = path.join(root, 'pretty.json')
  writeJsonAtomic(file, { value: 1 }, { pretty: true })
  assert.match(fs.readFileSync(file, 'utf8'), /\n  "value": 1/)
  assert.deepEqual(readJsonFile(file), { value: 1 })
})

test('a failed write leaves the previous record intact', () => {
  const file = path.join(root, 'stable.json')
  writeJsonAtomic(file, { value: 'old' })
  // A directory in the temp path makes writeFileSync fail before rename.
  fs.mkdirSync(`${file}.tmp-${process.pid}`, { recursive: true })
  assert.throws(() => writeJsonAtomic(file, { value: 'new' }), /could not write/)
  assert.deepEqual(readJsonFile(file), { value: 'old' })
})

test('a malformed file error names the file and position', () => {
  const file = path.join(root, 'bad.json')
  fs.writeFileSync(file, '{\n  "broken": }\n')
  assert.throws(
    () => readJsonFile(file),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(err.message.includes(file))
      assert.match(err.message, /not valid JSON/)
      return true
    },
  )
})

test('atomic temp files are identifiable during scans', () => {
  assert.equal(isTempFile('game-1.json.tmp-123'), true)
  assert.equal(isTempFile('game-1.tmp-123.json'), true)
  assert.equal(isTempFile('game-1.json'), false)
})
