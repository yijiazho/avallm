import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from '../node_modules/typescript/lib/typescript.js'

const BASELINE_PATH = 'tools/strict-test-baseline.json'
const CONFIG_PATH = 'tsconfig.server.json'
const REQUIRED_STRICT_TOP_LEVEL = Object.freeze([
  'test/phase7r2c2-component-conformance.test.ts',
  'test/phase7r3a2-good-score-layers.test.ts',
])

function normalizeRepoPath(value) {
  return value.replaceAll('\\', '/')
}

export function normalizedSourceHash(source) {
  return createHash('sha256')
    .update(source.replace(/\r\n?/g, '\n'))
    .digest('hex')
}

function listFilesRecursively(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory)
  if (!existsSync(absoluteDirectory)) return []
  const pending = [absoluteDirectory]
  const files = []
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = normalizeRepoPath(path.relative(root, absolute))
      if (entry.isSymbolicLink()) {
        throw new Error(`strict-test roots cannot contain symlink ${relative}`)
      }
      if (entry.isDirectory()) {
        pending.push(absolute)
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(relative)
      }
    }
  }
  return files.sort()
}

export function discoverStrictTestInventory(root = process.cwd()) {
  const testDirectory = path.join(root, 'test')
  const topLevelTests = []
  for (const entry of readdirSync(testDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.test.ts')) continue
    if (!entry.isFile()) {
      throw new Error(
        `top-level test root must be a regular file: test/${entry.name}`,
      )
    }
    topLevelTests.push(`test/${entry.name}`)
  }
  topLevelTests.sort()
  const alwaysRoots = [
    ...listFilesRecursively(root, 'test/support'),
    ...listFilesRecursively(root, 'test/typecheck'),
  ].sort()
  return Object.freeze({
    topLevelTests: Object.freeze(topLevelTests),
    alwaysRoots: Object.freeze(alwaysRoots),
  })
}

function readBaseline(root) {
  const relativePath = BASELINE_PATH
  const absolutePath = path.join(root, relativePath)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (error) {
    throw new Error(
      `cannot read ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'exemptions,version'
    || parsed.version !== 1
    || !Array.isArray(parsed.exemptions)
  ) {
    throw new Error(`${relativePath} must contain version 1 and exemptions only`)
  }

  const entries = new Map()
  for (const [index, entry] of parsed.exemptions.entries()) {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'path,rationale,sha256'
      || typeof entry.path !== 'string'
      || !/^test\/[^/]+\.test\.ts$/.test(entry.path)
      || typeof entry.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || typeof entry.rationale !== 'string'
      || entry.rationale.trim().length < 12
    ) {
      throw new Error(
        `${relativePath} exemption ${index} has an invalid path, hash, or rationale`,
      )
    }
    if (entries.has(entry.path)) {
      throw new Error(`${relativePath} repeats exemption ${entry.path}`)
    }
    if (REQUIRED_STRICT_TOP_LEVEL.includes(entry.path)) {
      throw new Error(`${relativePath} cannot exempt required root ${entry.path}`)
    }
    entries.set(entry.path, Object.freeze({ ...entry }))
  }
  return entries
}

function compilerOptions(root) {
  const configPath = path.join(root, CONFIG_PATH)
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile)
  if (readResult.error) return { errors: [readResult.error] }
  const parsed = ts.convertCompilerOptionsFromJson(
    readResult.config.compilerOptions ?? {},
    root,
    configPath,
  )
  return { errors: parsed.errors, options: parsed.options }
}

function compileRoots(root, relativeRoots) {
  const config = compilerOptions(root)
  if (config.errors.length) return config.errors
  const roots = relativeRoots.map((relative) => path.join(root, relative))
  const program = ts.createProgram({
    rootNames: roots,
    options: config.options,
  })
  return ts.getPreEmitDiagnostics(program)
}

function formatDiagnostics(root, diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) =>
      normalizeRepoPath(path.relative(root, fileName)),
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }).trim()
}

export function checkStrictTestRatchet(root = process.cwd()) {
  const errors = []
  let inventory
  let exemptions
  try {
    inventory = discoverStrictTestInventory(root)
    exemptions = readBaseline(root)
  } catch (error) {
    return Object.freeze({
      ok: false,
      strictRoots: Object.freeze([]),
      exemptionCount: 0,
      diagnostics: '',
      errors: Object.freeze([
        error instanceof Error ? error.message : String(error),
      ]),
    })
  }

  const currentTests = new Set(inventory.topLevelTests)
  for (const [relative, exemption] of exemptions) {
    const absolute = path.join(root, relative)
    if (!currentTests.has(relative) || !existsSync(absolute)) {
      errors.push(
        `${BASELINE_PATH} is stale: exempt path was deleted: ${relative}`,
      )
      continue
    }
    if (!statSync(absolute).isFile()) {
      errors.push(`${BASELINE_PATH} is stale: exempt path is not a file: ${relative}`)
      continue
    }
    const actualHash = normalizedSourceHash(readFileSync(absolute, 'utf8'))
    if (actualHash !== exemption.sha256) {
      errors.push(
        `${BASELINE_PATH} is stale: exempt path changed: ${relative}`,
      )
    }
  }

  const strictRoots = [
    ...inventory.topLevelTests.filter((relative) => !exemptions.has(relative)),
    ...inventory.alwaysRoots,
  ].sort()
  const diagnostics = compileRoots(root, strictRoots)
  if (diagnostics.length) {
    errors.push(
      `strict test typecheck failed for ${strictRoots.length} roots`,
    )
  }
  return Object.freeze({
    ok: errors.length === 0,
    strictRoots: Object.freeze(strictRoots),
    exemptionCount: exemptions.size,
    diagnostics: formatDiagnostics(root, diagnostics),
    errors: Object.freeze(errors),
  })
}

export function auditStrictTestCandidates(root = process.cwd()) {
  const inventory = discoverStrictTestInventory(root)
  const roots = [...inventory.topLevelTests, ...inventory.alwaysRoots].sort()
  const diagnostics = compileRoots(root, roots)
  const failingTopLevel = new Set()
  const nonExemptibleDiagnostics = []
  for (const diagnostic of diagnostics) {
    const relative = diagnostic.file
      ? normalizeRepoPath(path.relative(root, diagnostic.file.fileName))
      : undefined
    if (relative && inventory.topLevelTests.includes(relative)) {
      failingTopLevel.add(relative)
    } else {
      nonExemptibleDiagnostics.push(diagnostic)
    }
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    failingTopLevel: Object.freeze([...failingTopLevel].sort()),
    nonExemptibleDiagnostics: formatDiagnostics(root, nonExemptibleDiagnostics),
    allDiagnostics: formatDiagnostics(root, diagnostics),
  })
}

function reportCheck(result) {
  for (const error of result.errors) console.error(error)
  if (result.diagnostics) console.error(result.diagnostics)
  if (result.ok) {
    console.log(
      `strict test ratchet: ${result.strictRoots.length} roots pass; `
        + `${result.exemptionCount} pinned legacy exemptions`,
    )
  }
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  if (process.argv[2] === '--audit') {
    const result = auditStrictTestCandidates()
    console.log(
      `${result.roots.length} candidate roots; `
        + `${result.failingTopLevel.length} top-level tests need review`,
    )
    for (const relative of result.failingTopLevel) {
      const source = readFileSync(relative, 'utf8')
      console.log(`${normalizedSourceHash(source)}  ${relative}`)
    }
    if (result.nonExemptibleDiagnostics) {
      console.error('non-exemptible strict diagnostics:')
      console.error(result.nonExemptibleDiagnostics)
      process.exitCode = 1
    }
  } else if (process.argv.length > 2) {
    console.error('usage: node tools/strict-test-ratchet.mjs [--audit]')
    process.exitCode = 2
  } else {
    const result = checkStrictTestRatchet()
    reportCheck(result)
    process.exitCode = result.ok ? 0 : 1
  }
}
