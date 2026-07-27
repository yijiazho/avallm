// Generic player-facing copy must not infer gender from a role, player name, or
// model label. Curated character biographies under agents/ are deliberately
// outside this scan: a biography may describe the known fictional or real
// entity behind that persona. The gameplay UI should still refer to the player
// occupying that seat with singular they/them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const GENDERED_THIRD_PERSON = /\b(?:he|him|his|himself|she|her|hers|herself)\b/i

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlocks
    .split('\n')
    .map((line) => {
      const m = line.match(/(^|[^:])\/\//)
      return m ? line.slice(0, m.index! + (m[1] ? 1 : 0)) : line
    })
    .join('\n')
}

function clientSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return clientSources(file)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []
  })
}

test('generic player-facing copy uses gender-neutral player references', () => {
  const clientDir = path.resolve(import.meta.dirname, '../client/src')
  const sources = [
    ...clientSources(clientDir),
    path.resolve(import.meta.dirname, '../client/index.html'),
    path.resolve(import.meta.dirname, '../client/gallery.html'),
    path.resolve(import.meta.dirname, '../server/server.ts'),
  ]

  for (const file of sources) {
    const code = stripComments(fs.readFileSync(file, 'utf8'))
    code.split('\n').forEach((line, i) => {
      assert.doesNotMatch(
        line,
        GENDERED_THIRD_PERSON,
        `${path.relative(path.resolve(import.meta.dirname, '..'), file)}:${i + 1} assumes a player's gender`,
      )
    })
  }
})
