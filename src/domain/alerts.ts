import type { FlowKind } from '../generated/prisma/enums.js';

/**
 * Item-level condition (FR-042): expenses alert as soon as they exceed the estimate by more than the
 * threshold; income alerts only after the bucket ends short. Zero estimates never alert (FR-033a).
 */
export function bucketBreach(b: { kind: FlowKind; expected: number; actual: number; thresholdPct: number; ended: boolean }): boolean {
  if (b.expected <= 0) return false;
  const t = b.thresholdPct / 100;
  return b.kind === 'EXPENSE' ? b.actual > b.expected * (1 + t) : b.ended && b.actual < b.expected * (1 - t);
}

/**
 * Budget-level condition on cumulative totals. For income, callers pass only closed buckets so a
 * paycheck that simply hasn't arrived yet this month doesn't raise an alert.
 */
export function budgetBreach(b: { kind: FlowKind; expected: number; actual: number; thresholdPct: number }): boolean {
  if (b.expected <= 0) return false;
  const t = b.thresholdPct / 100;
  return b.kind === 'EXPENSE' ? b.actual > b.expected * (1 + t) : b.actual < b.expected * (1 - t);
}
