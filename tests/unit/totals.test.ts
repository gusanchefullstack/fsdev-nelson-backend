import { describe, expect, it } from 'vitest';
import { computeTotals, type TotalsBucket } from '../../src/domain/totals.js';
import { Decimal } from '../../src/lib/money.js';

const b = (itemId: string, kind: 'INCOME' | 'EXPENSE', start: string, est: string, act: string, isSystem = false): TotalsBucket => ({
  itemId,
  kind,
  isSystem,
  startDate: new Date(`${start}T00:00:00Z`),
  estimatedAmount: new Decimal(est),
  actualAmount: new Decimal(act),
});

describe('computeTotals (FR-035, FR-033a)', () => {
  const today = Temporal.PlainDate.from('2027-03-10');
  const buckets = [
    b('rent', 'EXPENSE', '2027-01-01', '5000', '5000'),
    b('rent', 'EXPENSE', '2027-02-05', '5000', '5100'),
    b('rent', 'EXPENSE', '2027-03-05', '5000', '0'),
    b('rent', 'EXPENSE', '2027-04-05', '5000', '0'), // not started: not expected yet
    b('salary', 'INCOME', '2027-01-01', '9850', '9850'),
    b('unplanned', 'EXPENSE', '2027-01-31', '0', '300', true),
    b('gift', 'INCOME', '2027-01-31', '0', '50', true),
  ];

  it('counts expected amounts only for buckets that have started', () => {
    const t = computeTotals(buckets, today);
    expect(t.budget.expectedExpenseToDate).toBe('15000.00');
    expect(t.budget.actualExpenseToDate).toBe('10400.00');
    expect(t.budget.expectedIncomeToDate).toBe('9850.00');
    expect(t.budget.actualIncomeToDate).toBe('9900.00');
  });

  it('reports actuals on Unplanned items as unbudgeted', () => {
    const t = computeTotals(buckets, today);
    expect(t.budget.unbudgetedExpense).toBe('300.00');
    expect(t.budget.unbudgetedIncome).toBe('50.00');
  });

  it('gives per-item to-date figures', () => {
    expect(computeTotals(buckets, today).items.get('rent')).toEqual({ expectedToDate: '15000.00', actualToDate: '10100.00' });
  });
});
