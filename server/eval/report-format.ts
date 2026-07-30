// How published evaluation figures render. One owner, so a table law lands
// everywhere it should.
//
// statistics.ts owns the estimators; this module owns their spelling. They are
// separate because a change here moves published text without moving a number,
// and a change there moves the number itself. Both of the paired reports
// (architecture-report.ts, vote-conversion-report.ts) render through the same
// renderRate/renderDelta here, which is what keeps a rate from appearing with
// its interval in one report and bare in its counterpart.
//
// This file deliberately holds TWO percentage conventions rather than forcing
// one. They differ in resolution and in how they spell a missing value, and each
// is required by the tables that use it:
//
//   diagnosisPercent / diagnosisPer   fixed-width diagnosis tables, 'n/a'
//   overviewPercent                   the compact report CLI overview, em dash
//
// Naming them both here is the point: a third hand-rolled variant is the bug,
// not the existence of two documented ones.

import type { RateDeltaEstimate, RateEstimate } from './statistics.ts'

/**
 * A proportion as a one-decimal percentage. No padding, no missing case.
 * Module-private: callers want a whole rendered rate or delta, and the two
 * exported percentage conventions below are the ones tables should reach for.
 */
const percent = (value: number): string =>
  `${(value * 100).toFixed(1)}%`

/** Currency and cost columns in the paired reports. */
export const fixed = (value: number): string => value.toFixed(4)

export const renderMilliseconds = (value: number | null): string =>
  value === null ? 'n/a' : `${value.toFixed(2)}ms`

/**
 * A rate with its Wilson interval. Both paired reports use this, so a rate is
 * never published with its uncertainty in one table and without it in the other.
 * A rate over no trials has no interval to show, and says so rather than
 * printing a division by zero.
 */
export const renderRate = (value: RateEstimate): string =>
  value.rate === null || !value.interval95
    ? `n/a (${value.successes}/${value.trials})`
    : `${percent(value.rate)} (${value.successes}/${value.trials}, `
      + `95% ${percent(value.interval95.low)}-${percent(value.interval95.high)})`

/** A paired-bootstrap delta with its interval, signed so the direction reads. */
export const renderDelta = (value: RateDeltaEstimate): string =>
  value.delta === null || !value.interval95
    ? 'n/a'
    : `${value.delta >= 0 ? '+' : ''}${percent(value.delta)} `
      + `(95% ${percent(value.interval95.low)} to `
      + `${percent(value.interval95.high)})`

/**
 * Diagnosis-table percentage: one decimal, right-aligned to width 7, and 'n/a'
 * for an empty denominator so a column of rates stays a column.
 */
export const diagnosisPercent = (
  numerator: number,
  denominator: number,
): string =>
  denominator === 0
    ? '    n/a'
    : `${(100 * numerator / denominator).toFixed(1)}%`.padStart(7)

/** Diagnosis-table ratio: two decimals, right-aligned to width 5. */
export const diagnosisPer = (
  numerator: number,
  denominator: number,
): string =>
  denominator === 0
    ? '  n/a'
    : (numerator / denominator).toFixed(2).padStart(5)

/**
 * Report CLI overview percentage: whole numbers and an em dash, because that
 * table is compact and its columns are narrow. Kept distinct from
 * diagnosisPercent on purpose; see the note at the top of this file.
 */
export const overviewPercent = (
  numerator: number,
  denominator: number,
): string =>
  denominator ? `${((numerator / denominator) * 100).toFixed(0)}%` : '—'
