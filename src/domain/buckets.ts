import '../lib/temporal.js';
import type { CustomUnit, Frequency } from '../generated/prisma/enums.js';

export interface ScheduleInput {
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  estimatedExecutionDate: Temporal.PlainDate;
  frequency: Frequency;
  customInterval?: number | null;
  customUnit?: CustomUnit | null;
}

export interface BucketWindow {
  sequence: number;
  startDate: Temporal.PlainDate;
  endDate: Temporal.PlainDate;
  estimatedExecutionDate: Temporal.PlainDate;
}

type Step = { days: number } | { months: number };

function stepOf(input: ScheduleInput): Step | null {
  switch (input.frequency) {
    case 'ONE_TIME':
      return null;
    case 'DAILY':
      return { days: 1 };
    case 'WEEKLY':
      return { days: 7 };
    case 'BIWEEKLY':
      return { days: 14 };
    case 'MONTHLY':
      return { months: 1 };
    case 'QUARTERLY':
      return { months: 3 };
    case 'ANNUALLY':
      return { months: 12 };
    case 'CUSTOM': {
      const n = input.customInterval ?? 1;
      return input.customUnit === 'MONTHS' ? { months: n } : { days: n };
    }
  }
}

/** Nominal period length in days used for the half window (month = 30, quarter = 90, year = 365). */
function nominalDays(input: ScheduleInput): number {
  switch (input.frequency) {
    case 'DAILY':
      return 1;
    case 'WEEKLY':
      return 7;
    case 'BIWEEKLY':
      return 14;
    case 'MONTHLY':
      return 30;
    case 'QUARTERLY':
      return 90;
    case 'ANNUALLY':
      return 365;
    case 'CUSTOM': {
      const n = input.customInterval ?? 1;
      return input.customUnit === 'MONTHS' ? 30 * n : n;
    }
    case 'ONE_TIME':
      return 0;
  }
}

const cmp = (a: Temporal.PlainDate, b: Temporal.PlainDate) => Temporal.PlainDate.compare(a, b);

function executionDates(input: ScheduleInput): Temporal.PlainDate[] {
  const step = stepOf(input);
  if (!step) return [input.estimatedExecutionDate];
  const dates: Temporal.PlainDate[] = [];
  // Always add k × step to the anchor so month-end dates don't drift (Jan 31 → Feb 28 → Mar 31)
  for (let k = 0; ; k++) {
    const multiple = 'days' in step ? { days: step.days * k } : { months: step.months * k };
    const next = input.estimatedExecutionDate.add(multiple, { overflow: 'constrain' });
    if (cmp(next, input.endDate) > 0) break;
    dates.push(next);
  }
  return dates;
}

/**
 * Splits an item's date range into contiguous, non-overlapping buckets (research R7).
 * Bucket k starts half a period before execution k; the first starts at the item start
 * and the last ends at the item end.
 */
export function generateBuckets(input: ScheduleInput): BucketWindow[] {
  const executions = executionDates(input);
  const half = Math.floor(nominalDays(input) / 2);
  const starts = executions.map((exec, k) => {
    if (k === 0) return input.startDate;
    const start = exec.subtract({ days: half });
    return cmp(start, input.startDate) < 0 ? input.startDate : start;
  });
  return executions.map((exec, k) => {
    const nextStart = starts[k + 1];
    return {
      sequence: k,
      startDate: starts[k]!,
      endDate: nextStart ? nextStart.subtract({ days: 1 }) : input.endDate,
      estimatedExecutionDate: exec,
    };
  });
}

/** Execution anchor for the system "Unplanned" items: first 15th on/after the budget start. */
export function unplannedAnchor(budgetStart: Temporal.PlainDate, budgetEnd: Temporal.PlainDate): Temporal.PlainDate {
  const sameMonth = budgetStart.with({ day: 15 });
  const anchor = cmp(sameMonth, budgetStart) >= 0 ? sameMonth : sameMonth.add({ months: 1 });
  return cmp(anchor, budgetEnd) <= 0 ? anchor : budgetStart;
}

/** First scheduled execution on or after `date` within the item range, or null (used when dates shift). */
export function firstExecutionOnOrAfter(input: ScheduleInput, date: Temporal.PlainDate): Temporal.PlainDate | null {
  return executionDates(input).find((d) => cmp(d, date) >= 0) ?? null;
}
