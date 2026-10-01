import { describe, expect, it } from 'vitest';
import { budgetBreach, bucketBreach } from '../../src/domain/alerts.js';

describe('bucketBreach (FR-042)', () => {
  it('flags expenses more than the threshold over', () => {
    expect(bucketBreach({ kind: 'EXPENSE', expected: 100, actual: 111, thresholdPct: 10, ended: false })).toBe(true);
    expect(bucketBreach({ kind: 'EXPENSE', expected: 100, actual: 110, thresholdPct: 10, ended: false })).toBe(false);
  });

  it('flags income shortfalls only once the bucket has ended', () => {
    expect(bucketBreach({ kind: 'INCOME', expected: 1000, actual: 899, thresholdPct: 10, ended: true })).toBe(true);
    expect(bucketBreach({ kind: 'INCOME', expected: 1000, actual: 899, thresholdPct: 10, ended: false })).toBe(false);
    expect(bucketBreach({ kind: 'INCOME', expected: 1000, actual: 900, thresholdPct: 10, ended: true })).toBe(false);
  });

  it('never flags items with a zero estimate (Unplanned without allowance)', () => {
    expect(bucketBreach({ kind: 'EXPENSE', expected: 0, actual: 500, thresholdPct: 10, ended: true })).toBe(false);
    expect(bucketBreach({ kind: 'INCOME', expected: 0, actual: 0, thresholdPct: 10, ended: true })).toBe(false);
  });

  it('respects other thresholds', () => {
    expect(bucketBreach({ kind: 'EXPENSE', expected: 100, actual: 104, thresholdPct: 3, ended: false })).toBe(true);
    expect(bucketBreach({ kind: 'EXPENSE', expected: 100, actual: 140, thresholdPct: 50, ended: false })).toBe(false);
  });
});

describe('budgetBreach (FR-042)', () => {
  it('flags cumulative overspending, including unplanned actuals', () => {
    expect(budgetBreach({ kind: 'EXPENSE', expected: 3000, actual: 3301, thresholdPct: 10 })).toBe(true);
    expect(budgetBreach({ kind: 'EXPENSE', expected: 3000, actual: 3300, thresholdPct: 10 })).toBe(false);
  });

  it('flags cumulative income shortfalls', () => {
    expect(budgetBreach({ kind: 'INCOME', expected: 8000, actual: 7100, thresholdPct: 10 })).toBe(true);
    expect(budgetBreach({ kind: 'INCOME', expected: 8000, actual: 7300, thresholdPct: 10 })).toBe(false);
  });

  it('does nothing before anything is expected', () => {
    expect(budgetBreach({ kind: 'EXPENSE', expected: 0, actual: 100, thresholdPct: 10 })).toBe(false);
  });
});
