// Hotspot triage: ranks source files by how likely they are to reward a closer
// look, so a human (or a review subagent) reads the worst offenders instead of
// sweeping everything uniformly. It is a *trigger*, not a verdict: a high score
// means "someone should look", never "this is broken".
//
//   node tools/hotspots.mjs                 # ranked table, top 25
//   node tools/hotspots.mjs --top 40        # deeper cut
//   node tools/hotspots.mjs --window 300    # churn over last N commits (default 200)
//   node tools/hotspots.mjs --json          # machine-readable, for a subagent fan-out
//   node tools/hotspots.mjs --min 20        # only files scoring >= 20
//
// The composite score blends signals that are cheap to compute and that, in this
// repo, actually track sloppiness (see the greps that motivated it):
//
//   churn x size   the headline. A big file touched often is where confusion and
//                  bugs concentrate. log-scaled so one 4k-line god-file does not
//                  drown everything else, but still dominates.
//   max function   the longest brace-balanced function body (lines). Finds the
//                  tangle *inside* a big file better than raw LOC.
//   nesting depth  deepest brace nesting. Deep nesting is where logic hides.
//   churn x fan-in an interface still moving while many modules import it: an
//                  unstable chokepoint, worse than either signal alone.
//   markers        as-any / ts-ignore / TODO|FIXME|HACK / .skip|.only. Near-zero
//                  in this repo today, so weighted light; kept so it lights up if
//                  that ever changes.
//   name flag      legacy/compat/adapter/shim/v1/v2/deprecated in the path: a
//                  migration that added the new thing but never deleted the old.
//
// Two repo-level sections follow the table because they are about the *set*, not
// any one file: near-duplicate filenames (split concepts, e.g. `x-score` vs
// `score-x`) and concept fan-out (one idea smeared across many files/dirs).
//
// Zero dependencies (node builtins + one `git log`), same as the rest of tools/.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}
const TOP = Number(val('--top', '25'))
const WINDOW = Number(val('--window', '200'))
const MIN = Number(val('--min', '0'))
const JSON_OUT = has('--json')

// ---- file set -------------------------------------------------------------
// Score real source only: production server + client. Tests are scanned
// separately (naming drift) and .d.ts / node_modules never count.
const SCAN_DIRS = ['server', 'client/src']
const isSource = (p) =>
  /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts') && !/\.test\.ts$/.test(p) && !p.includes('node_modules')

function walk(dir, out = []) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return out
  for (const name of fs.readdirSync(abs)) {
    const rel = path.posix.join(dir, name)
    const stat = fs.statSync(path.join(root, rel))
    if (stat.isDirectory()) walk(rel, out)
    else if (isSource(rel)) out.push(rel)
  }
  return out
}
const files = SCAN_DIRS.flatMap((d) => walk(d))

// ---- churn (one git call, tallied) ----------------------------------------
// Count how many of the last WINDOW commits touched each path. Renames are not
// followed (a heuristic, not forensics); raw path frequency is enough signal.
function churnMap() {
  const map = new Map()
  let out = ''
  try {
    out = execFileSync('git', ['log', `-n${WINDOW}`, '--pretty=format:', '--name-only'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return map // no git / shallow checkout: churn just reads as 0 everywhere
  }
  for (const line of out.split('\n')) {
    const p = line.trim()
    if (p) map.set(p, (map.get(p) ?? 0) + 1)
  }
  return map
}
const churn = churnMap()

// ---- per-file source metrics ----------------------------------------------
const NAME_FLAG = /(^|[/-])(legacy|deprecat\w*|compat\w*|shim|adapter|v[12]|-old|-new)([/.-]|$)/i
const MARKERS = [
  { re: /\bas any\b|:\s*any\b/g, label: 'any' },
  { re: /@ts-(ignore|expect-error)/g, label: 'ts-ignore' },
  { re: /\b(TODO|FIXME|HACK|XXX)\b/g, label: 'todo' },
  { re: /\.(skip|only)\s*\(/g, label: 'skip' },
]

// Rough but honest: track brace depth across the file to get max nesting, and
// measure the longest balanced body that opens right after a function-ish
// signature. String/comment braces add noise, acceptable for a heuristic.
const FN_SIG = /(\bfunction\b|=>\s*$|=>\s*\{|\)\s*\{|\bconstructor\b)/
function shape(text) {
  const lines = text.split('\n')
  let depth = 0, maxDepth = 0
  let maxFn = 0
  const openStack = [] // { startLine, startDepth }
  lines.forEach((line, i) => {
    const sig = FN_SIG.test(line)
    for (const ch of line) {
      if (ch === '{') {
        depth++
        if (depth > maxDepth) maxDepth = depth
        openStack.push({ line: i, fn: sig })
      } else if (ch === '}') {
        const open = openStack.pop()
        if (open && open.fn) {
          const span = i - open.line + 1
          if (span > maxFn) maxFn = span
        }
        depth = Math.max(0, depth - 1)
      }
    }
  })
  return { maxDepth, maxFn }
}

// Fan-in: how many *other* source files import this one. Only relative imports
// among our files count; node/deps imports are irrelevant to internal coupling.
function moduleKey(rel) {
  return rel.replace(/\.(ts|tsx)$/, '').replace(/\/index$/, '')
}
const bySourceKey = new Map(files.map((f) => [moduleKey(f), f]))
function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  const candidates = [abs, `${abs}/index`, abs.replace(/\.(ts|tsx|js)$/, '')]
  for (const c of candidates) if (bySourceKey.has(c)) return bySourceKey.get(c) // the real file path
  return null
}

const IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g

const meta = new Map() // rel -> raw metrics
const fanIn = new Map(files.map((f) => [f, 0]))
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8')
  const loc = text.split('\n').length
  const { maxDepth, maxFn } = shape(text)
  const markers = MARKERS.map((m) => (text.match(m.re) || []).length)
  const markerTotal = markers.reduce((a, b) => a + b, 0)
  meta.set(rel, {
    loc,
    churn: churn.get(rel) ?? 0,
    maxDepth,
    maxFn,
    markerTotal,
    markerLabels: MARKERS.map((m, i) => (markers[i] ? `${m.label}:${markers[i]}` : null)).filter(Boolean),
    nameFlag: NAME_FLAG.test(rel),
  })
  // tally fan-in from this file's imports
  let m
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3]
    const target = resolveImport(rel, spec)
    if (target) fanIn.set(target, (fanIn.get(target) ?? 0) + 1)
  }
}

// ---- scoring --------------------------------------------------------------
const log1p = (x) => Math.log(1 + Math.max(0, x))
const maxOf = (fn) => Math.max(1, ...files.map((f) => fn(meta.get(f), f)))

// Normalizers computed across the actual set so the score is relative to *this*
// repo, not absolute thresholds that would need retuning.
const nChurnSize = maxOf((mt) => log1p(mt.loc) * log1p(mt.churn))
const nMaxFn = maxOf((mt) => mt.maxFn)
const nDepth = maxOf((mt) => mt.maxDepth)
const nFanChurn = maxOf((mt, f) => log1p(fanIn.get(f)) * log1p(mt.churn))
const nMarker = maxOf((mt) => mt.markerTotal)

const WEIGHTS = { churnSize: 0.42, maxFn: 0.16, depth: 0.12, fanChurn: 0.14, marker: 0.08, nameFlag: 0.08 }

function score(rel) {
  const mt = meta.get(rel)
  const parts = {
    churnSize: (log1p(mt.loc) * log1p(mt.churn)) / nChurnSize,
    maxFn: mt.maxFn / nMaxFn,
    depth: mt.maxDepth / nDepth,
    fanChurn: (log1p(fanIn.get(rel)) * log1p(mt.churn)) / nFanChurn,
    marker: mt.markerTotal / nMarker,
    nameFlag: mt.nameFlag ? 1 : 0,
  }
  const total = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * parts[k], 0) * 100
  // Which signals drove the score, for the "why" column.
  const drivers = Object.entries(parts)
    .map(([k, v]) => [k, v * WEIGHTS[k]])
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v > 0.02)
    .slice(0, 3)
    .map(([k]) => k)
  return { total, drivers }
}

const ranked = files
  .map((rel) => {
    const mt = meta.get(rel)
    const { total, drivers } = score(rel)
    return { rel, total, drivers, ...mt, fanIn: fanIn.get(rel) ?? 0 }
  })
  .filter((r) => r.total >= MIN)
  .sort((a, b) => b.total - a.total)

// ---- repo-level sections --------------------------------------------------
// Reordered-token names: the same words in a different order (`x-score` vs
// `score-x`). Genuine confusion: two files whose names are anagrams of each
// other almost always means someone did not know the first one existed. We
// require *distinct* basenames, so a `foo.ts` scattered across dirs by
// convention (types.ts, registry.ts) does not count.
function reorderedNames() {
  const byTokens = new Map()
  for (const f of files) {
    const base = path.posix.basename(f).replace(/\.(ts|tsx)$/, '')
    const key = base.split(/[-.]/).filter(Boolean).sort().join('|')
    if (!byTokens.has(key)) byTokens.set(key, new Map())
    byTokens.get(key).set(base, f)
  }
  return [...byTokens.values()]
    .filter((m) => m.size > 1) // >1 *distinct* basename sharing one token set
    .map((m) => [...m.values()])
}

// Parallel module trees: two directories that mirror each other file-for-file
// (decision-layer/ vs score-layer/). A copy-paste fork someone grew in tandem;
// the biggest single deletion/merge target a name scan can find.
function parallelTrees() {
  const byDir = new Map()
  for (const f of files) {
    const d = path.posix.dirname(f)
    const b = path.posix.basename(f)
    if (!byDir.has(d)) byDir.set(d, new Set())
    byDir.get(d).add(b)
  }
  const dirs = [...byDir.keys()]
  const pairs = []
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const a = byDir.get(dirs[i]), b = byDir.get(dirs[j])
      const shared = [...a].filter((x) => b.has(x))
      if (shared.length >= 3) pairs.push({ a: dirs[i], b: dirs[j], shared })
    }
  }
  return pairs.sort((x, y) => y.shared.length - x.shared.length)
}

// Concept fan-out: how many files (across how many dirs) share a concept stem.
// High file count over many dirs = an idea with no single owner.
function conceptFanout() {
  const STEMS = ['role', 'score', 'morgana', 'merlin', 'evil', 'good', 'objective', 'policy', 'trace', 'compat', 'voice', 'situation']
  return STEMS.map((stem) => {
    const hits = files.filter((f) => path.posix.basename(f).toLowerCase().includes(stem))
    const dirs = new Set(hits.map((f) => path.posix.dirname(f)))
    return { stem, files: hits.length, dirs: dirs.size }
  }).filter((c) => c.files >= 4).sort((a, b) => b.files - a.files)
}

// ---- output ---------------------------------------------------------------
if (JSON_OUT) {
  console.log(JSON.stringify({
    window: WINDOW,
    scanned: files.length,
    ranked: ranked.slice(0, TOP),
    reorderedNames: reorderedNames(),
    parallelTrees: parallelTrees(),
    conceptFanout: conceptFanout(),
  }, null, 2))
  process.exit(0)
}

const pad = (s, n) => String(s).padEnd(n)
const padl = (s, n) => String(s).padStart(n)
console.log(`\nHotspot triage  (${files.length} source files, churn over last ${WINDOW} commits)\n`)
console.log(`${pad('score', 6)} ${pad('loc', 5)} ${pad('chn', 4)} ${pad('fn', 4)} ${pad('dep', 4)} ${pad('fin', 4)}  ${pad('why', 26)} file`)
console.log('-'.repeat(100))
for (const r of ranked.slice(0, TOP)) {
  console.log(
    `${padl(r.total.toFixed(1), 6)} ${padl(r.loc, 5)} ${padl(r.churn, 4)} ${padl(r.maxFn, 4)} ${padl(r.maxDepth, 4)} ${padl(r.fanIn, 4)}  ${pad(r.drivers.join(',') + (r.nameFlag ? ' *' : ''), 26)} ${r.rel}`,
  )
}

const reordered = reorderedNames()
if (reordered.length) {
  console.log('\nReordered-token filenames (same words, different order = likely a forgotten twin):')
  for (const g of reordered) console.log(`  - ${g.join('  <->  ')}`)
}

const trees = parallelTrees()
if (trees.length) {
  console.log('\nParallel module trees (dirs mirroring each other file-for-file = copy-paste fork):')
  for (const t of trees) console.log(`  - ${t.a}  ||  ${t.b}   (${t.shared.length} shared: ${t.shared.slice(0, 5).join(', ')}${t.shared.length > 5 ? ', ...' : ''})`)
}

const concepts = conceptFanout()
if (concepts.length) {
  console.log('\nConcept fan-out (one idea across many files/dirs):')
  for (const c of concepts) console.log(`  - ${pad(c.stem, 12)} ${padl(c.files, 3)} files across ${c.dirs} dirs`)
}

// Test-name drift: a proxy for whether the code under test is understood.
const testDir = path.join(root, 'test')
if (fs.existsSync(testDir)) {
  const tests = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))
  const phaseNamed = tests.filter((f) => /phase\d|p\d[a-z]|step\d|wip|tmp/i.test(f))
  if (phaseNamed.length) {
    console.log(`\nTest-name drift: ${phaseNamed.length}/${tests.length} tests named after refactor phases, not behavior`)
    console.log(`  e.g. ${phaseNamed.slice(0, 4).join(', ')}${phaseNamed.length > 4 ? ', ...' : ''}`)
  }
}
console.log('')
