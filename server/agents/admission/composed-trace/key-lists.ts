// The exhaustive key lists admission validates traced shapes against, and the
// type-level assertions that keep each list bound to the shape it claims to
// cover. They are their own module because they are pure tables with no
// behaviour, and because their whole value is that adding a field to a traced
// shape fails the build here. Buried at the top of a several-thousand-line
// validator, that guarantee reads as boilerplate to scroll past; alone, it
// reads as the contract it is.

import type {
  AssertNever,
  DuplicateKeys,
  ExactKeyList,
  MissingKeys,
  MissingRequiredKeys,
  RequiredKeys,
} from '../../../shared/key-list-guards.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../../analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/evil-role-utility.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
} from '../../analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/morgana-role-utility.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../../analysis/role-objective-types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../../analysis/role-utility.ts'
import {
  COHERENCE_MODEL_VERSION,
} from '../../cognition/coherence.ts'
import {
  PLAN_MEMORY_VERSION,
} from '../../cognition/plan-memory.ts'
import type {
  LanguageTraceAttribution,
} from '../../communication/language-orchestration.ts'
import {
  DECISION_COMPONENT_RUN_VERSION,
} from '../../components/kernel.ts'
import type {
  CommunicationIntent,
  PlannerCommunicationDirection,
  PosteriorUncertainty,
} from '../../policy/plan.ts'
import type {
  EvilRoleObjectiveScoreFeatures,
  MorganaRoleObjectiveScoreFeatures,
  RoleObjectiveScoreFeatures,
} from '../../policy/score.ts'
import type {
  TraceComponentVersions,
} from '../../trace.ts'

/*
 * The key lists below are the runtime half of shapes that are also declared as
 * TypeScript types. Each is bound to its declaring type three ways: `satisfies
 * ExactKeyList<T>` rejects a key that `T` does not have, `MissingKeys` fed to
 * `AssertNever` rejects a key of `T` that the list forgot, and `DuplicateKeys`
 * fed to the same assertion rejects a repeated entry. Adding a field to one of
 * those shapes without extending its list here is a compile error naming the
 * field, so admission cannot silently stop guarding it.
 *
 * The duplicate arm matters most for the Morgana list, the one site that reads
 * its list through the counting `exactKeys` rather than the permissive
 * `onlyAllowedKeys`: `exactKeys` compares `keys.length` against the record's own
 * key count, so one repeated entry inflates the expected length and refuses every
 * valid trace. The other lists are membership-only, where a duplicate is inert,
 * but they carry the same assertion so the guarantee does not depend on which
 * predicate a given site happens to use.
 *
 * The optional attribution keys are handled separately from this mandatory
 * list, but not by hand-written per-key clauses: `validComponentVersions`
 * classifies every optional key into exactly one value bucket
 * (`OPTIONAL_COMPONENT_VERSION_VALUES` for fixed version literals,
 * `OPTIONAL_FREEFORM_VERSION_KEYS` for any non-empty string, or the bespoke
 * `configuredScorer` check). The `_OptionalComponentVersionKeysClassified`
 * alias resolves to `never` only when that classification is exhaustive, so
 * adding an optional key without a bucket is a compile error naming the field.
 * The cross-key relational invariants (a role-utility projection implies its
 * objective; plan memory and coherence toggle together) are additive and stay
 * as explicit clauses in the validator.
 *
 * The underscore-prefixed aliases throughout this region are exported only so
 * noUnusedLocals accepts them. Nothing imports them: each is a type-level
 * assertion that fails the build if its key list drifts from the shape it
 * claims to cover, so being referenced is not what makes one work. Deleting
 * one silently removes a drift check.
 */

/** Mandatory attribution keys; optional ones are value-checked individually. */
export const REQUIRED_COMPONENT_VERSION_KEYS = [
  'brain', 'belief', 'beliefVisibility', 'factors', 'languageEvidence',
  'observerModel', 'analysis', 'candidates', 'forcedPolicy', 'policy',
  'scorer', 'planner', 'prompt', 'renderer', 'voice',
] as const satisfies ExactKeyList<TraceComponentVersions>
export type _RequiredComponentVersionKeysSound =
  | AssertNever<
      MissingRequiredKeys<
        TraceComponentVersions,
        typeof REQUIRED_COMPONENT_VERSION_KEYS
      >
    >
  | AssertNever<DuplicateKeys<typeof REQUIRED_COMPONENT_VERSION_KEYS>>

/** The opt-in attribution keys, computed from the shape rather than restated. */
type OptionalComponentVersionKey = Exclude<
  keyof TraceComponentVersions & string,
  RequiredKeys<TraceComponentVersions>
>

/**
 * Opt-in keys whose value, when present, must equal one of a fixed set of
 * resolved version literals. Bound to the shape so a stale key is a type error.
 */
export const OPTIONAL_COMPONENT_VERSION_VALUES = {
  planMemory: [PLAN_MEMORY_VERSION],
  coherence: [COHERENCE_MODEL_VERSION],
  decisionComponents: [DECISION_COMPONENT_RUN_VERSION],
  roleObjective: [ROLE_OBJECTIVE_MODEL_VERSION, EVIL_ROLE_OBJECTIVE_MODEL_VERSION],
  roleObjectiveRouter: [ROLE_OBJECTIVE_ROUTER_VERSION],
  roleUtility: [ROLE_UTILITY_PROJECTION_VERSION],
  evilRoleUtility: [EVIL_ROLE_UTILITY_PROJECTION_VERSION],
  morganaCounterfeitPublicRead: [MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION],
  morganaCounterfeitObjective: [MORGANA_COUNTERFEIT_OBJECTIVE_VERSION],
  configuredMorganaCounterfeitObjective: [MORGANA_COUNTERFEIT_OBJECTIVE_VERSION],
  morganaRoleUtility: [MORGANA_ROLE_UTILITY_PROJECTION_VERSION],
  configuredMorganaRoleUtility: [MORGANA_ROLE_UTILITY_PROJECTION_VERSION],
} as const satisfies Partial<
  Record<OptionalComponentVersionKey, readonly string[]>
>

/** Opt-in keys admitted as any non-empty string rather than a fixed literal. */
export const OPTIONAL_FREEFORM_VERSION_KEYS = [
  'mechanicalBelief', 'beliefPipeline', 'identityModel',
] as const satisfies readonly OptionalComponentVersionKey[]

/*
 * Exhaustiveness: every optional key must be value-checked by exactly one
 * bucket above, or the bespoke `configuredScorer` clause. A newly added opt-in
 * key that no bucket covers leaves a leftover here, and `AssertNever` fails to
 * instantiate with the compiler naming the field, so admission cannot silently
 * stop value-checking it.
 */
export type _OptionalComponentVersionKeysClassified = AssertNever<
  Exclude<
    OptionalComponentVersionKey,
    | keyof typeof OPTIONAL_COMPONENT_VERSION_VALUES
    | typeof OPTIONAL_FREEFORM_VERSION_KEYS[number]
    | 'configuredScorer'
  >
>

export const LANGUAGE_TRACE_KEYS = [
  'inputSchemaVersion',
  'cursorSchemaVersion',
  'interpreterVersion',
  'factorVersion',
  'factorBundleVersion',
  'cursorThroughSeq',
  'admittedSourceSeqs',
  'cumulativeSourceSeqs',
  'degradation',
] as const satisfies ExactKeyList<LanguageTraceAttribution>
export type _LanguageTraceKeysSound =
  | AssertNever<
      MissingKeys<LanguageTraceAttribution, typeof LANGUAGE_TRACE_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof LANGUAGE_TRACE_KEYS>>

/*
 * The three role feature lists omit `seedBucket`, which each call site appends
 * only when the decision actually carried one. They bind against the shape with
 * that key removed in both directions, so the exhaustiveness check still covers
 * every other field while listing `seedBucket` here is itself a type error. That
 * matters because the Morgana call site compares the assembled list length against
 * the trace's own key count: a duplicated `seedBucket` would reject every trace.
 */
type WithoutSeedBucket<T> = Omit<T, 'seedBucket'>

/** A seed bucket is absent or one of the two seeded band positions. */
export function validSeedBucket(value: unknown): boolean {
  return value === undefined || value === 0 || value === 1
}

export const ROLE_OBJECTIVE_FEATURE_KEYS = [
  'version',
  'utilityVersion',
  'utilityProjectionVersion',
  'sourceObjectiveVersion',
  'role',
  'candidateId',
  'kind',
  'baseScorerVersion',
  'baseFeatureVersion',
  'baseValue',
  'roleValue',
  'survivorMeanRoleValue',
  'roleAdjustment',
  'combinedValue',
  'selectionMode',
  'viableBand',
  'inViableBand',
  'selectionAdjustment',
  'utility',
] as const satisfies ExactKeyList<
  WithoutSeedBucket<RoleObjectiveScoreFeatures>
>
export type _RoleObjectiveFeatureKeysSound =
  | AssertNever<
      MissingKeys<
        WithoutSeedBucket<RoleObjectiveScoreFeatures>,
        typeof ROLE_OBJECTIVE_FEATURE_KEYS
      >
    >
  | AssertNever<DuplicateKeys<typeof ROLE_OBJECTIVE_FEATURE_KEYS>>

export const EVIL_ROLE_OBJECTIVE_FEATURE_KEYS = [
  'version',
  'utilityVersion',
  'utilityProjectionVersion',
  'sourceObjectiveVersion',
  'role',
  'candidateId',
  'kind',
  'roleValue',
  'selectionMode',
  'viableBand',
  'inViableBand',
  'selectionAdjustment',
  'utility',
] as const satisfies ExactKeyList<
  WithoutSeedBucket<EvilRoleObjectiveScoreFeatures>
>
export type _EvilRoleObjectiveFeatureKeysSound =
  | AssertNever<
      MissingKeys<
        WithoutSeedBucket<EvilRoleObjectiveScoreFeatures>,
        typeof EVIL_ROLE_OBJECTIVE_FEATURE_KEYS
      >
    >
  | AssertNever<DuplicateKeys<typeof EVIL_ROLE_OBJECTIVE_FEATURE_KEYS>>

export const MORGANA_ROLE_OBJECTIVE_FEATURE_KEYS = [
  'version',
  'utilityProjectionVersion',
  'sourceCounterfeitObjectiveVersion',
  'sourceEvilRoleUtilityVersion',
  'candidateId',
  'kind',
  'd2RoleValue',
  'maxD2RoleValue',
  'd2BandFloor',
  'd2ViableBand',
  'inD2ViableBand',
  'counterfeitValue',
  'counterfeitRank',
  'selectionMode',
  'seededVoteCounterfeitBand',
  'selectedByPolicy',
  'utility',
] as const satisfies ExactKeyList<
  WithoutSeedBucket<MorganaRoleObjectiveScoreFeatures>
>
export type _MorganaRoleObjectiveFeatureKeysSound =
  | AssertNever<
      MissingKeys<
        WithoutSeedBucket<MorganaRoleObjectiveScoreFeatures>,
        typeof MORGANA_ROLE_OBJECTIVE_FEATURE_KEYS
      >
    >
  | AssertNever<DuplicateKeys<typeof MORGANA_ROLE_OBJECTIVE_FEATURE_KEYS>>

export const COMMUNICATION_INTENT_KEYS = [
  'version',
  'channel',
  'targetSeats',
  'actCodes',
  'evidenceRefs',
  'claimedRole',
  'roleTopic',
  'safeFactCodes',
  'conceal',
  'strategicReasonCodes',
  'uncertainty',
  'tone',
] as const satisfies ExactKeyList<CommunicationIntent>
/**
 * What a CommunicationIntent adds to the direction the shared contract owns.
 *
 * Passed to that contract so it admits these four keys and leaves them to the
 * rules below. Derived from the two types, so moving a field between them
 * cannot leave this list behind.
 */
export const COMMUNICATION_INTENT_ONLY_KEYS = [
  'safeFactCodes',
  'conceal',
  'strategicReasonCodes',
  'uncertainty',
] as const satisfies readonly Exclude<
  keyof CommunicationIntent,
  keyof PlannerCommunicationDirection
>[]
/*
 * `satisfies` proves every listed key is intent-only; this proves the list is
 * all of them. Without it a new intent-only field compiles clean here and then
 * fails every admission at runtime, because the shared contract would see a key
 * neither half claimed.
 */
export type _CommunicationIntentOnlyKeysComplete = AssertNever<
  Exclude<
    Exclude<keyof CommunicationIntent, keyof PlannerCommunicationDirection>,
    typeof COMMUNICATION_INTENT_ONLY_KEYS[number]
  >
>
export type _CommunicationIntentKeysSound =
  | AssertNever<
      MissingKeys<CommunicationIntent, typeof COMMUNICATION_INTENT_KEYS>
    >
  | AssertNever<DuplicateKeys<typeof COMMUNICATION_INTENT_KEYS>>

/* One list per `PosteriorUncertainty` variant, keyed off the same discriminant
 * the validator switches on, so a new variant field cannot slip past admission. */
type UncertaintyOf<Kind extends PosteriorUncertainty['kind']> =
  Extract<PosteriorUncertainty, { kind: Kind }>

export const ROLE_COMPOSITE_UNCERTAINTY_KEYS = [
  'version',
  'kind',
  'semantics',
  'beliefModelVersion',
  'beliefThroughSeq',
  'baseKind',
  'compositeUtilityGap',
] as const satisfies ExactKeyList<UncertaintyOf<'role-composite-decision'>>
export type _RoleCompositeUncertaintyKeysSound =
  | AssertNever<
      MissingKeys<
        UncertaintyOf<'role-composite-decision'>,
        typeof ROLE_COMPOSITE_UNCERTAINTY_KEYS
      >
    >
  | AssertNever<DuplicateKeys<typeof ROLE_COMPOSITE_UNCERTAINTY_KEYS>>

export const SELECTED_TEAM_CLEAN_UNCERTAINTY_KEYS = [
  'version',
  'kind',
  'semantics',
  'beliefModelVersion',
  'beliefThroughSeq',
  'cleanProbability',
  'residualProbability',
] as const satisfies ExactKeyList<UncertaintyOf<'selected-team-clean'>>
export type _SelectedTeamCleanUncertaintyKeysSound =
  | AssertNever<
      MissingKeys<
        UncertaintyOf<'selected-team-clean'>,
        typeof SELECTED_TEAM_CLEAN_UNCERTAINTY_KEYS
      >
    >
  | AssertNever<
      DuplicateKeys<typeof SELECTED_TEAM_CLEAN_UNCERTAINTY_KEYS>
    >

export const CURRENT_VERSUS_ALTERNATIVE_UNCERTAINTY_KEYS = [
  'version',
  'kind',
  'semantics',
  'beliefModelVersion',
  'beliefThroughSeq',
  'currentCleanProbability',
  'bestAlternativeCleanProbability',
  'utilityGap',
] as const satisfies ExactKeyList<
  UncertaintyOf<'current-versus-alternative-team-clean'>
>
export type _CurrentVersusAlternativeUncertaintyKeysSound =
  | AssertNever<
      MissingKeys<
        UncertaintyOf<'current-versus-alternative-team-clean'>,
        typeof CURRENT_VERSUS_ALTERNATIVE_UNCERTAINTY_KEYS
      >
    >
  | AssertNever<
      DuplicateKeys<typeof CURRENT_VERSUS_ALTERNATIVE_UNCERTAINTY_KEYS>
    >
