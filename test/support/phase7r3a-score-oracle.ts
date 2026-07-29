import fs from 'node:fs'
import type { DecisionKind } from '../../server/engine/types.ts'

export const PHASE7R3A_SCORE_ORACLE_FILE =
  'test/fixtures/phase7r3a-score-equivalence.json'
export const PHASE7R3A_MAX_SCENARIO_COUNT = 16
export const PHASE7R3A_MAX_SCENARIO_JSON_BYTES = 64 * 1024
export const PHASE7R3A_MAX_TOTAL_SCENARIO_JSON_BYTES = 384 * 1024
export const PHASE7R3A_MAX_PRETTY_FIXTURE_BYTES = 768 * 1024

export interface Phase7R3AOracleScenario {
  readonly id: string
  readonly coverage: readonly string[]
  readonly input: {
    readonly configuration: string
    readonly seed: string
    readonly req: {
      readonly kind: DecisionKind
      readonly seat: number
      readonly round: number
      readonly proposalNum: number
    }
    readonly view: {
      readonly seat: number
      readonly role: string
      readonly phase: string
      readonly round: number
      readonly proposalNum: number
      readonly currentTeam?: readonly number[]
      readonly proposals: readonly {
        readonly round: number
        readonly proposalNum: number
        readonly team: readonly number[]
      }[]
      readonly events: readonly {
        readonly seq: number
        readonly type: string
        readonly payload: Readonly<Record<string, unknown>>
      }[]
    }
  }
  readonly expected: {
    readonly mechanicalDecision: Readonly<{
      kind: DecisionKind
      [key: string]: unknown
    }>
    readonly candidateScores: readonly {
      readonly version?: string
      readonly candidateId: string
      readonly value: number
      readonly viable: boolean
      readonly reasonCodes: readonly string[]
      readonly evilRoleObjectiveFeatures?: {
        readonly utility?: { readonly role?: string }
      }
      readonly [key: string]: unknown
    }[]
    readonly forcedPolicyResult: {
      readonly applied: boolean
      readonly reasonCodes?: readonly string[]
      readonly allowedCandidateIds: readonly string[]
      readonly selectedCandidateId?: string
    }
    readonly structuredCandidateId: string
    readonly selectedCandidateId: string
    readonly selectedScoreReasonCodes: readonly string[]
    readonly communicationStrategicReasonCodes: readonly string[]
    readonly degradation: readonly string[]
    readonly causalUse: {
      readonly configured: readonly unknown[]
      readonly entries: readonly unknown[]
      readonly policyUse: readonly unknown[]
    }
    readonly agentMode: string
    readonly componentPlan: unknown
    readonly componentVersions: unknown
    readonly appliedVersions: {
      readonly scorer: string
      readonly [key: string]: string | undefined
    }
    readonly plannerInput: unknown | null
    readonly voiceInput: unknown | null
  }
}

export interface Phase7R3AScoreOracle {
  readonly schema: number
  readonly capturedFrom: string
  readonly sourceDirty: boolean
  readonly capturePolicy: string
  readonly excludedMigrationMetadata: readonly string[]
  readonly bounds: {
    readonly scenarioCount: number
    readonly maxScenarioJsonBytes: number
    readonly totalScenarioJsonBytes: number
  }
  readonly scenarios: readonly Phase7R3AOracleScenario[]
  readonly scenarioSha256: string
}

/**
 * One bounded owner for the archival A0 fixture. Provenance and semantic
 * coherence remain assertions in the oracle test, while every migration
 * client shares this shape and size admission.
 */
export function readPhase7R3AScoreOracle(
  file = PHASE7R3A_SCORE_ORACLE_FILE,
): Phase7R3AScoreOracle {
  const bytes = fs.statSync(file).size
  if (bytes > PHASE7R3A_MAX_PRETTY_FIXTURE_BYTES) {
    throw new Error('Phase 7R3A score oracle exceeds fixture byte bound')
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('scenarios' in parsed)
    || !Array.isArray(parsed.scenarios)
  ) throw new Error('Phase 7R3A score oracle has an invalid root')
  if (parsed.scenarios.length > PHASE7R3A_MAX_SCENARIO_COUNT) {
    throw new Error('Phase 7R3A score oracle exceeds scenario count bound')
  }
  const scenarioSizes = parsed.scenarios.map((scenario) =>
    Buffer.byteLength(JSON.stringify(scenario), 'utf8'))
  if (
    scenarioSizes.some((size) =>
      size > PHASE7R3A_MAX_SCENARIO_JSON_BYTES)
  ) throw new Error('Phase 7R3A score oracle exceeds scenario byte bound')
  if (
    Buffer.byteLength(JSON.stringify(parsed.scenarios), 'utf8')
      > PHASE7R3A_MAX_TOTAL_SCENARIO_JSON_BYTES
  ) throw new Error('Phase 7R3A score oracle exceeds total byte bound')
  return parsed as Phase7R3AScoreOracle
}
