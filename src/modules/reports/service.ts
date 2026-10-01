import { findInsights, groupByMonth, projectItem, type ForecastBucket } from '../../domain/forecast.js';
import { getOwnedBudget } from '../../domain/ownership.js';
import { bucketStatus } from '../../domain/serialize.js';
import { AppError } from '../../errors.js';
import type { FlowKind } from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import { isoDate, todayIn } from '../../lib/temporal.js';

const m = (x: number) => x.toFixed(2);

async function loadBudget(userId: string, budgetId: string, timeZone: string) {
  const budget = await getOwnedBudget(prisma, userId, budgetId);
  const items = await prisma.budgetItem.findMany({
    where: { category: { budgetId } },
    include: { category: { select: { id: true, kind: true, name: true } }, buckets: { orderBy: { sequence: 'asc' } } },
  });
  const today = todayIn(timeZone);
  return {
    budget,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      isSystem: i.isSystem,
      kind: i.category.kind,
      categoryId: i.category.id,
      buckets: i.buckets.map(
        (b): ForecastBucket => ({
          status: bucketStatus(b, today),
          estimatedAmount: b.estimatedAmount.toNumber(),
          actualAmount: b.actualAmount.toNumber(),
          estimatedExecutionDate: isoDate(b.estimatedExecutionDate),
        }),
      ),
    })),
  };
}

/** Expected vs actual per month at budget, category or item level (FR-038). */
export async function forecastVsActual(userId: string, budgetId: string, level: 'budget' | 'category' | 'item', targetId: string | undefined, timeZone: string) {
  const { budget, items } = await loadBudget(userId, budgetId, timeZone);
  if (level !== 'budget' && !targetId) throw new AppError(422, 'VALIDATION_FAILED', 'Choose a category or item.', { targetId: 'Required' });
  const selected = items.filter((i) => level === 'budget' || (level === 'category' ? i.categoryId === targetId : i.id === targetId));
  const ids = selected.map((i) => i.id);
  const transactions = await prisma.transaction.findMany({ where: { itemId: { in: ids } }, select: { kind: true, localDate: true, amount: true } });
  const series = groupByMonth(
    selected.flatMap((i) => i.buckets.map((b) => ({ kind: i.kind, date: b.estimatedExecutionDate, amount: b.estimatedAmount }))),
    transactions.map((t) => ({ kind: t.kind, date: isoDate(t.localDate), amount: t.amount.toNumber() })),
  );
  return { currency: budget.currency, series: series.map((s) => ({ ...s, expected: m(s.expected), actual: m(s.actual) })) };
}

/** Largest incomes and expenses for a date range, by item or by payor/vendor (FR-038). */
export async function topN(userId: string, budgetId: string, q: { n: number; by: 'item' | 'counterparty'; from?: string; to?: string }) {
  const budget = await getOwnedBudget(prisma, userId, budgetId);
  const rows = await prisma.transaction.findMany({
    where: {
      item: { category: { budgetId } },
      localDate: { gte: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, lte: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined },
    },
    select: { kind: true, amount: true, item: { select: { id: true, name: true } }, payor: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } } },
  });
  const rank = (kind: FlowKind) => {
    const groups = new Map<string, { id: string; name: string; amount: number }>();
    for (const r of rows.filter((x) => x.kind === kind)) {
      const key = q.by === 'item' ? r.item : (kind === 'INCOME' ? r.payor : r.vendor)!;
      const g = groups.get(key.id) ?? { id: key.id, name: key.name, amount: 0 };
      g.amount += r.amount.toNumber();
      groups.set(key.id, g);
    }
    const total = [...groups.values()].reduce((s, g) => s + g.amount, 0);
    return [...groups.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, q.n)
      .map((g) => ({ ...g, amount: m(g.amount), sharePct: total ? Math.round((g.amount / total) * 1000) / 10 : 0 }));
  };
  return { currency: budget.currency, incomes: rank('INCOME'), expenses: rank('EXPENSE') };
}

/** End-of-period projection per item and per kind, with unbudgeted amounts (FR-039, FR-033a). */
export async function projection(userId: string, budgetId: string, timeZone: string) {
  const { budget, items } = await loadBudget(userId, budgetId, timeZone);
  const perItem = items.map((i) => ({ itemId: i.id, name: i.name, kind: i.kind, isSystem: i.isSystem, ...projectItem(i.buckets) }));
  const totals = (kind: FlowKind) => {
    const rows = perItem.filter((p) => p.kind === kind);
    const s = (f: (p: (typeof rows)[number]) => number) => rows.reduce((a, p) => a + f(p), 0);
    return {
      planned: m(s((p) => p.planned)),
      actualToDate: m(s((p) => p.actualToDate)),
      projected: m(s((p) => p.projected)),
      unbudgeted: m(s((p) => (p.isSystem ? p.actualToDate : 0))),
    };
  };
  return {
    currency: budget.currency,
    income: totals('INCOME'),
    expense: totals('EXPENSE'),
    items: perItem.map((p) => ({
      ...p,
      planned: m(p.planned),
      actualToDate: m(p.actualToDate),
      projected: m(p.projected),
      unbudgeted: m(p.isSystem ? p.actualToDate : 0),
      ratio: Math.round(p.ratio * 1000) / 1000,
    })),
  };
}

/** Items that keep missing their estimate (FR-040). */
export async function insights(userId: string, budgetId: string, timeZone: string) {
  const { budget, items } = await loadBudget(userId, budgetId, timeZone);
  return findInsights(
    items.filter((i) => !i.isSystem).map((i) => ({ itemId: i.id, itemName: i.name, kind: i.kind, isSystem: i.isSystem, buckets: i.buckets })),
    budget.alertThresholdPct,
  );
}
