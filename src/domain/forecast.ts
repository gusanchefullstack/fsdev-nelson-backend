import type { FlowKind } from '../generated/prisma/enums.js';

export interface ForecastBucket {
  status: 'PAST' | 'CURRENT' | 'FUTURE';
  estimatedAmount: number;
  actualAmount: number;
  estimatedExecutionDate: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * End-of-period projection for one item (FR-039):
 * actual so far + remaining plan scaled by how closed buckets performed (actual / expected).
 */
export function projectItem(buckets: ForecastBucket[]) {
  const past = buckets.filter((b) => b.status === 'PAST');
  const pastExpected = sum(past.map((b) => b.estimatedAmount));
  const ratio = past.length && pastExpected > 0 ? sum(past.map((b) => b.actualAmount)) / pastExpected : 1;
  const actualToDate = sum(buckets.map((b) => b.actualAmount));
  const remaining = sum(buckets.filter((b) => b.status !== 'PAST' && b.actualAmount === 0).map((b) => b.estimatedAmount));
  return {
    planned: round2(sum(buckets.map((b) => b.estimatedAmount))),
    actualToDate: round2(actualToDate),
    projected: round2(actualToDate + remaining * ratio),
    ratio,
  };
}

export interface InsightInput {
  itemId: string;
  itemName: string;
  kind: FlowKind;
  isSystem: boolean;
  buckets: ForecastBucket[];
}

const money = (x: number) => x.toFixed(2);

/** Items whose closed buckets miss the estimate by more than the threshold at least half the time (FR-040). */
export function findInsights(items: InsightInput[], thresholdPct: number) {
  const t = thresholdPct / 100;
  return items.flatMap((item) => {
    const closed = item.buckets.filter((b) => b.status === 'PAST' && b.estimatedAmount > 0);
    if (!closed.length) return [];
    const deviating = closed.filter((b) => Math.abs(b.actualAmount - b.estimatedAmount) / b.estimatedAmount > t);
    if (deviating.length / closed.length < 0.5) return [];
    const avgActual = sum(closed.map((b) => b.actualAmount)) / closed.length;
    const avgDeviationPct = (sum(closed.map((b) => (b.actualAmount - b.estimatedAmount) / b.estimatedAmount)) / closed.length) * 100;
    const over = avgDeviationPct > 0;
    const count = `${deviating.length} of ${closed.length} buckets`;
    let suggestion: string;
    if (item.kind === 'EXPENSE') {
      suggestion = over
        ? `${item.itemName} was over its estimate in ${count}. Consider raising the estimate to ${money(avgActual)} or reviewing the expense.`
        : `${item.itemName} came in under its estimate in ${count}. Consider lowering the estimate to ${money(avgActual)} to free up budget.`;
    } else {
      suggestion = over
        ? `${item.itemName} exceeded its estimate in ${count}. Consider raising the estimate to ${money(avgActual)}.`
        : `${item.itemName} came in below its estimate in ${count}. Consider lowering the estimate to ${money(avgActual)} so your plan stays realistic.`;
    }
    return [
      {
        itemId: item.itemId,
        itemName: item.itemName,
        kind: item.kind,
        deviatingBuckets: deviating.length,
        completedBuckets: closed.length,
        averageDeviationPct: round2(avgDeviationPct),
        suggestion,
      },
    ];
  });
}

interface Point {
  kind: FlowKind;
  date: string;
  amount: number;
}

/** Monthly expected (by bucket execution date) vs actual (by transaction date). */
export function groupByMonth(expected: Point[], actual: Point[]) {
  const rows = new Map<string, { period: string; kind: FlowKind; expected: number; actual: number }>();
  const at = (p: Point) => {
    const period = p.date.slice(0, 7);
    const key = `${period}|${p.kind}`;
    const row = rows.get(key) ?? { period, kind: p.kind, expected: 0, actual: 0 };
    rows.set(key, row);
    return row;
  };
  for (const p of expected) at(p).expected += p.amount;
  for (const p of actual) at(p).actual += p.amount;
  return [...rows.values()]
    .map((r) => ({ ...r, expected: round2(r.expected), actual: round2(r.actual) }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.kind.localeCompare(b.kind));
}
