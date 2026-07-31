// One owner for "where the repository root is", for the tests that read source
// files rather than importing them.
//
// A test that scans the tree carries the path to the root TWICE: once in its
// import specifiers, which TypeScript checks, and once in a string handed to
// readFileSync or readdirSync, which nothing checks. The two disagree the
// moment the test moves, and the failure is not a compile error. It is a scan
// that quietly finds nothing, or an ENOENT far from the cause.
//
// That happened three times while this tree was being reorganized: a curated
// directory scan that resolved to a folder which no longer existed, a set of
// path.join segment lists that no specifier rewrite could see, and these
// template literals. Each was one more place the depth was restated. Stating it
// once here means a test can move between directories and only its imports have
// to be right, which is the half a typechecker can enforce.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** This file is test/support/repo-root.ts, so the root is two levels up. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** An absolute path to a repo-relative location, for the node:fs path API. */
export function repoPath(...segments: readonly string[]): string {
  return path.join(ROOT, ...segments)
}

/** The same, as a file URL, for the readers that take one. */
export function repoUrl(relative: string): URL {
  return new URL(`file://${repoPath(relative).replaceAll('\\', '/')}`)
}
