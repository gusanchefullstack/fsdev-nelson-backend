import type { FlowKind } from '../generated/prisma/enums.js';
import { Decimal, toMoneyString } from '../lib/money.js';
import { toPlainDate } from '../lib/temporal.js';

export interface TotalsBucket {
  itemId: string;
  kind: FlowKind;
  isSystem: boolean;
  startDate: Date;
  estimatedAmount: Decimal;
  actualAmount: Decimal;
}

/**
 * To-date totals (FR-035): expected counts buckets that have started; actual counts everything recorded.
 * Actuals on the system Unplanned items are reported separately as "unbudgeted" (FR-033a).
 */
export function computeTotals(buckets: TotalsBucket[], today: Temporal.PlainDate) {
  const zero = () => new Decimal(0);
  const t = {
    expectedIncomeToDate: zero(),
    actualIncomeToDate: zero(),
    expectedExpenseToDate: zero(),
    actualExpenseToDate: zero(),
    unbudgetedIncome: zero(),
    unbudgetedExpense: zero(),
  };
  const items = new Map<string, { expected: Decimal; actual: Decimal }>();
  for (const b of buckets) {
    const started = Temporal.PlainDate.compare(toPlainDate(b.startDate), today) <= 0;
    const expected = started ? b.estimatedAmount : zero();
    const income = b.kind === 'INCOME';
    if (income) {
      t.expectedIncomeToDate = t.expectedIncomeToDate.add(expected);
      t.actualIncomeToDate = t.actualIncomeToDate.add(b.actualAmount);
      if (b.isSystem) t.unbudgetedIncome = t.unbudgetedIncome.add(b.actualAmount);
    } else {
      t.expectedExpenseToDate = t.expectedExpenseToDate.add(expected);
      t.actualExpenseToDate = t.actualExpenseToDate.add(b.actualAmount);
      if (b.isSystem) t.unbudgetedExpense = t.unbudgetedExpense.add(b.actualAmount);
    }
    const it = items.get(b.itemId) ?? { expected: zero(), actual: zero() };
    items.set(b.itemId, { expected: it.expected.add(expected), actual: it.actual.add(b.actualAmount) });
  }
  return {
    budget: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, toMoneyString(v)])) as Record<keyof typeof t, string>,
    items: new Map(
      [...items].map(([id, v]) => [id, { expectedToDate: toMoneyString(v.expected), actualToDate: toMoneyString(v.actual) }]),
    ),
  };
}
