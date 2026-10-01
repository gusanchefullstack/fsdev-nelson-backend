import { describe, expect, it } from 'vitest';
import { findInsights, groupByMonth, projectItem, type ForecastBucket } from '../../src/domain/forecast.js';

const b = (status: ForecastBucket['status'], est: number, act: number, exec = '2027-01-20'): ForecastBucket => ({
  status,
  estimatedAmount: est,
  actualAmount: act,
  estimatedExecutionDate: exec,
});

describe('projectItem (FR-039)', () => {
  it('scales the remaining plan by the actual/expected ratio of closed buckets', () => {
    // Closed buckets ran 10% over → remaining 2 × 100 projected at 110 each
    const p = projectItem([b('PAST', 100, 110), b('PAST', 100, 110), b('CURRENT', 100, 0), b('FUTURE', 100, 0)]);
    expect(p.ratio).toBeCloseTo(1.1);
    expect(p.planned).toBe(400);
    expect(p.actualToDate).toBe(220);
    expect(p.projected).toBeCloseTo(440);
  });

  it('uses the plan as-is when no bucket has closed', () => {
    const p = projectItem([b('CURRENT', 50, 0), b('FUTURE', 50, 0)]);
    expect(p.ratio).toBe(1);
    expect(p.projected).toBe(100);
  });

  it('counts partial actuals in the current bucket instead of projecting it', () => {
    const p = projectItem([b('PAST', 100, 100), b('CURRENT', 100, 40), b('FUTURE', 100, 0)]);
    expect(p.projected).toBe(240);
  });

  it('treats a zero plan (Unplanned) as ratio 1 and projects only actuals', () => {
    const p = projectItem([b('PAST', 0, 300), b('FUTURE', 0, 0)]);
    expect(p.ratio).toBe(1);
    expect(p.projected).toBe(300);
  });
});

describe('findInsights (FR-040)', () => {
  const netflix = { itemId: 'n', itemName: 'Netflix', kind: 'EXPENSE' as const, isSystem: false };

  it('flags items deviating beyond the threshold in at least half of closed buckets', () => {
    const insights = findInsights(
      [{ ...netflix, buckets: [b('PAST', 20, 23), b('PAST', 20, 24), b('PAST', 20, 23), b('PAST', 20, 20), b('FUTURE', 20, 0)] }],
      10,
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ itemName: 'Netflix', deviatingBuckets: 3, completedBuckets: 4 });
    expect(insights[0]!.suggestion).toMatch(/Netflix was over its estimate in 3 of 4 buckets/);
  });

  it('ignores items within the threshold, items without closed buckets, and zero estimates', () => {
    expect(
      findInsights(
        [
          { ...netflix, buckets: [b('PAST', 20, 21), b('PAST', 20, 30)] }, // 1 of 2 → 50% → flagged
          { ...netflix, itemId: 'ok', itemName: 'Ok', buckets: [b('PAST', 20, 21), b('PAST', 20, 20.5)] },
          { ...netflix, itemId: 'fut', itemName: 'Future', buckets: [b('FUTURE', 20, 0)] },
          { ...netflix, itemId: 'zero', itemName: 'Unplanned', buckets: [b('PAST', 0, 300)] },
        ],
        10,
      ).map((i) => i.itemName),
    ).toEqual(['Netflix']);
  });

  it('words income shortfalls differently', () => {
    const [i] = findInsights([{ itemId: 's', itemName: 'Dividends', kind: 'INCOME', isSystem: false, buckets: [b('PAST', 600, 400), b('PAST', 600, 450)] }], 10);
    expect(i!.suggestion).toMatch(/Dividends came in below its estimate in 2 of 2 buckets/);
  });
});

describe('groupByMonth', () => {
  it('sums expected by execution month and actual by transaction month', () => {
    const rows = groupByMonth(
      [
        { kind: 'EXPENSE', date: '2027-01-20', amount: 100 },
        { kind: 'EXPENSE', date: '2027-02-20', amount: 100 },
      ],
      [
        { kind: 'EXPENSE', date: '2027-01-18', amount: 90 },
        { kind: 'EXPENSE', date: '2027-01-30', amount: 15 },
      ],
    );
    expect(rows).toEqual([
      { period: '2027-01', kind: 'EXPENSE', expected: 100, actual: 105 },
      { period: '2027-02', kind: 'EXPENSE', expected: 100, actual: 0 },
    ]);
  });
});
