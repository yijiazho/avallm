// Small, dependency-free JSON file helpers shared by runtime persistence.
//
// The atomic writer follows the pattern the agent store already used: write a
// sibling temp file, then rename it into place. A crash leaves the old record
// intact and at worst a temp file that every scan skips.

import fs from 'node:fs'
import path from 'node:path'

export interface WriteJsonOptions {
  /** Pretty-print with two spaces. Defaults to the compact form. */
  pretty?: boolean
}

export function writeJsonAtomic(
  file: string,
  value: unknown,
  options: WriteJsonOptions = {},
): void {
  const resolved = path.resolve(file)
  const tmp = `${resolved}.tmp-${process.pid}`
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(
      tmp,
      JSON.stringify(value, null, options.pretty ? 2 : undefined),
    )
    fs.renameSync(tmp, resolved)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // A cleanup failure must not hide the original write error.
    }
    throw new Error(
      `could not write ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

export function readJsonFile<T>(file: string): T {
  const resolved = path.resolve(file)
  const text = fs.readFileSync(resolved, 'utf8')
  try {
    return JSON.parse(text) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `${resolved}:${jsonErrorPosition(text, message)}: not valid JSON (${message})`,
      { cause: err },
    )
  }
}

// Directory scans must ignore an in-flight or crashed atomic write. The writer
// uses `<file>.tmp-<pid>`; keeping the test in one place means a future writer
// variant cannot accidentally make temp files look like records.
export function isTempFile(file: string): boolean {
  return path.basename(file).includes('.tmp-')
}

function jsonErrorPosition(text: string, message: string): string {
  const lineColumn = /line (\d+) column (\d+)/.exec(message)
  if (lineColumn) return `${lineColumn[1]}:${lineColumn[2]}`
  const position = /position (\d+)/.exec(message)
  if (!position) return '?'
  const index = Math.min(Number(position[1]), text.length)
  const before = text.slice(0, index)
  const line = before.split('\n').length
  const column = index - before.lastIndexOf('\n')
  return `${line}:${column}`
}
