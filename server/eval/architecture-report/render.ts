// The human-readable spelling of the report. Text only, no arithmetic.
//
// The report is machine-readable first: architectureReport returns JSON and the
// CLI can emit it directly. This module exists so that the second, prose form
// cannot quietly become a second computation. Nothing here derives a figure;
// every number printed was already decided by summarize.ts, and the rate and
// interval formats come from core/report-format.ts so this report and
// vote-conversion-report.ts spell the same estimate the same way.
//
// A consequence worth keeping: changing a line here moves published text
// without moving any published number, and changing summarize.ts moves the
// number. Reviewers can tell which happened by which file the diff touches.

import {
  fixed,
  renderDelta,
  renderMilliseconds,
  renderRate,
} from '../core/report-format.ts'
import type {
  ArchitectureBenchmarkReport,
} from './types.ts'

export function renderArchitectureReport(report: ArchitectureBenchmarkReport): string {
  const lines = [
    `ARCHITECTURE ${report.bank}  ${report.cases.length} cases`,
  ]
  for (const variant of report.variants) {
    lines.push(
      `${variant.id}: ${variant.wins}/${variant.games} target-side wins, `
      + `${variant.forcedViolations} forced, ${variant.degraded} degraded, `
      + `${variant.calls} calls, $${fixed(variant.cost)}`,
    )
    lines.push(`  components ${Object.entries(variant.components).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    if (variant.decisionComponents) {
      lines.push(
        `  decision-components ${
          variant.decisionComponents.length
            ? variant.decisionComponents.join(' ')
            : '(empty)'
        }`,
      )
    }
    if (variant.componentEvidence) {
      lines.push(
        `  component-evidence ${variant.componentEvidence.trust}, `
        + `${variant.componentEvidence.promotionEvidenceEligible
          ? 'promotion-eligible'
          : 'promotion-ineligible'}, `
        + `${variant.componentEvidence.decisions} decisions, `
        + `${variant.componentEvidence.admitted} admitted `
        + `(${variant.componentEvidence.exact} exact, `
        + `${variant.componentEvidence.structural} structural), `
        + `${variant.componentEvidence.degraded} degraded, `
        + `${variant.componentEvidence.policyUses} causal uses/`
        + `${variant.componentEvidence.policyStages} stages`,
      )
    }
    lines.push(`  roles ${variant.byRole.map((r) =>
      `${r.role}:${r.wins}/${r.games},d${r.degraded},$${fixed(r.cost)}`).join(' ')}`)
    lines.push(
      `  quality win ${renderRate(variant.decisionQuality.targetWinRate)}; `
      + `clean-proposal ${renderRate(
        variant.decisionQuality.cleanInitialProposalRate,
      )}; vote-truth ${renderRate(
        variant.decisionQuality.voteTruthAccuracy,
      )}`,
    )
    lines.push(
      // NB-013: the symmetric accuracy above averages these two, and their game
      // value is not equal. A promotion gate reads dirty-approve, not vote-truth.
      `  vote-errors dirty-approve ${renderRate(
        variant.decisionQuality.voteDirtyTeamApproveRate,
      )}; clean-reject ${renderRate(
        variant.decisionQuality.voteCleanTeamRejectRate,
      )}`,
    )
    lines.push(
      `  variation planner-override ${renderRate(
        variant.decisionQuality.plannerOverrideRate,
      )}; seeded-vote ${renderRate(
        variant.decisionQuality.seededVoteVariationRate,
      )}; approve ${renderRate(variant.decisionQuality.voteApproveRate)}`,
    )
    lines.push(
      `  values proposal-clean ${
        variant.decisionQuality.meanProposalCleanProbability?.toFixed(4)
        ?? 'n/a'
      } proposal-regret ${
        variant.decisionQuality.meanProposalPosteriorRegret?.toFixed(4)
        ?? 'n/a'
      } vote-regret ${
        variant.decisionQuality.meanVoteUtilityRegret?.toFixed(4)
        ?? 'n/a'
      }`,
    )
    lines.push(
      `  latency ${variant.latency.samples} samples, median `
      + `${renderMilliseconds(variant.latency.medianMs)}, p95 `
      + `${renderMilliseconds(variant.latency.p95Ms)}, max `
      + renderMilliseconds(variant.latency.maxMs),
    )
    lines.push(
      `  safety hidden ${variant.safety.hiddenInformationViolations}/`
      + `${variant.safety.hiddenInformationChecks}, attribution `
      + `${variant.safety.traceAttributionViolations}/`
      + variant.safety.traceAttributionChecks
      + (
        variant.safety.promotionEvidenceEligible === undefined
          ? ''
          : `, component-evidence ${
              variant.safety.promotionEvidenceEligible
                ? 'promotion-eligible'
                : 'promotion-ineligible'
            }`
      ),
    )
    lines.push(`  kinds ${variant.byKind.map((k) =>
      `${k.kind}:${k.decisions}d/${k.calls}c/${k.degraded}x/$${fixed(k.cost)}`).join(' ')}`)
    if (variant.byModel.length) {
      lines.push(`  models ${variant.byModel.map((m) =>
        `${m.model}:${m.calls}c/$${fixed(m.cost)}`).join(' ')}`)
    }
  }
  for (const comparison of report.comparisons) {
    lines.push(
      `DELTA ${comparison.candidate} - ${comparison.baseline} (${comparison.matchedCases} matched): `
      + `wins ${comparison.wins >= 0 ? '+' : ''}${comparison.wins}, `
      + `forced ${comparison.forcedViolations >= 0 ? '+' : ''}${comparison.forcedViolations}, `
      + `degraded ${comparison.degraded >= 0 ? '+' : ''}${comparison.degraded}, `
      + `cost ${comparison.cost >= 0 ? '+' : ''}$${fixed(comparison.cost)}`,
    )
    lines.push(
      `  promotion-evidence ${
        comparison.promotionEvidenceEligible ? 'eligible' : 'ineligible'
      }`,
    )
    lines.push(
      `  rate deltas win ${renderDelta(comparison.targetWinRateDelta)}; `
      + `clean-proposal ${renderDelta(
        comparison.cleanInitialProposalRateDelta,
      )}; vote-truth ${renderDelta(
        comparison.voteTruthAccuracyDelta,
      )}`,
    )
    lines.push(
      `  vote-error deltas dirty-approve ${renderDelta(
        comparison.voteDirtyTeamApproveRateDelta,
      )}; clean-reject ${renderDelta(
        comparison.voteCleanTeamRejectRateDelta,
      )}`,
    )
  }
  return lines.join('\n')
}
