import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// The ratchet is an executable JavaScript build tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as ratchetModule from '../tools/strict-test-ratchet.mjs'

interface RatchetResult {
  readonly ok: boolean
  readonly strictRoots: readonly string[]
  readonly exemptionCount: number
  readonly diagnostics: string
  readonly errors: readonly string[]
}

const {
  checkStrictTestRatchet,
  discoverStrictTestInventory,
  normalizedSourceHash,
} = ratchetModule as {
  checkStrictTestRatchet(root: string): RatchetResult
  discoverStrictTestInventory(root: string): {
    readonly topLevelTests: readonly string[]
    readonly alwaysRoots: readonly string[]
  }
  normalizedSourceHash(source: string): string
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'avalon-strict-ratchet-'))
  mkdirSync(path.join(root, 'test', 'support'), { recursive: true })
  mkdirSync(path.join(root, 'test', 'typecheck'), { recursive: true })
  mkdirSync(path.join(root, 'tools'), { recursive: true })
  writeFileSync(
    path.join(root, 'tsconfig.server.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        strict: true,
        types: [],
        skipLibCheck: true,
      },
      include: ['server/**/*.ts'],
    }),
  )
  writeBaseline(root, [])
  return root
}

function writeBaseline(
  root: string,
  exemptions: ReadonlyArray<{
    readonly path: string
    readonly sha256: string
    readonly rationale: string
  }>,
): void {
  writeFileSync(
    path.join(root, 'tools', 'strict-test-baseline.json'),
    `${JSON.stringify({ version: 1, exemptions }, null, 2)}\n`,
  )
}

function write(
  root: string,
  relative: string,
  source: string,
): void {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}

function withFixture(run: (root: string) => void): void {
  const root = fixture()
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('new top-level tests are selected and strict failures stop the gate', () => {
  withFixture((root) => {
    write(
      root,
      'test/new-invalid.test.ts',
      'export function invalid(value) { return value }\n',
    )

    const result = checkStrictTestRatchet(root)
    assert.equal(result.ok, false)
    assert.ok(result.strictRoots.includes('test/new-invalid.test.ts'))
    assert.match(result.diagnostics, /Parameter 'value' implicitly has an 'any' type/)
  })
})

test('new top-level tests pass without an inventory edit when valid', () => {
  withFixture((root) => {
    write(
      root,
      'test/new-valid.test.ts',
      'export function valid(value: number): number { return value }\n',
    )

    const result = checkStrictTestRatchet(root)
    assert.equal(result.ok, true, result.diagnostics)
    assert.deepEqual(result.strictRoots, ['test/new-valid.test.ts'])
  })
})

test('one-byte changes to exempt legacy tests make the baseline stale', () => {
  withFixture((root) => {
    const relative = 'test/legacy.test.ts'
    const original = 'export function legacy(value) { return value }\n'
    write(root, relative, original)
    writeBaseline(root, [{
      path: relative,
      sha256: normalizedSourceHash(original),
      rationale: 'Legacy implicit-any fixture awaits focused migration.',
    }])
    assert.equal(checkStrictTestRatchet(root).ok, true)

    write(root, relative, `${original} `)
    const changed = checkStrictTestRatchet(root)
    assert.equal(changed.ok, false)
    assert.match(changed.errors.join('\n'), /exempt path changed/)
  })
})

test('deleted exempt legacy tests make the baseline stale', () => {
  withFixture((root) => {
    const relative = 'test/legacy.test.ts'
    const source = 'export function legacy(value) { return value }\n'
    write(root, relative, source)
    writeBaseline(root, [{
      path: relative,
      sha256: normalizedSourceHash(source),
      rationale: 'Legacy implicit-any fixture awaits focused migration.',
    }])
    rmSync(path.join(root, relative))

    const result = checkStrictTestRatchet(root)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), /exempt path was deleted/)
  })
})

test('baseline hashes treat CRLF and LF source as the same content', () => {
  assert.equal(
    normalizedSourceHash('first\r\nsecond\r\n'),
    normalizedSourceHash('first\nsecond\n'),
  )
})

test('support and typecheck trees are always strict roots', () => {
  withFixture((root) => {
    write(root, 'test/support/nested/helper.ts', 'export const helper = 1\n')
    write(
      root,
      'test/typecheck/contract.ts',
      'export const contract: number = 1\n',
    )
    const inventory = discoverStrictTestInventory(root)
    assert.deepEqual(inventory.alwaysRoots, [
      'test/support/nested/helper.ts',
      'test/typecheck/contract.ts',
    ])
    assert.equal(checkStrictTestRatchet(root).ok, true)

    write(
      root,
      'test/support/nested/helper.ts',
      'export function helper(value) { return value }\n',
    )
    const invalid = checkStrictTestRatchet(root)
    assert.equal(invalid.ok, false)
    assert.match(invalid.diagnostics, /Parameter 'value' implicitly has an 'any' type/)
  })
})
