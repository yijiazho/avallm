import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditArchitectureSources,
  checkRepositoryArchitecture,
  inspectSource,
} from '../tools/architecture-fitness.mjs'

function rules(sources: ReadonlyArray<readonly [string, unknown]>): string[] {
  return auditArchitectureSources(sources).map((violation) => violation.rule)
}

test('repository sources satisfy the coarse architecture fitness rules', () => {
  assert.deepEqual(checkRepositoryArchitecture(), [])
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
      line: 2,
    },
    {
      kind: 'export',
      specifier: '../../eval/artifact.ts',
      names: ['toArtifact'],
      namespace: false,
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

test('trusted provider capabilities remain inside composition and kernel', () => {
  assert.deepEqual(
    auditArchitectureSources([
      [
        'server/agents/composed.ts',
        'const value: DecisionComponentTrustedHostInputProvider<unknown> = root',
      ],
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
      'server/agents/stdio.ts',
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
      ['ARCH004', 'server/agents/stdio.ts'],
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
