import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Architecture fitness is an executable JavaScript tool, not a server module.
// @ts-expect-error The test supplies the narrow runtime contract below.
import * as architectureModule from '../tools/architecture-fitness.mjs'

interface ArchitectureViolation {
  readonly rule: string
  readonly importer: string
  readonly specifier?: string
  readonly line?: number
  readonly message: string
}

const {
  auditArchitectureSources,
  checkRepositoryArchitecture,
  checkStrictTestRatchetOwnership,
  inspectSource,
} = architectureModule as {
  auditArchitectureSources(
    sources: ReadonlyArray<readonly [string, unknown]>,
  ): readonly ArchitectureViolation[]
  checkRepositoryArchitecture(root?: string): readonly ArchitectureViolation[]
  checkStrictTestRatchetOwnership(
    root?: string,
  ): readonly ArchitectureViolation[]
  inspectSource(path: string, source: string): {
    readonly edges: readonly {
      readonly kind: 'import' | 'export'
      readonly specifier: string
      readonly names: readonly string[]
      readonly namespace: boolean
      readonly locals: readonly string[]
      readonly line: number
    }[]
    readonly ambientReads: ReadonlySet<string>
    readonly scopedBindings: ReadonlySet<string>
  }
}

function rules(sources: ReadonlyArray<readonly [string, unknown]>): string[] {
  return auditArchitectureSources(sources).map((violation) => violation.rule)
}

test('repository sources satisfy the coarse architecture fitness rules', () => {
  assert.deepEqual(checkRepositoryArchitecture(), [])
})

test('runtime and admission cannot rebuild scorer-sensitive situation analysis', () => {
  for (const owner of [
    'server/agents/policy/decision-frame.ts',
    'server/agents/admission/composed-trace.ts',
  ]) {
    const violations = auditArchitectureSources([[
      owner,
      'import { analyzeSituation } from "../analysis/situation.ts"\n',
    ]])
    assert.deepEqual(
      violations.map(({ rule }) => rule),
      ['ARCH008'],
      owner,
    )
    assert.match(
      violations[0].message,
      /scorer-situation-surface/,
      owner,
    )
  }
})

test('server consumers cannot bypass closed trace admission results', () => {
  const admission = '../agents/admission/composed-trace.ts'
  const violations = auditArchitectureSources([
    [
      'server/eval/named.ts',
      `import {
        validateComposedTraceHostJoin
      } from "${admission}"\n`,
    ],
    [
      'server/eval/aliased.ts',
      `import {
        validateFinalizedDiagnosticDecisionTrace as validate
      } from "${admission}"\n`,
    ],
    [
      'server/eval/namespace.ts',
      `import * as admission from "${admission}"\n`,
    ],
    [
      'server/eval/dynamic.ts',
      `const admission = await import("${admission}")\n`,
    ],
    [
      'server/eval/export-star.ts',
      `export * from "${admission}"\n`,
    ],
    [
      'server/eval/re-export.ts',
      `export {
        validateSuppressedEvilQuestCardPolicyHostJoin as validate
      } from "${admission}"\n`,
    ],
  ])
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    Array(6).fill('ARCH009'),
  )
  for (const violation of violations) {
    assert.match(violation.message, /closed trace admission result/)
  }
  assert.deepEqual(
    auditArchitectureSources([[
      'server/eval/example.ts',
      `import {
        admitDecisionTrace
      } from "../agents/admission/composed-trace.ts"\n`,
    ]]),
    [],
  )
})

test('transport canonicalization is confined to trace admission ingress', () => {
  const canonical = '../agents/components/canonical-json.ts'
  const violations = auditArchitectureSources([
    [
      'server/eval/named.ts',
      `import { canonicalizeTransportJson } from "${canonical}"\n`,
    ],
    [
      'server/eval/aliased.ts',
      `export {
        canonicalizeTransportJson as snapshot
      } from "${canonical}"\n`,
    ],
    [
      'server/eval/namespace.ts',
      `const canonical = await import("${canonical}")\n`,
    ],
  ])
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    Array(3).fill('ARCH010'),
  )
  assert.deepEqual(
    auditArchitectureSources([[
      'server/eval/strict.ts',
      `import { canonicalizeJson } from "${canonical}"\n`,
    ]]),
    [],
  )
})

test('the strict test ratchet is the only test typecheck inventory', () => {
  assert.equal(existsSync('tsconfig.score-layer-contract.json'), false)

  const testConfigOwners = readdirSync('.')
    .filter((file) => /^tsconfig(?:\.[^.]+)*\.json$/.test(file))
    .filter((file) => {
      const config = JSON.parse(readFileSync(file, 'utf8'))
      return (config.include ?? []).some(
        (pattern: unknown) =>
          typeof pattern === 'string' && /^test[\\/]/.test(pattern),
      )
    })
  assert.deepEqual(testConfigOwners, [])

  const baselineOwners = readdirSync('tools')
    .filter((file) => file.endsWith('.mjs'))
    .filter((file) =>
      readFileSync(`tools/${file}`, 'utf8')
        .includes('strict-test-baseline.json'))
  assert.deepEqual(baselineOwners, ['strict-test-ratchet.mjs'])

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(
    packageJson.scripts.typecheck,
    'tsc -p tsconfig.server.json && tsc -p client/tsconfig.json'
      + ' && node tools/strict-test-ratchet.mjs',
  )
  assert.doesNotMatch(
    readFileSync('tools/architecture-fitness.mjs', 'utf8'),
    /scoreLayerContractInventoryViolations/,
  )
})

test('strict test ownership rejects hidden roots, references, and malformed shapes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'avalon-strict-ownership-'))
  try {
    mkdirSync(path.join(root, 'tools'))
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          typecheck:
            'tsc -p tsconfig.server.json && tsc -p client/tsconfig.json'
              + ' && node tools/strict-test-ratchet.mjs',
        },
      }),
    )
    writeFileSync(path.join(root, 'tools', 'strict-test-ratchet.mjs'), '')
    mkdirSync(path.join(root, 'server'))
    mkdirSync(path.join(root, 'test'))
    writeFileSync(path.join(root, 'server', 'placeholder.ts'), 'export {}\n')
    writeFileSync(path.join(root, 'test', 'hidden.test.ts'), 'export {}\n')
    writeFileSync(
      path.join(root, 'tsconfig.server.json'),
      JSON.stringify({
        compilerOptions: { strict: true },
        include: ['server/**/*.ts'],
      }),
    )
    assert.deepEqual(checkStrictTestRatchetOwnership(root), [])

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ files: ['test\\hidden.test.ts'] }),
    )
    let violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['*/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: ['./test/**/*.test.ts'] }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /strict test roots/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({
        files: ['server/placeholder.ts'],
        references: [{ path: './nested' }],
      }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /project references are rejected/)

    writeFileSync(
      path.join(root, 'tsconfig.hidden.json'),
      JSON.stringify({ include: {}, files: 'test/hidden.test.ts' }),
    )
    violations = checkStrictTestRatchetOwnership(root)
    assert.equal(violations.length, 1)
    assert.match(violations[0].message, /TypeScript config is invalid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the engine cannot read a clock, a random, or the filesystem', () => {
  const engine = (body: string) =>
    rules([['server/engine/rules.ts', body]])
      .filter((rule) => rule === 'ARCH014')

  // A nondeterministic engine still passes every assertion that does not
  // happen to compare two runs, which is why this needs a rule and not a test.
  assert.deepEqual(engine('export const t = () => Date.now()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => new Date().getTime()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => Math.random()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = () => crypto.randomUUID()'), ['ARCH014'])
  assert.deepEqual(engine('export const t = process.env.SEED'), ['ARCH014'])
  assert.deepEqual(
    engine("import { readFileSync } from 'node:fs'"),
    ['ARCH014'],
    'I/O import',
  )
  assert.deepEqual(
    engine("import ky from 'ky'"),
    ['ARCH014'],
    'the production server carries no runtime dependencies',
  )

  // Qualified reads only: a parameter called `now` reads no clock, and the
  // pure corners of Date and the standard library stay available.
  assert.deepEqual(engine('export const t = (now: number) => now + 1'), [])
  assert.deepEqual(engine('export const t = () => Date.UTC(2026, 0, 1)'), [])
  assert.deepEqual(engine("import { isDeepStrictEqual } from 'node:util'"), [])
  assert.deepEqual(engine("import { x } from './types.ts'"), [])

  // `process` is an ordinary word for a handler or a field. Only a qualified
  // read reaches the global, and flagging the rest would demand renaming a
  // domain concept to satisfy a rule about ambient state.
  assert.deepEqual(engine('export interface H { process: boolean }'), [])
  assert.deepEqual(engine('export const h = { process: (x: number) => x }'), [])
  assert.deepEqual(engine('export const f = (process: number) => process + 1'), [])
  assert.deepEqual(engine('export const f = (h: { process: number }) => h.process'), [])
  assert.deepEqual(engine('export const t = () => process.hrtime()'), ['ARCH014'])

  // The rule is scoped to the engine. Everything above it may read a clock,
  // and several modules do.
  assert.deepEqual(
    rules([['server/eval/judge.ts', 'export const t = () => Date.now()']])
      .filter((rule) => rule === 'ARCH014'),
    [],
  )
})

test('prompt builders cannot read ambient state into the cacheable prefix', () => {
  const at = (file: string, body: string) =>
    rules([[file, body]]).filter((rule) => rule === 'ARCH015')

  // The stable prefix is assembled from module constants so provider prompt
  // caches hit. A per-process value baked into it busts the cache for every
  // call of every process and reddens nothing, because no assertion in the
  // suite compares two processes.
  assert.deepEqual(
    at('server/agents/prompts.ts', 'export const t = `s ${Date.now()}`'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/prompts.ts', 'export const t = Math.random()'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/board.ts', 'export const t = process.env.X'),
    ['ARCH015'],
  )
  assert.deepEqual(
    at('server/agents/prompts.ts', "import { readFileSync } from 'node:fs'"),
    ['ARCH015'],
  )

  // The dossier lever is allowed by name, not by file. A second ambient read
  // in the same module is still a violation, so the exception cannot widen
  // into a general exemption.
  assert.deepEqual(
    at(
      'server/agents/facts.ts',
      "export const on = () => process.env.AVALON_NO_DOSSIER !== '1'",
    ),
    [],
    'the documented eval A/B lever',
  )
  assert.deepEqual(
    at('server/agents/facts.ts', 'export const t = () => Date.now()'),
    ['ARCH015'],
    'a second ambient read in the same module',
  )
  assert.deepEqual(
    at('server/agents/facts.ts', 'export const t = process.env.SOME_NEW_FLAG'),
    ['ARCH015'],
    'the allowlist names one variable, not the whole of process.env',
  )

  // Scoped to the builders. The LLM adapter reads its own env lever and is
  // not assembling a cacheable prefix.
  assert.deepEqual(
    at('server/agents/llm.ts', 'export const t = process.env.AVALON_REFLECT_CADENCE'),
    [],
  )
  assert.deepEqual(
    at('server/agents/prompts.ts', "import { isDeepStrictEqual } from 'node:util'"),
    [],
  )
})

test('a shared shape guard cannot be rebound in a nested scope', () => {
  const shadow = (body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import {
        plainDataRecord as plainRecord,
        probability,
      } from '../components/canonical-shape.ts'
      ${body}
    `]])

  // Every binding form that compiles. The named-function parameter is the one
  // a regular expression cannot separate from a wrapped interface field, and
  // the destructured parameter is the one a search for positional parameters
  // misses; both were live in this repository.
  assert.deepEqual(
    shadow('function add(a, probability) { return a + probability }'),
    ['ARCH013'],
    'named function parameter',
  )
  assert.deepEqual(
    shadow('const t = [].reduce((sum, probability) => sum + probability, 0)'),
    ['ARCH013'],
    'arrow parameter',
  )
  assert.deepEqual(
    shadow('const t = [].map(({ probability }) => probability)'),
    ['ARCH013'],
    'destructured parameter',
  )
  assert.deepEqual(
    shadow('function f() { const probability = 1; return probability }'),
    ['ARCH013'],
    'nested local',
  )
  assert.deepEqual(
    shadow('function f() { try { g() } catch (probability) { return 1 } }'),
    ['ARCH013'],
    'catch binding',
  )
  // The rule follows `x as y`: the local name is what a nested scope can hide.
  assert.deepEqual(
    shadow('function f(plainRecord) { return plainRecord }'),
    ['ARCH013'],
    'aliased import, local name shadowed',
  )
  assert.deepEqual(
    shadow('function f(plainDataRecord) { return plainDataRecord }'),
    [],
    'the pre-alias name binds nothing here',
  )

  // Block scope hides an import just as well as function scope, and none of
  // these needs an enclosing function to compile.
  assert.deepEqual(
    shadow('for (const probability of []) { fn(probability) }'),
    ['ARCH013'],
    'module-level for-of binding',
  )
  assert.deepEqual(
    shadow('{ const probability = 1; fn(probability) }'),
    ['ARCH013'],
    'module-level bare block',
  )
  assert.deepEqual(
    shadow('try { fn() } catch (probability) { fn(probability) }'),
    ['ARCH013'],
    'module-level catch binding',
  )
  assert.deepEqual(
    shadow('switch (1) { case 1: { const probability = 1; break } }'),
    ['ARCH013'],
    'module-level case block',
  )

  // A parameter in type space labels an argument, it does not bind a value,
  // so renaming it would satisfy the rule while fixing nothing.
  assert.deepEqual(
    shadow('function f() { type R = (probability: number) => number; fn() }'),
    [],
    'function type parameter inside a function body',
  )
  assert.deepEqual(
    shadow('function f() { interface X { go(probability: number): void } fn() }'),
    [],
    'method signature parameter inside a function body',
  )

  // Renaming the binding away is the fix, and it has to read as clean.
  assert.deepEqual(
    shadow('const t = [].map(({ probability: mass }) => mass)'),
    [],
    'destructuring renamed away',
  )
  assert.deepEqual(
    shadow('function f(mass) { return probability(mass) }'),
    [],
    'guard called, nothing rebound',
  )
})

test('a shared shape guard cannot be re-declared under an affixed name', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { exactKeys, probability } from '../components/canonical-shape.ts'
      ${body}
    `]])

  // The four shapes that were live in this repository. Each is the shared guard
  // under a nearby name, and none of the four modules imported the guard, so the
  // exact-name scan in test/canonical-shape.test.ts saw nothing.
  assert.deepEqual(
    copy('function validProbability(v: unknown): v is number { return !!v }'),
    ['ARCH016'],
    'type predicate',
  )
  assert.deepEqual(
    copy('function finiteProbability(v: unknown): boolean { return !!v }'),
    ['ARCH016'],
    'plain boolean return',
  )
  assert.deepEqual(
    copy(
      'function assertExactKeys(v: unknown): asserts v is Record<string, 1> {}',
    ),
    ['ARCH016'],
    'assertion signature',
  )
  assert.deepEqual(
    copy('const isCanonicalSeatsish = (v: unknown): boolean => !!v'),
    ['ARCH016'],
    'arrow predicate',
  )

  // The two ways to spell the same copy without tripping the checks above: put
  // the return type on the variable rather than the arrow, and continue the
  // guard's name in lowercase instead of starting a new camelCase word.
  assert.deepEqual(
    copy('const validProbability: (v: unknown) => boolean = (v) => !!v'),
    ['ARCH016'],
    'return type annotated on the variable',
  )
  assert.deepEqual(
    copy('function denseArrays(v: unknown): boolean { return !!v }'),
    ['ARCH016'],
    'pluralized guard name',
  )

  // The discriminator is the return type, not the name, because `probability`
  // is a shared guard and an ordinary domain noun at the same time. Every one of
  // these is a real declaration in the tree.
  assert.deepEqual(
    copy('function failProbability(d: readonly number[]): number { return d[0] }'),
    [],
    'numeric domain helper',
  )
  assert.deepEqual(
    copy('function probabilityLabel(p: number): string { return String(p) }'),
    [],
    'string domain helper',
  )
  assert.deepEqual(
    copy('function addProbability(a: { sum: number }, b: number): void {}'),
    [],
    'void domain helper',
  )
  assert.deepEqual(
    copy('function improbableThing(v: unknown): boolean { return !!v }'),
    [],
    'the guard name is not a camelCase component',
  )

  // Importing the guard is the escape hatch, and it has to be, or the wrappers
  // that deliberately sit beside a guard become unexpressible: a labelled throw
  // around exactKeys, and a half-open interval next to the closed one.
  assert.deepEqual(
    importing(`
      function assertExactKeys(v: object, k: readonly string[]): asserts v is object {
        if (!exactKeys(v, k)) throw new Error('no')
      }
    `),
    [],
    'wrapper with the guard in scope',
  )
  assert.deepEqual(
    importing(
      'const positiveProbability = (v: unknown): v is number =>'
        + ' probability(v) && v > 0',
    ),
    [],
    'deliberate neighbour with the guard in scope',
  )

  // A namespace import puts every guard in scope, so it opens the hatch for all
  // of them rather than for none.
  assert.deepEqual(
    rules([['server/agents/analysis/probe.ts', `
      import * as shapes from '../components/canonical-shape.ts'
      const validProbability = (v: unknown): boolean => shapes.probability(v)
    `]]),
    [],
    'namespace import',
  )

  // Module level only: a predicate inside a function body is not a definition a
  // later reader can pick up by mistake, and ARCH013 owns the case where it
  // hides an imported guard.
  assert.deepEqual(
    copy(`
      export function outer(v: unknown): boolean {
        function validProbability(x: unknown): boolean { return !!x }
        return validProbability(v)
      }
    `),
    [],
    'nested predicate',
  )

  // The guard module itself declares the names, so it is not its own offender.
  assert.deepEqual(
    rules([[
      'server/agents/components/canonical-shape.ts',
      'export const plainRecordOrArray = (v: unknown): boolean => !!v',
    ]]),
    [],
    'the guard module is exempt',
  )
})

// The affix arm above reads the guard's own word, so a copy that renames the
// word outright walks straight past it. Two did: `seatArray`, a canonicalSeats
// with the table bound dropped, and `isRecord`, a plainRecord with the proxy
// and prototype checks dropped. Both lived in modules that already imported
// some other guard from the shared module, so the import hatch did not cover
// them either.
test('a shared shape guard cannot be re-declared under a known synonym', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (guard: string, body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { ${guard} } from '../components/canonical-shape.ts'
      ${body}
    `]])

  assert.deepEqual(
    copy('function isRecord(v: unknown): v is Record<string, 1> { return !!v }'),
    ['ARCH016'],
    'the record synonym',
  )
  assert.deepEqual(
    copy('const seatArray = (v: unknown): boolean => Array.isArray(v)'),
    ['ARCH016'],
    'the seat-list synonym',
  )

  // Same escape hatch, and still per guard: importing the record guard clears
  // the record synonym and leaves the seat one reported.
  assert.deepEqual(
    importing(
      'plainRecord',
      'function isRecord(v: unknown): boolean { return plainRecord(v) }',
    ),
    [],
    'wrapper with the record guard in scope',
  )
  assert.deepEqual(
    importing(
      'plainDataRecord',
      'function isRecord(v: unknown): boolean { return plainDataRecord(v) }',
    ),
    [],
    'either record guard opens the hatch for the record synonym',
  )
  assert.deepEqual(
    importing(
      'plainRecord',
      'const seatArray = (v: unknown): boolean => plainRecord(v)',
    ),
    ['ARCH016'],
    'a different guard does not open the hatch',
  )

  // Whole names only. An affix on top of a synonym is a much weaker signal, and
  // language-contract's validSeatArray is the live counterexample: a bounded
  // seat set in the order the host stored it, which is a deliberate neighbour
  // of canonicalSeats rather than a copy of it, because the engine keeps a team
  // in whatever order its leader supplied.
  assert.deepEqual(
    copy('function validSeatArray(v: unknown, n: number): boolean { return !!v }'),
    [],
    'an affixed synonym is not the synonym',
  )
  // The return type still decides, exactly as it does for the affix arm.
  assert.deepEqual(
    copy('function seatArray(v: readonly number[]): string { return v.join() }'),
    [],
    'a non-predicate of the same name',
  )
})

// ARCH016 reads return types, so a helper returning a number never entered its
// set, and that documented exclusion is where the duplication went: 83 raw
// tolerance literals, six copies of the unit clamp, four private `close`
// comparators. ARCH017 is the numeric collector.
test('a shared numeric helper cannot be re-declared privately', () => {
  const copy = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])
  const importing = (helper: string, body: string) =>
    rules([['server/agents/analysis/probe.ts', `
      import { ${helper} } from '../components/probability-arithmetic.ts'
      ${body}
    `]])

  // The affix arm, mirroring ARCH016's.
  assert.deepEqual(
    copy('function safeClampProbability(v: number): number { return v }'),
    ['ARCH017'],
    'affixed clamp',
  )
  assert.deepEqual(
    copy('const publicLatticeCount = (v: number): number | undefined => 1'),
    ['ARCH017'],
    'affixed lattice count, returning number or undefined',
  )
  // A boolean-returning copy is collected too. The owner module holds one
  // comparator, and a private copy of a tolerance comparator is the exact
  // defect this rule exists for. Any affix of `closeProbability` also embeds
  // the shared `probability` guard, so the two rules overlap here by
  // construction and both report; that is honest rather than a miscount,
  // because the module has neither name in scope.
  assert.deepEqual(
    copy('const isCloseProbability = (a: number, b: number): boolean => a === b'),
    ['ARCH016', 'ARCH017'],
    'affixed comparator',
  )

  // The synonym arm. All four of these were live in this repository.
  assert.deepEqual(
    copy('const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))'),
    ['ARCH017'],
    'the unit-clamp synonym',
  )
  assert.deepEqual(
    copy('const close = (a: number, b: number): boolean => Math.abs(a - b) < 1'),
    ['ARCH017'],
    'the comparator synonym',
  )

  // Same escape hatch as ARCH016, and still per helper.
  assert.deepEqual(
    importing(
      'clampProbability',
      'const clamp01 = (v: number): number => clampProbability(v)',
    ),
    [],
    'wrapper with the clamp in scope',
  )
  assert.deepEqual(
    importing(
      'clampProbability',
      'const close = (a: number, b: number): boolean => a === b',
    ),
    ['ARCH017'],
    'a different helper does not open the hatch',
  )
  assert.deepEqual(
    rules([['server/agents/analysis/probe.ts', `
      import * as arithmetic from '../components/probability-arithmetic.ts'
      const clamp01 = (v: number): number => arithmetic.clampProbability(v)
    `]]),
    [],
    'namespace import opens the hatch for every helper',
  )

  // Neither a number nor a boolean, so it is not a copy of anything here.
  assert.deepEqual(
    copy('const clamp01 = (v: number): string => String(v)'),
    [],
    'the return type still decides',
  )
  // Module level only, as with ARCH016.
  assert.deepEqual(
    copy(`
      export function outer(v: number): number {
        const clamp01 = (x: number): number => x
        return clamp01(v)
      }
    `),
    [],
    'nested helper',
  )
  // The owner module declares the names, so it is not its own offender.
  assert.deepEqual(
    rules([[
      'server/agents/components/probability-arithmetic.ts',
      'export const clampProbabilityTwice = (v: number): number => v',
    ]]),
    [],
    'the arithmetic module is exempt',
  )
})

// The arm that would have caught the finding on the first file rather than the
// fourteenth. A name-based rule can only find a magnitude somebody named, and
// none of the 83 were named.
test('a bare tolerance literal in the agent tree has no owner', () => {
  const agent = (body: string) =>
    rules([['server/agents/analysis/probe.ts', body]])

  assert.deepEqual(agent('const t = 1e-12'), ['ARCH017'])
  assert.deepEqual(agent('const t = 1e-9'), ['ARCH017'])
  assert.deepEqual(agent('const t = 1e-15'), ['ARCH017'])
  // A future regime nobody has thought of yet is caught the day it is written,
  // which is what picking a ceiling buys over listing the known values.
  assert.deepEqual(agent('const t = 1e-10'), ['ARCH017'])
  assert.deepEqual(
    agent('const near = (a: number, b: number) => Math.abs(a - b) <= 0.0000001'),
    ['ARCH017'],
    'decimal spelling counts too',
  )
  assert.deepEqual(
    agent('const t = 5e-7\nconst u = 5e-8'),
    ['ARCH017', 'ARCH017'],
    'one violation per literal',
  )

  // The band constants and every other deliberate magnitude in the tree sit
  // orders of magnitude above the ceiling, so the separator is clean.
  assert.deepEqual(agent('const band = 0.04'), [])
  assert.deepEqual(agent('const cap = 3_628_800'), [])
  assert.deepEqual(agent('const zero = 0'), [])
  assert.deepEqual(agent('const half = 0.5'), [])

  // Scoped to the probabilistic agent tree. The engine has no probabilities,
  // and server/eval/ is an offline calibration layer with its own numerics.
  assert.deepEqual(rules([['server/engine/probe.ts', 'const t = 1e-12']]), [])
  assert.deepEqual(rules([['server/eval/probe.ts', 'const t = 1e-15']]), [])
  // The owner module is where the magnitudes live.
  assert.deepEqual(
    rules([[
      'server/agents/components/probability-arithmetic.ts',
      'export const PROBABILITY_TOLERANCE = 1e-12',
    ]]),
    [],
  )
})

test('TypeScript AST recognizes multiline imports and export-from declarations', () => {
  const inspected = inspectSource('server/agents/example.ts', `
    import type {
      Game as RawGame,
      PlayerView,
    } from "../../engine/types.ts"
    export {
      toArtifact,
    } from "../../eval/artifact.ts"
  `)

  assert.deepEqual(inspected.edges, [
    {
      kind: 'import',
      specifier: '../../engine/types.ts',
      names: ['Game', 'PlayerView'],
      namespace: false,
      locals: ['RawGame', 'PlayerView'],
      line: 2,
    },
    {
      kind: 'export',
      specifier: '../../eval/artifact.ts',
      names: ['toArtifact'],
      namespace: false,
      locals: [],
      line: 6,
    },
  ])
})

test('TypeScript AST ignores lexical decoys and regex contents', () => {
  const source = `
    // import { Game } from "../../engine/types.ts"
    /* export * from "../../eval/artifact.ts" */
    const first = 'import { Game } from "../../engine/types.ts"'
    const second = \`export * from "../../eval/architecture-report.ts"\`
    const detector = (value: string) =>
      /import { Game } from "..\\/..\\/engine\\/types.ts"/.test(value)
    export const safe = first + second
  `
  assert.deepEqual(
    auditArchitectureSources([['server/agents/policy/safe.ts', source]]),
    [],
  )
})

test('dynamic imports remain governed, including template expressions', () => {
  const violations = auditArchitectureSources([
    [
      'server/engine/lazy.ts',
      'const agent = await import("../agents/composed.ts")',
    ],
    [
      'server/agents/lazy.ts',
      'const report = `${await import("../eval/architecture-report.ts")}`',
    ],
    [
      'server/agents/lazy-game.ts',
      'type Raw = import("../engine/types.ts").Game',
    ],
    [
      'server/agents/lazy-game-namespace.ts',
      `const ns = await import("../engine/types.ts")
       const raw: ns.Game = value`,
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer, specifier }) => [
      rule,
      importer,
      specifier,
    ]),
    [
      ['ARCH001', 'server/engine/lazy.ts', '../agents/composed.ts'],
      [
        'ARCH002',
        'server/agents/lazy.ts',
        '../eval/architecture-report.ts',
      ],
      ['ARCH002', 'server/agents/lazy-game.ts', '../engine/types.ts'],
      [
        'ARCH002',
        'server/agents/lazy-game-namespace.ts',
        '../engine/types.ts',
      ],
    ],
  )
})

test('non-literal dynamic imports fail closed', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/variable.ts',
      'const moduleValue = await import(modulePath)',
    ],
    [
      'server/engine/template.ts',
      'const moduleValue = await import(`../agents/${name}.ts`)',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH000', 'server/agents/variable.ts'],
      ['ARCH000', 'server/engine/template.ts'],
    ],
  )
  assert.match(violations[0].message, /dynamic import target must be a string literal/)
  assert.match(violations[1].message, /dynamic import target must be a string literal/)
})

test('path normalization closes Windows and POSIX dependency bypasses', () => {
  const violations = auditArchitectureSources([
    [
      'server\\engine\\nested\\rules.ts',
      'import { decide } from "..\\\\..\\\\agents\\\\heuristic.ts"',
    ],
    [
      'server/agents/policy/../policy/score.ts',
      'export * from "../../eval/artifact.ts"',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH001', 'server/engine/nested/rules.ts'],
      ['ARCH003', 'server/agents/policy/score.ts'],
    ],
  )
})

test('engine cannot import or re-export agent and evaluation modules', () => {
  assert.deepEqual(
    rules([
      [
        'server/engine/one.ts',
        'import { decide } from "../agents/heuristic.ts"',
      ],
      [
        'server/engine/two.ts',
        'export * from "../eval/artifact.ts"',
      ],
    ]),
    ['ARCH001', 'ARCH001'],
  )
})

test('runtime agents cannot depend on evaluation code', () => {
  const violations = auditArchitectureSources([
    [
      'server/agents/analysis/one.ts',
      'import { score } from "../../eval/metrics.ts"',
    ],
  ])
  assert.equal(violations.length, 1)
  assert.equal(violations[0].rule, 'ARCH002')
  assert.match(violations[0].message, /one\.ts:1 -> \.\.\/\.\.\/eval\/metrics/)
})

test('runtime agents reject raw Game while allowing narrow domain types', () => {
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/allowed.ts',
        `import type {
          DecisionRequest,
          GameEvent,
          PlayerView,
          Role,
          Seat,
        } from "../engine/types.ts"`,
      ],
      [
        'server/agents/safe-rules.ts',
        'import * as rules from "../engine/rules.ts"',
      ],
    ]),
    [],
  )

  assert.deepEqual(
    rules([
      [
        'server/agents/named.ts',
        'import type { Game as Raw } from "../engine/types.ts"',
      ],
      [
        'server/agents/namespace.ts',
        'import type * as EngineTypes from "../engine/types.ts"',
      ],
      [
        'server/agents/type-expression.ts',
        'type Raw = import("../engine/types.ts").Game',
      ],
      [
        'server/agents/barrel.ts',
        'import type { Game as Raw } from "../shared/engine-barrel.ts"',
      ],
      [
        'server/agents/constructor.ts',
        'import { createGame } from "../engine/game.ts"',
      ],
      [
        'server/agents/view-bypass.ts',
        'export { viewFor } from "../engine/view.ts"',
      ],
    ]),
    [
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
      'ARCH002',
    ],
  )
})

test('generic policies and components cannot import artifact/report shapes', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/scorer.ts',
        'import type { GameArtifact } from "../../eval/barrel.ts"',
      ],
      [
        'server/agents/components/projector.ts',
        'export { architectureReport } from "../../eval/architecture-report.ts"',
      ],
    ]),
    ['ARCH003', 'ARCH003'],
  )
})

test('generic score-layer kernel cannot grow role-specific dependencies or branches', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/score-layer/role-import.ts',
        'import { utility } from "../../analysis/morgana-role-utility.ts"',
      ],
      [
        'server/agents/policy/score-layer/token-import.ts',
        'import { TOKEN } from "../../components/native-role-components.ts"',
      ],
      [
        'server/agents/policy/score-layer/role-branch.ts',
        'const selected = view.role === "merlin"',
      ],
      [
        'server/agents/policy/score-layer/role-name.ts',
        'function applyMorganaRolePolicy() {}',
      ],
      [
        'server/agents/policy/score-layer/lower-morgana.ts',
        'const morganaUtility = 1',
      ],
      [
        'server/agents/policy/score-layer/lower-evil.ts',
        'const evilRolePolicy = 1',
      ],
      [
        'server/agents/policy/score-layer/lower-merlin.ts',
        'const merlinScore = 1',
      ],
      [
        'server/agents/policy/score-layer/legacy-score-import.ts',
        'import { scoreCandidates } from "../score.ts"',
      ],
      [
        'server/agents/policy/score-layer/legacy-wrapper-import.ts',
        'import { withLegacyScoring } from "../legacy-scoring.ts"',
      ],
    ]),
    [
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
      'ARCH005',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/score-layers/morgana.ts',
        'import type { ScoreLayerDefinition } from "../policy/score-layer/types.ts"',
      ],
      [
        'server/agents/policy/score-layer/types.ts',
        'import type { SituationAnalysis } from "../../analysis/types.ts"',
      ],
    ]),
    [],
  )
})

test('generic decision-layer kernel cannot grow role or observability coupling', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/decision-layer/role-import.ts',
        'import { utility } from "../../analysis/morgana-role-utility.ts"',
      ],
      [
        'server/agents/policy/decision-layer/token-import.ts',
        'import { TOKEN } from "../../components/native-role-components.ts"',
      ],
      [
        'server/agents/policy/decision-layer/concrete-import.ts',
        'import { POLICY } from "../../decision-layers/evil-quest-card.ts"',
      ],
      [
        'server/agents/policy/decision-layer/trace-import.ts',
        'import type { DecisionTrace } from "../../trace.ts"',
      ],
      [
        'server/agents/policy/decision-layer/role-branch.ts',
        'const selected = view.role === "merlin"',
      ],
      [
        'server/agents/policy/decision-layer/role-name.ts',
        'function applyMorganaRolePolicy() {}',
      ],
      [
        'server/agents/policy/decision-layer/admission-replay.ts',
        'import { canonicalizeJson } from "../../components/canonical-json.ts"',
      ],
      [
        'server/agents/composed.ts',
        'import { createPolicyComponentRuntime } from "./policy/component-runtime.ts"',
      ],
    ]),
    Array(8).fill('ARCH011'),
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/decision-frame.ts',
        'import { runDecisionLayers } from "./decision-layer/runner.ts"',
      ],
      [
        'server/agents/policy/decision-layer/admission-replay.ts',
        'import { runDecisionLayers } from "./runner.ts"',
      ],
      [
        'server/agents/admission/composed-trace.ts',
        'import { replayDecisionLayersForAdmission } from "../policy/decision-layer/admission-replay.ts"',
      ],
      [
        'server/agents/decision-layers/configured.ts',
        'import type { DecisionLayerDefinition } from "../policy/decision-layer/types.ts"',
      ],
      [
        'server/agents/policy/decision-layer/runner.ts',
        'import { createPolicyComponentRuntime } from "../component-runtime.ts"',
      ],
      [
        'server/agents/policy/score-layer/components.ts',
        'import { createPolicyComponentRuntime } from "../component-runtime.ts"',
      ],
    ]),
    [],
  )
})

test('shared layer registry skeleton stays confined and role-blind', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed.ts',
        'import { layerToken } from "./policy/layer-registry-common.ts"',
      ],
      [
        'server/agents/policy/types.ts',
        'import { layerToken } from "./layer-registry-common.ts"',
      ],
      [
        'server/agents/score-layers/good.ts',
        'import { indexLayerDefinitions } from "../policy/layer-registry-common.ts"',
      ],
      [
        // One source: the audit refuses a repeated path, and this file is the
        // only one the shared role scope matches.
        'server/agents/policy/layer-registry-common.ts',
        'function applyMorganaRolePolicy() { return "merlin" }',
      ],
    ]),
    Array(5).fill('ARCH011'),
  )
  // Both layer families, the component registry, and the trace writers are the
  // legitimate consumers.
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/score-layer/registry.ts',
        'import { indexLayerDefinitions } from "../layer-registry-common.ts"',
      ],
      [
        'server/agents/policy/decision-layer/types.ts',
        'import { layerToken } from "../layer-registry-common.ts"',
      ],
      [
        'server/agents/components/registry.ts',
        'import { assertLayerRef } from "../policy/layer-registry-common.ts"',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'import { projectLayerRun } from "./layer-registry-common.ts"',
      ],
      [
        'server/agents/trace-builder.ts',
        'import { projectLayerRun } from "./policy/layer-registry-common.ts"',
      ],
    ]),
    [],
  )
})

test('concrete score families stay separate from observability and composition IDs', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/score-layers/trace-coupled.ts',
        'import type { DecisionTrace } from "../trace.ts"',
      ],
      [
        'server/agents/score-layers/report-coupled.ts',
        'import { architectureReport } from "../../eval/architecture-report.ts"',
      ],
      [
        'server/agents/score-layers/transport-coupled.ts',
        'import { parseExternalDecisionReply } from "../external-reply.ts"',
      ],
      [
        'server/agents/score-layers/legacy-row.ts',
        'import type { CandidateScore } from "../policy/types.ts"',
      ],
      [
        'server/agents/score-layers/legacy-namespace.ts',
        `import type * as Legacy from "../policy/types.ts"
         type Row = Legacy.CandidateScore`,
      ],
      [
        'server/agents/composed.ts',
        `const proposal = "good-proposal-analysis"
         const vote = "good-vote-analysis"`,
      ],
    ]),
    [
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
    ],
  )
})

test('configured score seam exclusively aggregates concrete families', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed.ts',
        'import { createGoodScoreLayerRegistry } from "./score-layers/good.ts"',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'import { family as selected } from "../score-layers/good.ts"',
      ],
      [
        'server/agents/components/family.ts',
        'import * as family from "../score-layers/good.ts"',
      ],
      [
        'server/agents/policy/family.ts',
        'export { family } from "../score-layers/good.ts"',
      ],
      [
        'server/agents/composed-dynamic.ts',
        'const family = await import("./score-layers/good.ts")',
      ],
      [
        'server/agents/composed-require.ts',
        'const family = require("./score-layers/good.ts")',
      ],
      [
        'server/agents/score-layers/evil.ts',
        'import { GOOD } from "./good.ts"',
      ],
      [
        'server/agents/score-layers/good.ts',
        'export * from "./configured.ts"',
      ],
    ]),
    [
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
      'ARCH007',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/score-layers/configured.ts',
        `import { GOOD } from "./good.ts"
         import * as equality from "./legacy-equality.ts"`,
      ],
      [
        'server/agents/composed.ts',
        'import { registry } from "./score-layers/configured.ts"',
      ],
    ]),
    [],
  )
})

test('native score-layer preparation and execution stay locally owned', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/composed.ts',
        'import { executePreparedScoreLayerRun } from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-namespace.ts',
        'import * as runner from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-alias.ts',
        'import { executePreparedScoreLayerRun as run } from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-default.ts',
        'import runner from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/composed-dynamic.ts',
        'const runner = await import("./policy/score-layer/runner.ts")',
      ],
      [
        'server/agents/composed-require.ts',
        'const runner = require("./policy/score-layer/runner.ts")',
      ],
      [
        'server/agents/composed-export.ts',
        'export * from "./policy/score-layer/runner.ts"',
      ],
      [
        'server/agents/policy/score-layer/preparation.ts',
        'const PROVENANCE = new WeakMap<object, object>()',
      ],
    ]),
    [
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
      'ARCH006',
    ],
  )
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/policy/decision-frame.ts',
        'import { executePreparedScoreLayerRun, prepareScoreLayerRunLease } from "./score-layer/runner.ts"',
      ],
      [
        'server/agents/policy/score-layer/admission-replay.ts',
        'import { executePreparedScoreLayerRun } from "./runner.ts"',
      ],
      [
        'server/agents/admission/composed-trace.ts',
        'import { replayNativeScoresForAdmission } from "../policy/score-layer/admission-replay.ts"',
      ],
    ]),
    [],
  )
})

test('score admission replay uses only the configured family catalog', () => {
  assert.deepEqual(
    rules([
      [
        'server/agents/policy/score-layer/admission-replay.ts',
        `import { GOOD_ROLE_SCORE_LAYER } from "../../score-layers/good.ts"
         import * as evil from "../../score-layers/evil.ts"`,
      ],
    ]),
    ['ARCH007', 'ARCH007'],
  )
  assert.deepEqual(
    auditArchitectureSources([[
      'server/agents/admission/composed-trace.ts',
      'import { configuredScoreLayerChainForVersion } from "../score-layers/configured.ts"',
    ]]),
    [],
  )
})

test('trusted provider capabilities remain inside composition and kernel', () => {
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/components/kernel.ts',
        'export interface DecisionComponentTrustedHostInputProviders {}',
      ],
      [
        'server/agents/policy/decision-frame.ts',
        'const roots: DecisionComponentTrustedHostInputProviders = factory(frame)',
      ],
    ]),
    [],
  )

  const violations = auditArchitectureSources([
    [
      'server/agents/composed.ts',
      'const value: DecisionComponentTrustedHostInputProvider<unknown> = root',
    ],
    [
      'server/agents/external-reply.ts',
      'import type { DecisionComponentTrustedHostInputProvider } from "./components/kernel.ts"',
    ],
    [
      'server/agents/trace.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/eval/artifact.ts',
      'const hidden: DecisionComponentTrustedHostInputProviders = value',
    ],
    [
      'server/eval/architecture-report.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/server.ts',
      'runDecisionComponents(brain, request, view, invocation, trusted)',
    ],
    [
      'server/agents/analysis/new-owner.ts',
      'runDecisionComponents(brain, request, view)',
    ],
    [
      'server/agents/analysis/namespace-bypass.ts',
      `import * as kernel from "../components/kernel.ts"
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
    [
      'server/agents/analysis/dynamic-namespace-bypass.ts',
      `const kernel = await import("../components/kernel.ts")
       kernel["runDecisionComponents"](brain, request, view, invocation, trusted)`,
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule, importer }) => [rule, importer]),
    [
      ['ARCH004', 'server/agents/composed.ts'],
      ['ARCH004', 'server/agents/external-reply.ts'],
      ['ARCH004', 'server/agents/trace.ts'],
      ['ARCH004', 'server/eval/artifact.ts'],
      ['ARCH004', 'server/eval/architecture-report.ts'],
      ['ARCH004', 'server/server.ts'],
      ['ARCH004', 'server/agents/analysis/new-owner.ts'],
      ['ARCH004', 'server/agents/analysis/namespace-bypass.ts'],
      ['ARCH004', 'server/agents/analysis/dynamic-namespace-bypass.ts'],
    ],
  )
})

test('audit fails closed on unreadable, duplicate, and malformed sources', () => {
  const violations = auditArchitectureSources([
    ['server/agents/unreadable.ts', undefined],
    ['server\\agents\\same.ts', 'export const first = true'],
    ['server/agents/same.ts', 'export const second = true'],
    ['server/engine/broken.ts', 'import { nope }'],
    ['server/agents/not-source.txt', 'export const ignored = false'],
    ['client/escaped.ts', 'export const ignored = false'],
    [
      'server/engine/escaped-import.ts',
      'import "../../../outside.ts"',
    ],
  ])

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
      'ARCH000',
    ],
  )
  assert.match(violations[0].message, /could not be read/)
  assert.match(violations[1].message, /duplicate normalized source path/)
  assert.match(violations[2].message, /could not be parsed/)
  assert.match(violations[3].message, /unsupported extension/)
  assert.match(violations[4].message, /outside the governed server tree/)
  assert.match(violations[5].message, /module target escapes the repository/)
})

// ARCH018. The repository already fails the build on dead declarations, but
// that check reports unused locals inside test roots, so an exported
// production helper a test imports reads as live whatever production does.
// assertProbability sat in that hole until it was found by reading.
test('a production export reached only from the suite is reported', () => {
  const audit = (
    server: [string, string][],
    tests: [string, string][],
  ): string[] =>
    (architectureModule as unknown as {
      auditTestOnlyProductionExports: (
        s: [string, string][],
        t: [string, string][],
      ) => readonly { rule: string }[]
    }).auditTestOnlyProductionExports(server, tests).map((item) => item.rule)

  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'export const onlyTested = 1']],
      [['test/probe.test.ts', 'const seen = onlyTested']],
    ),
    ['ARCH018'],
    'a value export whose sole consumer is a test',
  )
  assert.deepEqual(
    audit(
      [
        ['server/agents/probe.ts', 'export const shared = 1'],
        ['server/agents/other.ts', 'const seen = shared'],
      ],
      [['test/probe.test.ts', 'const alsoSeen = shared']],
    ),
    [],
    'a production consumer anywhere clears it',
  )
  // Same-file use is production use. A version constant referenced once inside
  // its own module is live, and missing this is what made an earlier census
  // report 126 instead of 22.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', [
        'export const VERSION = "v1"',
        'export const build = (): string => VERSION',
      ].join('\n')]],
      [['test/probe.test.ts', 'const seen = VERSION']],
    ),
    [],
    'a constant used inside its own module is not test-only',
  )
  // Nothing references it at all, which is the dead-declaration check's job.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', 'export const orphan = 1']],
      [['test/probe.test.ts', 'const unrelated = 1']],
    ),
    [],
    'an export with no consumer at all is a different rule',
  )
  // Types and classes are out of scope: a type is consumed in type position,
  // and a class can be thrown in production while only the test names it.
  assert.deepEqual(
    audit(
      [['server/agents/probe.ts', [
        'export interface Shape { a: number }',
        'export class Failure extends Error {}',
      ].join('\n')]],
      [['test/probe.test.ts', 'const s: Shape = { a: 1 }; throw new Failure()']],
    ),
    [],
    'type and class exports are deliberately not collected',
  )
})
