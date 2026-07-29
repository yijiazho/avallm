import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  runPhase7RoleEval,
  serializePhase7RoleEvidence,
  serializeVirtualAssassinEvidence,
} from './phase7-role-eval.ts'
import {
  buildPhase7RoleReport,
  PHASE7_ROLE_EVIDENCE_BASELINE,
  PHASE7_ROLE_REPORT_BASELINE,
  PHASE7_VIRTUAL_ASSASSIN_BASELINE,
  serializePhase7RoleReport,
} from './phase7-role-report.ts'

async function generate(): Promise<void> {
  const result = await runPhase7RoleEval({
    onProgress: (line) => console.log(line),
  })
  const roleText = serializePhase7RoleEvidence(result.rows)
  const virtualText = serializeVirtualAssassinEvidence(
    result.virtualAssassin,
  )
  const reportText = serializePhase7RoleReport(
    await buildPhase7RoleReport(roleText, virtualText),
  )
  for (const [path, contents] of [
    [PHASE7_ROLE_EVIDENCE_BASELINE, roleText],
    [PHASE7_VIRTUAL_ASSASSIN_BASELINE, virtualText],
    [PHASE7_ROLE_REPORT_BASELINE, reportText],
  ]) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      check: { type: 'string' },
      generate: { type: 'boolean', default: false },
    },
  })
  if (values.generate) {
    if (positionals.length || values.out || values.check) {
      throw new Error('--generate does not accept inputs, --out, or --check')
    }
    await generate()
    return
  }
  if (positionals.length !== 2) {
    throw new Error('usage: phase7-role-report <roles.jsonl> <virtual.jsonl> [--out report.json | --check baseline.json]')
  }
  if (values.out && values.check) {
    throw new Error('--out and --check are mutually exclusive')
  }
  const report = serializePhase7RoleReport(await buildPhase7RoleReport(
    readFileSync(resolve(positionals[0]), 'utf8'),
    readFileSync(resolve(positionals[1]), 'utf8'),
  ))
  if (values.check) {
    if (readFileSync(resolve(values.check), 'utf8') !== report) {
      throw new Error(`${values.check}: Phase 7 role report drift`)
    }
    process.stdout.write(`${values.check}: current\n`)
  } else if (values.out) {
    const path = resolve(values.out)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, report)
    process.stdout.write(`${path}: wrote Phase 7 role report\n`)
  } else {
    process.stdout.write(report)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
