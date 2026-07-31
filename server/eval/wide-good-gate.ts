// Run one target role of the wide bank, so a queued fix can be re-gated.
//
// The bank is the point; this is the entry point that makes running it one
// command rather than a scratch script, and that keeps the per-role slicing
// honest. A gate run is offline and API-free but not fast: roughly seventeen
// minutes for all three roles against one population at three arms, and about
// four for a single role at two. Slicing by role is what makes it usable, since
// each queued question is about one seat.
//
// It writes artifacts and stops. Reading them is deliberately separate:
// `merlin-exposure.ts --baseline <arm>` for the concealment channel,
// `proposal-value-diagnosis.ts --baseline <arm>` for the propose channel, and
// `architecture-report.ts` for win rate and the vote-error directions. A gate
// that computed its own verdict inline would be one more place for a metric to
// live, and the whole difficulty this bank exists to fix was metrics that could
// not be compared because each bench owned its own.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  assertFreshArchitectureOutput,
  runArchitectureBench,
  type ArchitectureBenchOpts,
  type ArchitectureVariant,
} from './architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
  type ArchitectureBenchmarkReport,
} from './architecture-report.ts'
import { phase4PolicyVariants } from './good-policy-bench.ts'
import {
  WIDE_GOOD_BANK_ID,
  WIDE_GOOD_TARGET_ROLES,
  wideGoodBankDigest,
  wideGoodBankFor,
} from './wide-good-bank.ts'
import type { AgentSpec } from '../agents/types.ts'
import type { Role } from '../engine/types.ts'

export type WideGoodPopulation = Extract<
  AgentSpec['type'],
  'heuristic' | 'random'
>

export interface WideGoodGateOptions {
  readonly targetRole: Role
  readonly population: WideGoodPopulation
  /** Defaults to the frozen phase-4 arms, so the comparison stays the known one. */
  readonly variants?: readonly ArchitectureVariant[]
  /** Cap the cell, for a smoke run. A partial cell is reported as partial. */
  readonly cases?: number
  readonly out?: string
  readonly onProgress?: ArchitectureBenchOpts['onProgress']
}

export async function runWideGoodGate(
  options: WideGoodGateOptions,
): Promise<ArchitectureBenchmarkReport> {
  const all = wideGoodBankFor(options.targetRole)
  if (!all.length) {
    throw new Error(
      `${WIDE_GOOD_BANK_ID} has no cases targeting ${options.targetRole}; `
      + `it targets ${WIDE_GOOD_TARGET_ROLES.join(', ')}`,
    )
  }
  // Provenance, stated before any game is played: the digest names the exact
  // seed-to-seat mapping this run was measured against. Two runs quoting
  // different digests were not measuring the same target population, however
  // alike their bank ids look.
  options.onProgress?.(
    `${WIDE_GOOD_BANK_ID} deal digest ${wideGoodBankDigest()}`,
  )
  const cases = options.cases === undefined ? all : all.slice(0, options.cases)
  if (cases.length !== all.length) {
    // Said out loud rather than left to the case count, because the whole
    // reason for this bank is that a short cell cannot decide anything.
    options.onProgress?.(
      `PARTIAL CELL: ${cases.length} of ${all.length} ${options.targetRole} `
      + 'cases. This is a smoke run, not a gate.',
    )
  }
  const artifacts = await runArchitectureBench({
    variants: options.variants ?? phase4PolicyVariants(),
    cases,
    // Role and population qualified: one output file stays self describing and
    // no variant/case cell repeats, which architectureReport rejects.
    bankId: `${WIDE_GOOD_BANK_ID}-${options.targetRole}-${options.population}`,
    opponentKind: options.population,
    ...(options.out === undefined ? {} : { out: options.out }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  })
  return architectureReport(artifacts)
}

function parseRole(value: string | undefined): Role {
  const role = WIDE_GOOD_TARGET_ROLES.find((entry) => entry === value)
  if (!role) {
    throw new Error(
      `--role must be one of ${WIDE_GOOD_TARGET_ROLES.join(', ')}`,
    )
  }
  return role
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      role: { type: 'string' },
      population: { type: 'string', default: 'heuristic' },
      cases: { type: 'string' },
      out: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  })
  const targetRole = parseRole(values.role)
  if (values.population !== 'heuristic' && values.population !== 'random') {
    throw new Error('--population must be heuristic or random')
  }
  const population: WideGoodPopulation = values.population
  const out = values.out
    ?? `data/eval/${WIDE_GOOD_BANK_ID}-${targetRole}-${population}.jsonl`
  const cases = values.cases === undefined ? undefined : Number(values.cases)
  if (cases !== undefined && (!Number.isInteger(cases) || cases < 1)) {
    throw new Error('--cases must be a positive integer')
  }
  assertFreshArchitectureOutput(out)
  const report = await runWideGoodGate({
    targetRole,
    population,
    out,
    ...(cases === undefined ? {} : { cases }),
    ...(values.quiet ? {} : { onProgress: (line) => console.log(line) }),
  })
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderArchitectureReport(report)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
