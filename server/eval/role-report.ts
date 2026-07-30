// Migration phase 7F2B; see docs/agent-architecture-migration.md.

import { createHash } from 'node:crypto'
import { ARCHITECTURE_BANK } from './architecture-bank.ts'
import {
  generatePhase7RoleAuthorityEvidence,
  PHASE7_ROLE_AUTHORITY_VERSION,
  type Phase7RoleAuthorityRow,
} from './role-authority.ts'
import {
  PHASE7_ROLE_EVAL_VERSION,
  type Phase7RoleEvalArm,
  type Phase7RoleEvidenceRow,
  PHASE7_ROLE_EVAL_ARMS,
} from './role-eval.ts'
import {
  PHASE7_VIRTUAL_ASSASSIN_VERSION,
  type VirtualAssassinEvidence,
} from './virtual-assassin.ts'
import { sumOf } from './statistics.ts'
import { ROLE_ALIGNMENT } from '../engine/rules.ts'
import type {
  AssertNever,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
} from '../agents/key-list-guards.ts'
import {
  exactKeys,
  plainRecord,
} from '../agents/components/canonical-shape.ts'

export const PHASE7_ROLE_REPORT_VERSION = 'phase7-role-report-v1'
export const PHASE7_ROLE_EVIDENCE_BASELINE = 'docs/baselines/phase7-role-evidence-standard-v1.jsonl'
export const PHASE7_VIRTUAL_ASSASSIN_BASELINE = 'docs/baselines/phase7-virtual-assassin-standard-v1.jsonl'
export const PHASE7_ROLE_REPORT_BASELINE = 'docs/baselines/phase7-role-report-standard-v1.json'
const ARMS: readonly Phase7RoleEvalArm[] = PHASE7_ROLE_EVAL_ARMS

interface ArmSummary {
  readonly games: number
  readonly goodWins: number
  readonly evilWins: number
  readonly targetWins: number
  readonly calls: number
  readonly cost: number
  readonly degradation: number
  readonly forcedViolations: number
  readonly exactAdmission: Readonly<{
    eligibleRows: number
    decisions: number
    exact: number
    structural: number
    promotionEligible: boolean
  }>
  readonly safety: Readonly<{
    hiddenChecks: number
    hiddenViolations: number
    attributionChecks: number
    attributionViolations: number
  }>
}

export interface Phase7RoleReport {
  readonly schema: 1
  readonly version: typeof PHASE7_ROLE_REPORT_VERSION
  readonly inputs: Readonly<{
    roleEvidenceDigest: string
    virtualAssassinDigest: string
    roleAuthorityDigest: string
  }>
  readonly inventory: Readonly<{
    cases: number
    rows: number
    logicalArms: readonly Phase7RoleEvalArm[]
    rawIdentities: Readonly<Record<Phase7RoleEvalArm, readonly Readonly<{
      rawVariantId: string
      rawAgentDescriptor: string
      configuredScorer: string
      identityDigests: readonly string[]
    }>[]>>
  }>
  readonly arms: Readonly<Record<Phase7RoleEvalArm, ArmSummary>>
  readonly mechanics: Readonly<{
    baseObserverEquivalentCases: number
    baseObserverExpectedCases: number
    isolatedFullComparableCases: number
    isolatedFullEquivalentComparableCases: number
    isolatedFullEquivalentAllCases: number
    integratedFullRoleDifferenceCases: readonly string[]
  }>
  readonly authority: Readonly<{
    version: typeof PHASE7_ROLE_AUTHORITY_VERSION
    families: number
    rows: readonly Phase7RoleAuthorityRow[]
  }>
  readonly virtualAssassin: Readonly<{
    version: typeof PHASE7_VIRTUAL_ASSASSIN_VERSION
    histories: number
    guesses: number
    hits: number
    accuracy: number
    sampleUnit: '12-correlated-guesses-from-4-histories'
    promotionThreshold: null
    pretruthDigestVerified: true
  }>
  readonly exitGate: Readonly<{
    completeInventory: boolean
    apiFreeAndSafe: boolean
    exactPromotionEvidence: boolean
    mechanicsEquivalent: boolean
    authorityCausal: boolean
    virtualTruthJoinedAfterDigest: boolean
    passed: boolean
  }>
}

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

/**
 * The shared key-set predicate, wrapped in the labelled throw this parser wants.
 *
 * Only the assertion signature and the message are local. The predicate is
 * exactKeys itself, so this file no longer carries a second definition of what
 * "exactly these keys" means; the wrapper survives because five call sites read
 * better as a statement that names the offending row than as an if/throw pair.
 *
 * plainRecord in place of the old hand-rolled object test is deliberate, and it
 * is a strengthening: the old test admitted a proxy, a null prototype, and a
 * class instance. Every value here comes straight out of JSON.parse, so none of
 * those can occur and no legal baseline row changes verdict, but this parser
 * reads evidence that gates a promotion decision and there is no reason for it
 * to hold the laxer of two available definitions.
 */
function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!plainRecord(value)) throw new Error(`${label}: expected object`)
  if (!exactKeys(value, keys)) throw new Error(`${label}: invalid fields`)
}

function parseJsonl(text: string, label: string): unknown[] {
  if (!text.endsWith('\n')) throw new Error(`${label}: missing final newline`)
  const lines = text.trimEnd().split('\n')
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    throw new Error(`${label}: empty evidence`)
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`${label}:${index + 1}: invalid JSON`)
    }
  })
}

/*
 * _RowKeysSound and _VirtualKeysSound below are exported only so noUnusedLocals
 * accepts them. Nothing imports them: each is a type-level assertion that fails
 * the build if its key list drifts from the row shape it claims to cover, so
 * being referenced is not what makes it work. Deleting one silently removes a
 * drift check.
 */
const ROW_KEYS = [
  'schema', 'evaluation', 'rowId', 'caseId', 'logicalArm',
  'rawVariantId', 'rawAgentDescriptor', 'rawIdentityDigest',
  'configuredScorer', 'targetRole', 'targetSeat', 'winner', 'targetWon',
  'logDigest', 'decisionDigest', 'calls', 'cost', 'degradation',
  'forcedViolations', 'exactAdmission', 'safety', 'terminal',
] as const satisfies ExactKeyList<Phase7RoleEvidenceRow>
export type _RowKeysSound =
  | AssertNever<MissingKeys<Phase7RoleEvidenceRow, typeof ROW_KEYS>>
  | AssertNever<DuplicateKeys<typeof ROW_KEYS>>

export function parsePhase7RoleEvidence(text: string):
readonly Phase7RoleEvidenceRow[] {
  const rows = parseJsonl(text, 'role evidence').map((raw, index) => {
    assertExactKeys(raw, ROW_KEYS, `role evidence:${index + 1}`)
    assertExactKeys(
      raw.exactAdmission,
      ['eligible', 'decisions', 'exact', 'structural'],
      `role evidence:${index + 1}:exactAdmission`,
    )
    assertExactKeys(
      raw.safety,
      [
        'hiddenChecks', 'hiddenViolations',
        'attributionChecks', 'attributionViolations',
      ],
      `role evidence:${index + 1}:safety`,
    )
    if (
      raw.schema !== 1
      || raw.evaluation !== PHASE7_ROLE_EVAL_VERSION
      || typeof raw.rowId !== 'string'
      || typeof raw.caseId !== 'string'
      || !ARMS.includes(raw.logicalArm as Phase7RoleEvalArm)
      || typeof raw.rawVariantId !== 'string'
      || typeof raw.rawAgentDescriptor !== 'string'
      || typeof raw.configuredScorer !== 'string'
      || !/^[0-9a-f]{64}$/.test(String(raw.rawIdentityDigest))
      || !/^[0-9a-f]{64}$/.test(String(raw.logDigest))
      || !/^[0-9a-f]{64}$/.test(String(raw.decisionDigest))
      || !['good', 'evil'].includes(String(raw.winner))
      || typeof raw.targetWon !== 'boolean'
      || ![
        raw.targetSeat, raw.calls, raw.cost, raw.degradation,
        raw.forcedViolations, raw.exactAdmission.decisions,
        raw.exactAdmission.exact, raw.exactAdmission.structural,
        raw.safety.hiddenChecks, raw.safety.hiddenViolations,
        raw.safety.attributionChecks, raw.safety.attributionViolations,
      ].every((value) =>
        typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0)
      || typeof raw.exactAdmission.eligible !== 'boolean'
      || raw.terminal !== true
    ) {
      throw new Error(`role evidence:${index + 1}: invalid F2A row`)
    }
    return raw as unknown as Phase7RoleEvidenceRow
  })
  const expectedCaseIds = ARCHITECTURE_BANK.map((row) => row.id).sort()
  const caseIds = [...new Set(rows.map((row) => row.caseId))].sort()
  if (
    rows.length !== ARCHITECTURE_BANK.length * ARMS.length
    || JSON.stringify(caseIds) !== JSON.stringify(expectedCaseIds)
    || new Set(rows.map((row) => row.rowId)).size !== rows.length
  ) {
    throw new Error('role evidence: incomplete standard-v1 inventory')
  }
  for (const caseId of caseIds) {
    const group = rows.filter((row) => row.caseId === caseId)
    const arms = group.map((row) => row.logicalArm).sort()
    if (JSON.stringify(arms) !== JSON.stringify([...ARMS].sort())) {
      throw new Error(`${caseId}: incomplete logical arms`)
    }
    const first = group[0]
    const bankCase = ARCHITECTURE_BANK.find((row) => row.id === caseId)!
    if (!group.every((row) =>
      row.rowId === `${caseId}:${row.logicalArm}`
      && row.targetRole === first.targetRole
      && row.targetRole === bankCase.targetRole
      && row.targetSeat === first.targetSeat
      && row.targetSeat === bankCase.expectedTargetSeat)) {
      throw new Error(`${caseId}: mismatched case identity`)
    }
    for (const row of group) {
      const fixed = row.logicalArm === 'isolated-role'
        ? row.rawVariantId.startsWith('isolated-')
        : row.rawVariantId === row.logicalArm
      if (
        !fixed
        || row.rawAgentDescriptor !== `phase7-role-eval:${row.rawVariantId}`
      ) {
        throw new Error(`${row.rowId}: untruthful raw identity`)
      }
    }
  }
  return Object.freeze(rows)
}

const VIRTUAL_KEYS = [
  'version', 'historyId', 'playerCount', 'predictorSeat', 'predictorRole',
  'beliefThroughSeq', 'guessSeat', 'targets', 'predictionDigest',
  'merlinSeat', 'hit',
] as const satisfies ExactKeyList<VirtualAssassinEvidence>
export type _VirtualKeysSound =
  | AssertNever<MissingKeys<VirtualAssassinEvidence, typeof VIRTUAL_KEYS>>
  | AssertNever<DuplicateKeys<typeof VIRTUAL_KEYS>>

export function parseVirtualAssassinEvidence(text: string):
readonly VirtualAssassinEvidence[] {
  const rows = parseJsonl(text, 'virtual Assassin evidence')
    .map((raw, index) => {
      assertExactKeys(raw, VIRTUAL_KEYS, `virtual Assassin:${index + 1}`)
      if (
        raw.version !== PHASE7_VIRTUAL_ASSASSIN_VERSION
        || typeof raw.historyId !== 'string'
        || !Array.isArray(raw.targets)
        || !/^[0-9a-f]{64}$/.test(String(raw.predictionDigest))
        || raw.hit !== (raw.guessSeat === raw.merlinSeat)
      ) {
        throw new Error(`virtual Assassin:${index + 1}: invalid row`)
      }
      for (const [targetIndex, target] of raw.targets.entries()) {
        assertExactKeys(
          target,
          ['seat', 'knownVisibleEvil', 'probability'],
          `virtual Assassin:${index + 1}:target:${targetIndex}`,
        )
        if (
          !Number.isInteger(target.seat)
          || typeof target.knownVisibleEvil !== 'boolean'
          || typeof target.probability !== 'number'
          || !Number.isFinite(target.probability)
        ) {
          throw new Error(`virtual Assassin:${index + 1}: invalid target`)
        }
      }
      const prediction = {
        version: raw.version,
        historyId: raw.historyId,
        playerCount: raw.playerCount,
        predictorSeat: raw.predictorSeat,
        predictorRole: raw.predictorRole,
        beliefThroughSeq: raw.beliefThroughSeq,
        guessSeat: raw.guessSeat,
        targets: raw.targets,
      }
      if (digest(JSON.stringify(prediction)) !== raw.predictionDigest) {
        throw new Error(`virtual Assassin:${index + 1}: pretruth digest mismatch`)
      }
      return raw as unknown as VirtualAssassinEvidence
    })
  const histories = new Map<string, VirtualAssassinEvidence[]>()
  for (const row of rows) {
    const group = histories.get(row.historyId) ?? []
    group.push(row)
    histories.set(row.historyId, group)
  }
  if (rows.length !== 12 || histories.size !== 4) {
    throw new Error('virtual Assassin: expected 12 guesses from four histories')
  }
  for (const [historyId, group] of histories) {
    if (
      new Set(group.map((row) => row.predictorSeat)).size !== group.length
      || new Set(group.map((row) => row.merlinSeat)).size !== 1
    ) {
      throw new Error(`${historyId}: invalid correlated guess group`)
    }
  }
  return Object.freeze(rows)
}

function summarizeArm(rows: readonly Phase7RoleEvidenceRow[]): ArmSummary {
  const total = (select: (row: Phase7RoleEvidenceRow) => number) =>
    sumOf(rows, select)
  const structural = total((row) => row.exactAdmission.structural)
  const eligibleRows = rows.filter(
    (row) => row.exactAdmission.eligible,
  ).length
  return Object.freeze({
    games: rows.length,
    goodWins: rows.filter((row) => row.winner === 'good').length,
    evilWins: rows.filter((row) => row.winner === 'evil').length,
    targetWins: rows.filter((row) => row.targetWon).length,
    calls: total((row) => row.calls),
    cost: total((row) => row.cost),
    degradation: total((row) => row.degradation),
    forcedViolations: total((row) => row.forcedViolations),
    exactAdmission: Object.freeze({
      eligibleRows,
      decisions: total((row) => row.exactAdmission.decisions),
      exact: total((row) => row.exactAdmission.exact),
      structural,
      promotionEligible:
        eligibleRows === rows.length && structural === 0,
    }),
    safety: Object.freeze({
      hiddenChecks: total((row) => row.safety.hiddenChecks),
      hiddenViolations: total((row) => row.safety.hiddenViolations),
      attributionChecks: total((row) => row.safety.attributionChecks),
      attributionViolations: total((row) => row.safety.attributionViolations),
    }),
  })
}

function rawIdentityInventory(rows: readonly Phase7RoleEvidenceRow[]) {
  return Object.fromEntries(ARMS.map((arm) => {
    const identities = new Map<string, {
      rawVariantId: string
      rawAgentDescriptor: string
      configuredScorer: string
      identityDigests: Set<string>
    }>()
    for (const row of rows.filter((candidate) => candidate.logicalArm === arm)) {
      const key = [
        row.rawVariantId,
        row.rawAgentDescriptor,
        row.configuredScorer,
      ].join('\0')
      const prior = identities.get(key) ?? {
        rawVariantId: row.rawVariantId,
        rawAgentDescriptor: row.rawAgentDescriptor,
        configuredScorer: row.configuredScorer,
        identityDigests: new Set<string>(),
      }
      prior.identityDigests.add(row.rawIdentityDigest)
      identities.set(key, prior)
    }
    return [arm, [...identities.values()]
      .sort((left, right) => left.rawVariantId.localeCompare(right.rawVariantId))
      .map((identity) => Object.freeze({
        ...identity,
        identityDigests: Object.freeze([...identity.identityDigests].sort()),
      }))]
  })) as unknown as Phase7RoleReport['inventory']['rawIdentities']
}

export async function buildPhase7RoleReport(
  roleText: string,
  virtualText: string,
): Promise<Phase7RoleReport> {
  const rows = parsePhase7RoleEvidence(roleText)
  const virtual = parseVirtualAssassinEvidence(virtualText)
  const authority = await generatePhase7RoleAuthorityEvidence()
  const arms = Object.fromEntries(ARMS.map((arm) => [
    arm,
    summarizeArm(rows.filter((row) => row.logicalArm === arm)),
  ])) as unknown as Record<Phase7RoleEvalArm, ArmSummary>
  const caseGroups = ARCHITECTURE_BANK.map((bankCase) =>
    rows.filter((row) => row.caseId === bankCase.id))
  const equivalent = (
    group: readonly Phase7RoleEvidenceRow[],
    left: Phase7RoleEvalArm,
    right: Phase7RoleEvalArm,
  ): boolean => {
    const a = group.find((row) => row.logicalArm === left)!
    const b = group.find((row) => row.logicalArm === right)!
    return a.logDigest === b.logDigest && a.decisionDigest === b.decisionDigest
  }
  const baseObserverEquivalentCases = caseGroups.filter((group) =>
    equivalent(group, 'base-composed', 'observer-only')).length
  const isolatedFullEquivalentAllCases = caseGroups.filter((group) =>
    equivalent(group, 'isolated-role', 'full-role')).length
  // The full arm additionally enables robust heterogeneous D3. Therefore
  // whole-game equality with an isolated score-only arm is specified only
  // where that policy cannot apply: good seats and Oberon.
  const isolatedFullComparable = caseGroups.filter((group) => {
    const role = group[0].targetRole
    return ROLE_ALIGNMENT[role] === 'good' || role === 'oberon'
  })
  const isolatedFullEquivalentComparableCases =
    isolatedFullComparable.filter((group) =>
      equivalent(group, 'isolated-role', 'full-role')).length
  const integratedFullRoleDifferenceCases = caseGroups
    .filter((group) => !equivalent(group, 'isolated-role', 'full-role'))
    .map((group) => group[0].caseId)
  const apiFreeAndSafe = Object.values(arms).every((arm) =>
    arm.calls === 0 && arm.cost === 0 && arm.degradation === 0
    && arm.forcedViolations === 0 && arm.safety.hiddenViolations === 0
    && arm.safety.attributionViolations === 0)
  const exactPromotionEvidence = Object.values(arms)
    .every((arm) => arm.exactAdmission.promotionEligible)
  const mechanicsEquivalent =
    baseObserverEquivalentCases === ARCHITECTURE_BANK.length
    && isolatedFullEquivalentComparableCases === isolatedFullComparable.length
  const authorityCausal = authority.length === 6 && authority.every((row) =>
    row.trustedAdmission === 'trusted-exact'
    && row.mechanicsEquivalent
    && row.fullRoleTerminal
    && row.causalStages.length > 0)
  const exitGate = {
    completeInventory: rows.length === 50,
    apiFreeAndSafe,
    exactPromotionEvidence,
    mechanicsEquivalent,
    authorityCausal,
    virtualTruthJoinedAfterDigest: true,
  }
  return Object.freeze({
    schema: 1,
    version: PHASE7_ROLE_REPORT_VERSION,
    inputs: Object.freeze({
      roleEvidenceDigest: digest(roleText),
      virtualAssassinDigest: digest(virtualText),
      roleAuthorityDigest: digest(JSON.stringify(authority)),
    }),
    inventory: Object.freeze({
      cases: ARCHITECTURE_BANK.length,
      rows: rows.length,
      logicalArms: ARMS,
      rawIdentities: rawIdentityInventory(rows),
    }),
    arms: Object.freeze(arms),
    mechanics: Object.freeze({
      baseObserverEquivalentCases,
      baseObserverExpectedCases: ARCHITECTURE_BANK.length,
      isolatedFullComparableCases: isolatedFullComparable.length,
      isolatedFullEquivalentComparableCases,
      isolatedFullEquivalentAllCases,
      integratedFullRoleDifferenceCases: Object.freeze(
        integratedFullRoleDifferenceCases,
      ),
    }),
    authority: Object.freeze({
      version: PHASE7_ROLE_AUTHORITY_VERSION,
      families: authority.length,
      rows: authority,
    }),
    virtualAssassin: Object.freeze({
      version: PHASE7_VIRTUAL_ASSASSIN_VERSION,
      histories: 4,
      guesses: virtual.length,
      hits: virtual.filter((row) => row.hit).length,
      accuracy: virtual.filter((row) => row.hit).length / virtual.length,
      sampleUnit: '12-correlated-guesses-from-4-histories',
      promotionThreshold: null,
      pretruthDigestVerified: true,
    }),
    exitGate: Object.freeze({
      ...exitGate,
      passed: Object.values(exitGate).every(Boolean),
    }),
  })
}

export function serializePhase7RoleReport(report: Phase7RoleReport): string {
  return JSON.stringify(report, null, 2) + '\n'
}
