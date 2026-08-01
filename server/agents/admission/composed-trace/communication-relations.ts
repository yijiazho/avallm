// Relations covering the planner and the communication intent: the two places
// where a trace makes a claim about what the seat said rather than about what it
// computed. They share the direction contract and the intent key lists, and
// nothing else in admission reads either, so keeping them together bounds how
// far a change to the speech contract can reach.

import type {
  Seat,
} from '../../../engine/types.ts'
import {
  isComposedPolicy,
} from '../../brain.ts'
import {
  onlyAllowedKeys,
  probability,
} from '../../canonical/canonical-shape.ts'
import {
  PROBABILITY_TOLERANCE,
} from '../../canonical/probability-arithmetic.ts'
import {
  communicationDirectionFailure,
  directionChannelFor,
  publicEvidenceExists,
} from '../../communication/direction-contract.ts'
import {
  communicationFactProjection,
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
} from '../../policy/communication-intent.ts'
import {
  POSTERIOR_UNCERTAINTY_VERSION,
} from '../../policy/plan.ts'
import type {
  PublicEvidenceReference,
} from '../../policy/plan.ts'
import {
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
} from '../../policy/score.ts'
import type {
  CandidateScore,
} from '../../policy/score.ts'
import {
  projectLanguageInterpreterInput,
} from '../../record/language-contract.ts'
import {
  stringArray,
} from '../trace-primitives.ts'
import {
  COMMUNICATION_INTENT_KEYS,
  COMMUNICATION_INTENT_ONLY_KEYS,
  CURRENT_VERSUS_ALTERNATIVE_UNCERTAINTY_KEYS,
  ROLE_COMPOSITE_UNCERTAINTY_KEYS,
  SELECTED_TEAM_CLEAN_UNCERTAINTY_KEYS,
} from './key-lists.ts'
import type {
  ComposedTraceContext,
} from './relation-context.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validPlannerRelations(ctx: ComposedTraceContext): boolean {
  const {
    trace, scores, chosen, chosenScore, structured, plannerReasons, phase4c,
    components, hasPlanner,
  } = ctx
  // Sound because validCandidateScores proved every score's shape before this
  // relation runs: the reason-code helpers below re-run the production scorer's
  // arithmetic, so they need the typed view. Cast once here rather than
  // re-spelling it at each guarded call site.
  const typedScores = scores as unknown as CandidateScore[]
  const typedChosenScore = chosenScore as unknown as CandidateScore
  if (
    phase4c
    && (
      !isComposedPolicy(components?.policy)
    )
  ) {
    return false
  }
  if (
    phase4c
    && (
      (
        structured === undefined
        && plannerReasons !== undefined
      )
      || (
        structured !== undefined
        && (
          typeof structured !== 'string'
          || !scores.some(
            (score) =>
              score.candidateId === structured
              && score.viable === true,
          )
          || (
            !hasPlanner
            && structured !== chosen
          )
          || (
            plannerReasons !== undefined
            && (
              !stringArray(plannerReasons)
              || new Set(plannerReasons).size !== plannerReasons.length
              || trace.plannerCandidateId !== chosen
              || !chosenScore
              || plannerReasons.some(
                (reason) => !(
                  hasPlanner
                  && chosen !== structured
                    ? plannerOverrideReasonCodes(typedChosenScore, typedScores)
                    : selectedStrategicReasonCodes(typedChosenScore, typedScores)
                ).includes(reason),
              )
            )
          )
          || (
            hasPlanner
            && chosen !== structured
            && (
              trace.plannerCandidateId !== chosen
              || !Array.isArray(plannerReasons)
              || plannerReasons.length === 0
              || !chosenScore
              || plannerReasons.some(
                (reason) =>
                  !plannerOverrideReasonCodes(
                    typedChosenScore,
                    typedScores,
                  ).includes(reason),
              )
            )
          )
        )
      )
    )
  ) {
    return false
  }
  return true
}

export function validCommunicationIntent(ctx: ComposedTraceContext): boolean {
  const {
    trace, scores, chosen, chosenScore, chosenFeatures, action, intent,
    playerCount, hostView, hostRolesInPlay,
  } = ctx
  if (intent !== undefined) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      return false
    }
    const expectedChannel = directionChannelFor(
      action.kind as string,
      action.stick as boolean | undefined,
    )
    const facts = trace.factCodes as string[]
    const projection = communicationFactProjection(facts)
    const strategicReasons = intent.strategicReasonCodes
    const publicInput = hostView
      ? projectLanguageInterpreterInput(hostView)
      : undefined
    const decisionLayerRun =
      trace.decisionLayerRun as Record<string, unknown> | undefined
    const decisionLayerSurface =
      decisionLayerRun?.surface as Record<string, unknown> | undefined
    const committedPolicyReasons = stringArray(
      decisionLayerSurface?.reasonCodes,
    )
      ? decisionLayerSurface.reasonCodes
      : []
    const availableStrategicReasons = [
      ...(chosenScore
        // Sound because validCandidateScores proved the score shape upstream;
        // the helper re-runs the production scorer, so it needs the typed view.
        ? selectedStrategicReasonCodes(
            chosenScore as unknown as CandidateScore,
            scores as unknown as CandidateScore[],
          )
        : []),
      ...committedPolicyReasons,
    ]
    // The direction half of the intent is the shared contract, checked with
    // everything this boundary knows: the committed action's channel, the table
    // size, the host's deal, and the host's public record. A host that supplied
    // no view leaves the last two unanswerable, so those capabilities are
    // omitted rather than faked, and the structural rules still apply.
    //
    // Seat lists here are bounded and dense but deliberately not canonicalSeats.
    // A planner names the seats it is addressing in whatever order it chose,
    // and acts that do not address a particular player may carry an empty list.
    // Ascending order and unconditional non-emptiness are therefore the two
    // parts of the canonical seat-list contract this direction does not carry.
    if (communicationDirectionFailure(intent, {
      allowedChannels: expectedChannel === undefined ? [] : [expectedChannel],
      additionalKeys: COMMUNICATION_INTENT_ONLY_KEYS,
      ...(playerCount === undefined
        ? {}
        : { seatExists: (seat: Seat) => seat < playerCount }),
      ...(hostRolesInPlay === undefined
        ? {}
        : { rolesInPlay: hostRolesInPlay }),
      ...(publicInput === undefined
        ? {}
        : {
            evidenceExists: (reference: PublicEvidenceReference) =>
              publicEvidenceExists(reference, publicInput),
          }),
    }) !== undefined) {
      return false
    }
    if (
      !onlyAllowedKeys(intent, COMMUNICATION_INTENT_KEYS)
      || !stringArray(intent.safeFactCodes)
      || new Set(intent.safeFactCodes as string[]).size
        !== (intent.safeFactCodes as string[]).length
      || !isDeepStrictEqual(intent.safeFactCodes, projection.safeFactCodes)
      || !stringArray(intent.conceal)
      || new Set(intent.conceal as string[]).size
        !== (intent.conceal as string[]).length
      || !isDeepStrictEqual(intent.conceal, projection.conceal)
      || !stringArray(strategicReasons)
      || new Set(strategicReasons).size !== strategicReasons.length
      || !chosenScore
      || strategicReasons.some(
        (reason) => !availableStrategicReasons.includes(reason),
      )
    ) {
      return false
    }
    const uncertainty = intent.uncertainty as
      | Record<string, unknown>
      | undefined
    const expectsUncertainty =
      chosenFeatures?.version === GOOD_PROPOSAL_FEATURE_VERSION
      || chosenFeatures?.version === GOOD_VOTE_FEATURE_VERSION
    if (expectsUncertainty !== (uncertainty !== undefined)) {
      return false
    }
    if (uncertainty !== undefined) {
      const chosenRole = chosenScore?.roleObjectiveFeatures as
        | Record<string, unknown>
        | undefined
      if (
        !onlyAllowedKeys(
          uncertainty,
          uncertainty.kind === 'role-composite-decision'
            ? ROLE_COMPOSITE_UNCERTAINTY_KEYS
            : uncertainty.kind === 'selected-team-clean'
            ? SELECTED_TEAM_CLEAN_UNCERTAINTY_KEYS
            : CURRENT_VERSUS_ALTERNATIVE_UNCERTAINTY_KEYS,
        )
        ||
        uncertainty.version !== POSTERIOR_UNCERTAINTY_VERSION
        || uncertainty.semantics !== chosenFeatures?.semantics
        || !chosenFeatures
        || uncertainty.beliefModelVersion
          !== chosenFeatures.beliefModelVersion
        || uncertainty.beliefThroughSeq !== trace.beliefThroughSeq
      ) {
        return false
      }
      if (chosenRole) {
        const alternatives = scores.filter(
          (score) =>
            score.candidateId !== chosen
            && score.value !== -Number.MAX_SAFE_INTEGER
            && score.roleObjectiveFeatures !== undefined,
        )
        const expectedGap = alternatives.length
          ? Math.min(...alternatives.map((score) =>
              Math.abs(
                Number(chosenRole.combinedValue)
                - Number(
                  (
                    score.roleObjectiveFeatures as Record<string, unknown>
                  ).combinedValue,
                ),
              )))
          : 1
        if (
          uncertainty.kind !== 'role-composite-decision'
          || uncertainty.baseKind !== (
            chosenFeatures.version === GOOD_PROPOSAL_FEATURE_VERSION
              ? 'proposal-team-clean'
              : 'vote-current-versus-alternative'
          )
          || typeof uncertainty.compositeUtilityGap !== 'number'
          || !Number.isFinite(uncertainty.compositeUtilityGap)
          || Math.abs(
            Number(uncertainty.compositeUtilityGap) - expectedGap,
          ) > PROBABILITY_TOLERANCE
        ) return false
      } else if (chosenFeatures.version === GOOD_PROPOSAL_FEATURE_VERSION) {
        if (
          uncertainty.kind !== 'selected-team-clean'
          || !probability(uncertainty.cleanProbability)
          || !probability(uncertainty.residualProbability)
          || uncertainty.cleanProbability
            !== chosenFeatures.cleanProbability
          || Math.abs(
            (uncertainty.residualProbability as number)
            - (1 - (chosenFeatures.cleanProbability as number)),
          ) > PROBABILITY_TOLERANCE
        ) {
          return false
        }
      } else if (chosenFeatures.version === GOOD_VOTE_FEATURE_VERSION) {
        if (
          uncertainty.kind !== 'current-versus-alternative-team-clean'
          || !probability(uncertainty.currentCleanProbability)
          || !probability(
            uncertainty.bestAlternativeCleanProbability,
          )
          || typeof uncertainty.utilityGap !== 'number'
          || !Number.isFinite(uncertainty.utilityGap)
          || uncertainty.utilityGap < 0
          || uncertainty.currentCleanProbability
            !== chosenFeatures.currentCleanProbability
          || uncertainty.bestAlternativeCleanProbability
            !== chosenFeatures.bestAlternativeCleanProbability
          || Math.abs(
            (uncertainty.utilityGap as number)
            - Math.abs(
              (chosenFeatures.approveUtility as number)
              - (chosenFeatures.rejectUtility as number),
            ),
          ) > PROBABILITY_TOLERANCE
        ) {
          return false
        }
      } else {
        return false
      }
    }
  }
  return true
}
