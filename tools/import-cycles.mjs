// Import-cycle guard. The module graph across the codebase must stay a DAG:
// a file may not, directly or through a chain of imports, depend on itself.
//
// Why enforce this even though TypeScript compiles `import type` cycles without
// complaint? Two reasons. A value-import cycle is a real runtime hazard
// (module-initialization order and temporal-dead-zone bugs that no assertion
// reliably catches). A type-only cycle is benign at runtime but is a design
// smell: it means two "layers" actually reference each other, so neither is
// below the other, and the layering the rest of the architecture relies on
// stops being a true order. Rejecting both keeps the dependency graph legible
// and keeps the cheaper value-cycle hazard impossible as a side effect.
//
// The parser is the TypeScript compiler, so multi-line imports, re-exports
// (`export ... from`), `import type`, and `import =` are all seen exactly as tsc
// sees them. Only first-party edges count: bare specifiers (node builtins, npm
// packages) are ignored, since they cannot close a cycle back into this
// repository.
//
// Dynamic `import()` is deliberately NOT counted. It resolves at call time,
// after every module in the graph has finished initializing, so it cannot form
// an initialization cycle, and it is the sanctioned escape hatch for referring
// to a module that statically imports you back (a CLI that lazy-loads its own
// heavier UI, for instance). Counting it would forbid the very tool used to
// break a cycle.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
// The roots whose internal graph must stay acyclic. The server is the tree that
// grew the cycles this guard was written to retire; the client is a small,
// already-acyclic tree kept honest at the same time.
const ROOTS = Object.freeze(['server', 'client/src'])

function scriptKind(sourcePath) {
  if (sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')) {
    return ts.ScriptKind.TSX
  }
  if (
    sourcePath.endsWith('.js')
    || sourcePath.endsWith('.cjs')
    || sourcePath.endsWith('.mjs')
  ) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

function collectSources(root, roots = ROOTS) {
  const files = []
  const pending = roots.map((relative) => path.join(root, relative))
  while (pending.length) {
    const directory = pending.pop()
    let children
    try {
      children = readdirSync(directory, { withFileTypes: true })
    } catch {
      // A configured root that does not exist (a partial checkout) is skipped
      // rather than failed: the guard still holds over whatever is present.
      continue
    }
    for (const child of children) {
      const absolute = path.join(directory, child.name)
      if (child.isDirectory()) {
        if (child.name === 'node_modules' || child.name === 'dist') continue
        pending.push(absolute)
      } else if (child.isFile() && SOURCE_EXTENSION.test(child.name)) {
        files.push(absolute)
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

/** Every module specifier a source names, however it names it. */
function importSpecifiers(sourcePath, source) {
  const ast = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(sourcePath),
  )
  const specifiers = []
  const literal = (node) =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
    ) {
      const value = literal(node.moduleSpecifier)
      if (value !== undefined) specifiers.push(value)
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      const value = literal(node.moduleReference.expression)
      if (value !== undefined) specifiers.push(value)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const value = literal(node.argument.literal)
      if (value !== undefined) specifiers.push(value)
    }
    // Dynamic `import()` is intentionally not collected; see the file header.
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return specifiers
}

/**
 * Resolve a relative specifier to a first-party file, mirroring the Node/tsc
 * lookup this repo relies on: explicit extensions win, then the usual TS/JS
 * extensions, then an index file. Bare specifiers resolve to undefined and are
 * dropped, since they can never close a first-party cycle.
 */
function resolveSpecifier(fromFile, specifier, fileSet) {
  if (!specifier.startsWith('.')) return undefined
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = []
  if (SOURCE_EXTENSION.test(base)) {
    candidates.push(base)
    // A `.js`/`.mjs` specifier is how this repo spells its `.ts`/`.mts` imports.
    candidates.push(base.replace(/\.js$/, '.ts'))
    candidates.push(base.replace(/\.jsx$/, '.tsx'))
    candidates.push(base.replace(/\.mjs$/, '.mts'))
  } else {
    for (const extension of ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']) {
      candidates.push(base + extension)
    }
    for (const index of ['index.ts', 'index.tsx', 'index.js']) {
      candidates.push(path.join(base, index))
    }
  }
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate)
    if (fileSet.has(normalized)) return normalized
  }
  return undefined
}

/** The first-party import graph: file -> set of files it depends on. */
export function buildImportGraph(root = process.cwd(), roots = ROOTS) {
  const files = collectSources(root, roots)
  const fileSet = new Set(files.map((file) => path.normalize(file)))
  const graph = new Map()
  for (const file of files) {
    const normalized = path.normalize(file)
    const dependencies = new Set()
    for (const specifier of importSpecifiers(file, readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(normalized, specifier, fileSet)
      if (target && target !== normalized) dependencies.add(target)
    }
    graph.set(normalized, dependencies)
  }
  return graph
}

/**
 * Tarjan's strongly-connected-components, iterative so a deep import chain
 * cannot overflow the call stack. Every returned component with more than one
 * member (or a self-loop) is a dependency cycle.
 */
export function findCycles(graph) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const cycles = []
  let counter = 0

  for (const start of graph.keys()) {
    if (index.has(start)) continue
    const work = [{ node: start, iterator: (graph.get(start) ?? new Set()).values() }]
    index.set(start, counter)
    low.set(start, counter)
    counter++
    stack.push(start)
    onStack.add(start)
    while (work.length) {
      const frame = work[work.length - 1]
      const step = frame.iterator.next()
      if (!step.done) {
        const next = step.value
        if (!index.has(next)) {
          index.set(next, counter)
          low.set(next, counter)
          counter++
          stack.push(next)
          onStack.add(next)
          work.push({ node: next, iterator: (graph.get(next) ?? new Set()).values() })
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(next)))
        }
        continue
      }
      work.pop()
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.node)
        const selfLoop = (graph.get(frame.node) ?? new Set()).has(frame.node)
        if (component.length > 1 || selfLoop) cycles.push(component)
      }
      if (work.length) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)))
      }
    }
  }
  return cycles
}

export function checkImportCycles(root = process.cwd(), roots = ROOTS) {
  return findCycles(buildImportGraph(root, roots))
}

function reportCycle(root, graph, component) {
  const rel = (file) => path.relative(root, file).replaceAll('\\', '/')
  const members = new Set(component)
  const lines = [`cycle across ${component.length} files:`]
  for (const file of [...component].sort()) {
    const internal = [...(graph.get(file) ?? new Set())]
      .filter((target) => members.has(target))
      .map(rel)
      .sort()
    lines.push(`  ${rel(file)} -> ${internal.join(', ')}`)
  }
  return lines.join('\n')
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const root = process.cwd()
  const graph = buildImportGraph(root)
  const cycles = findCycles(graph)
  if (cycles.length) {
    console.error(
      `import-cycles: ${cycles.length} circular dependency `
        + `group${cycles.length === 1 ? '' : 's'} found`,
    )
    for (const cycle of cycles) console.error(reportCycle(root, graph, cycle))
    process.exitCode = 1
  } else {
    console.log('import-cycles: dependency graph is acyclic')
  }
}
