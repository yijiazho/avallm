// Palette drift guard for client/src/styles.css.
//
// The failure this prevents: a rule hardcodes a colour that happens to BE one of
// the :root palette tokens (e.g. `rgba(111, 143, 217, 0.5)` for `--good: #6f8fd9`).
// Editing the token in :root then recolours most of the UI but silently leaves the
// literal behind, so one allegiance renders in two slightly different blues. The
// bug is invisible until someone retunes the palette, which is exactly when it is
// most expensive to find.
//
// The rule: outside :root, a colour that equals a token must be written through the
// token. Opaque uses take `var(--tok)`; translucent uses take
// `color-mix(in srgb, var(--tok) N%, transparent)` (the established idiom), or
// `rgb(from var(--tok) r g b / 0)` for the one alpha-0 keyframe endpoint, where
// color-mix would premultiply the channels away.
//
// Colours that are NOT in the palette are none of this test's business — plenty of
// one-off hues are deliberate. Only exact token matches are policed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cssPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'src', 'styles.css',
)
const src = fs.readFileSync(cssPath, 'utf8')

// The :root block defines the tokens and, in a comment, quotes the retired
// --ok/--bad hexes. Everything up to its closing brace is exempt by construction.
const rootStart = src.indexOf(':root {')
const rootEnd = src.indexOf('\n}', rootStart)

test(':root block is locatable', () => {
  assert.ok(rootStart >= 0 && rootEnd > rootStart, 'could not find the :root token block')
})

function tokenTable(): Map<string, string> {
  const table = new Map<string, string>()
  for (const m of src.slice(rootStart, rootEnd).matchAll(/^\s*--([\w-]+):\s*#([0-9a-fA-F]{6});/gm)) {
    const hex = m[2]
    const key = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')
    if (!table.has(key)) table.set(key, m[1])
  }
  return table
}

// The scannable source: the whole file with two regions blanked out — comments (so
// a hex quoted in prose is not read as a declaration) and the :root block itself
// (whose token definitions are the one legitimate place for these literals).
// Blanking preserves length, so an offset into this string is an offset into `src`.
//
// Blanking only :root matters: styles.css declares real rules ABOVE it (the `*`
// reset), so exempting everything up to :root would leave those rules unpoliced.
const blank = (s: string) => s.replace(/\S/g, ' ')
function scannable(): string {
  const withoutRoot = src.slice(0, rootStart) + blank(src.slice(rootStart, rootEnd)) + src.slice(rootEnd)
  return withoutRoot.replace(/\/\*[\s\S]*?\*\//g, blank)
}

function lineOf(offset: number): number {
  return src.slice(0, offset).split('\n').length
}

// The replacement to suggest for a token used at a given alpha.
//
// Alpha 0 is the exception, and it matters: color-mix premultiplies, so mixing a
// token at 0% yields `color(srgb 0 0 0 / 0)` — the channels are gone, not merely
// invisible. Suggesting it would talk the reader into the exact defect that
// @keyframes beat in styles.css avoids by using relative colour syntax, which
// keeps the hue at zero alpha.
function replacementFor(token: string, alpha: number): string {
  if (alpha === 1) return `var(--${token})`
  if (alpha === 0) return `rgb(from var(--${token}) r g b / 0)`
  return `color-mix(in srgb, var(--${token}) ${Math.round(alpha * 1e6) / 1e4}%, transparent)`
}

test('palette tokens are defined', () => {
  const table = tokenTable()
  assert.ok(table.size >= 10, `expected the full palette, found ${table.size} tokens`)
  for (const name of ['good', 'evil', 'gold', 'night', 'text']) {
    assert.ok([...table.values()].includes(name), `missing token --${name}`)
  }
})

test('no rgb()/rgba() literal outside :root duplicates a palette token', () => {
  const table = tokenTable()
  const offenders: string[] = []
  // Both separator styles: legacy `rgb(r, g, b, a)` and CSS Color 4's
  // `rgb(r g b / a)`. The space-separated form is valid, renders identically, and
  // would otherwise slip past a comma-only pattern.
  const COLOUR = /rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/g
  for (const m of scannable().matchAll(COLOUR)) {
    const token = table.get([m[1], m[2], m[3]].join(','))
    if (!token) continue
    const raw = m[4]
    const alpha = raw === undefined ? 1 : (raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw))
    offenders.push(`  styles.css:${lineOf(m.index!)}  ${m[0]}  ->  ${replacementFor(token, alpha)}`)
  }
  assert.deepEqual(offenders, [], `literal colours duplicate a :root palette token:\n${offenders.join('\n')}`)
})

test('no hex literal outside :root duplicates a palette token', () => {
  const table = tokenTable()
  const offenders: string[] = []
  for (const m of scannable().matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const key = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(',')
    const token = table.get(key)
    if (!token) continue
    offenders.push(`  styles.css:${lineOf(m.index!)}  ${m[0]}  ->  var(--${token})`)
  }
  assert.deepEqual(offenders, [], `hex literals duplicate a :root palette token:\n${offenders.join('\n')}`)
})
