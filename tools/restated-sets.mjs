// Closed-set triage: finds string-literal sets that a second module spells out
// again, and the type-only unions that invite it.
//
//   node tools/restated-sets.mjs             # report (default)
//   node tools/restated-sets.mjs --json      # machine-readable
//   node tools/restated-sets.mjs --all       # also list unconsolidated unions
//   node tools/restated-sets.mjs --help
//
// The bug it looks for is specific. A closed set declared only as a type union
// has no runtime representation, so every validator that has to decide whether
// an incoming string is a member is forced to restate the literals, and the
// compiler cannot tie those copies back to the union. They then survive a
// change to it without reddening anything. That is how the retired `external`
// execution mode stayed alive in four separate lists, and how `CoherenceIntent`
// came to be restated nine times across six files.
//
// Two sections, in decreasing urgency:
//
//   restated        the set appears verbatim in another module. Actionable now:
//                   give it a frozen list plus a derived type, point the copies
//                   at it, and register it in test/contract/closed-sets.test.ts.
//   unconsolidated  still a bare literal union with no runtime list. Nobody has
//                   restated it yet, but nothing can read it at runtime, so the
//                   first validator that needs a membership test will have to
//                   spell it out. Shown under --all.
//
// This tool finds; it does not enforce. Enforcement is test/contract/closed-sets.test.ts,
// which fails the suite when a registered set is restated. Consolidating a set
// means adding it to that registry, which is what keeps it consolidated.
//
// Exits 1 when the restated section is non-empty, 0 otherwise, so it can gate a
// sweep. Zero dependencies, matching the rest of tools/.

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)

if (has('--help') || has('-h')) {
  console.log(
    fs.readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('//'))
      .map((line) => line.replace(/^\/\/ ?/, ''))
      .join('\n'),
  )
  process.exit(0)
}

const ROOT = 'server'
/** Members are separated by an array comma or a union pipe, across lines. */
const SEPARATOR = String.raw`\s*(?:,|\|)\s*`

/**
 * Both ways a closed set gets declared. Seeding from unions alone would go
 * blind exactly as a set is fixed: a consolidated owner declares a frozen array
 * and derives the type from it, so the literal union it used to have is gone.
 * Checked by planting a restatement of an already-consolidated set, which a
 * union-only scan reported as "none".
 *
 * Members admit uppercase. The first version matched [a-z0-9-] only, which made
 * every set with a camelCase member invisible in both forms: 'gameOver' broke
 * the run for Phase and 'gameCreated' broke it for EventType, so neither was
 * reported and both survived the sweep that consolidated their all-lowercase
 * neighbours ROLES and DECISION_KINDS. Widening the class raised the
 * unconsolidated count from 18 to 20 and named those two at the lines they were
 * declared on.
 */
const DECLARATIONS = [
  {
    // export type X = 'a' | 'b' | 'c'
    kind: 'unconsolidated',
    pattern: /export type (\w+)\s*=\s*((?:\s*\|?\s*'[a-zA-Z0-9-]+'){3,})\s*[\n;]/g,
  },
  {
    // export const X = Object.freeze(['a', 'b', 'c'] as const)
    kind: 'consolidated',
    pattern:
      /export const (\w+)\s*=\s*(?:Object\.freeze\(\s*)?\[\s*((?:'[a-zA-Z0-9-]+'\s*,\s*){2,}'[a-zA-Z0-9-]+'\s*,?)\s*\]/g,
  },
]

function sources(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name).split(path.sep).join('/')
      if (entry.isDirectory()) walk(full)
      else if (full.endsWith('.ts')) found.push(full)
    }
  }
  walk(dir)
  return found.sort()
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function scan() {
  const text = new Map(
    sources(ROOT).map((file) => [file, fs.readFileSync(file, 'utf8')]),
  )
  const found = []
  const seen = new Set()
  for (const { kind, pattern } of DECLARATIONS) {
    for (const [file, source] of text) {
      for (const match of source.matchAll(pattern)) {
        const members = [...match[2].matchAll(/'([a-zA-Z0-9-]+)'/g)]
          .map((m) => m[1])
        if (members.length < 3) continue
        // A consolidated set can match the const and again the type derived
        // from it; key on the set so it is reported once, as consolidated.
        const key = `${file} ${members.join(',')}`
        if (seen.has(key)) continue
        seen.add(key)
        const run = new RegExp(
          members.map((member) => `'${member}'`).join(SEPARATOR),
          'g',
        )
        const restatedIn = []
        for (const [other, otherSource] of text) {
          if (other === file) continue
          for (const hit of otherSource.matchAll(run)) {
            restatedIn.push(`${other}:${lineOf(otherSource, hit.index)}`)
          }
        }
        found.push({
          name: match[1],
          kind,
          owner: `${file}:${lineOf(source, match.index)}`,
          members,
          restatedIn,
        })
      }
    }
  }
  found.sort((a, b) =>
    b.restatedIn.length - a.restatedIn.length || a.name.localeCompare(b.name))
  return found
}

const found = scan()
const restated = found.filter((set) => set.restatedIn.length > 0)
const unconsolidated = found.filter(
  (set) => set.restatedIn.length === 0 && set.kind === 'unconsolidated',
)

if (has('--json')) {
  console.log(JSON.stringify(
    has('--all') ? { restated, unconsolidated } : { restated },
    null,
    2,
  ))
  process.exit(restated.length ? 1 : 0)
}

if (!restated.length) {
  console.log('restated: none. Every closed set is stated in one module.')
} else {
  console.log(`restated (${restated.length}):\n`)
  for (const set of restated) {
    console.log(`  ${set.name}  (${set.members.length} members, ${set.kind})`)
    console.log(`    owner      ${set.owner}`)
    for (const site of set.restatedIn) console.log(`    restated   ${site}`)
    console.log()
  }
  console.log('Give each a frozen list plus a derived type, point the copies')
  console.log('at it, then register it in test/contract/closed-sets.test.ts.')
}

if (has('--all')) {
  console.log(`\nunconsolidated, not yet restated (${unconsolidated.length}):\n`)
  for (const set of unconsolidated) {
    console.log(`  ${set.name.padEnd(34)} ${set.owner}`)
  }
}

process.exit(restated.length ? 1 : 0)
