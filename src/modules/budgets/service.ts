import { firstExecutionOnOrAfter, unplannedAnchor } from '../../domain/buckets.js';
import { deleteTransactionsWhere } from '../../domain/cleanup.js';
import { getOwnedBudget } from '../../domain/ownership.js';
import { createItemBuckets, regenerateItemBuckets } from '../../domain/regenerate.js';
import { serializeBucket, serializeCategory, serializeItem } from '../../domain/serialize.js';
import { AppError } from '../../errors.js';
import type { Budget, Currency } from '../../generated/prisma/client.js';
import { newId } from '../../lib/ids.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { fromPlainDate, isoDate, toPlainDate, todayIn } from '../../lib/temporal.js';
import { createItemIn } from '../items/service.js';
import type { BudgetCreate, BudgetUpdate } from './schemas.js';
import { budgetTotals } from './totals.js';

const cmp = (a: Temporal.PlainDate, b: Temporal.PlainDate) => Temporal.PlainDate.compare(a, b);

const overlapError = () =>
  new AppError(
    409,
    'BUDGET_OVERLAP',
    "You already have a budget in this currency for part of this period. Choose dates that don't overlap.",
    { startDate: 'Overlaps another budget', endDate: 'Overlaps another budget' },
  );

async function assertNoOverlap(userId: string, currency: Currency, start: string, end: string, exceptId?: string) {
  const clash = await prisma.budget.findFirst({
    where: {
      userId,
      currency,
      id: exceptId ? { not: exceptId } : undefined,
      startDate: { lte: new Date(`${end}T00:00:00Z`) },
      endDate: { gte: new Date(`${start}T00:00:00Z`) },
    },
    select: { id: true },
  });
  if (clash) throw overlapError();
}

const UNPLANNED = {
  INCOME: 'Income you did not plan for, such as gifts or refunds.',
  EXPENSE: 'Spending you did not plan for.',
} as const;

/** Adds the protected "Unplanned" income and expense categories with their items (FR-033). */
async function createUnplanned(tx: Tx, budget: Budget) {
  const start = toPlainDate(budget.startDate);
  const end = toPlainDate(budget.endDate);
  for (const kind of ['INCOME', 'EXPENSE'] as const) {
    const category = await tx.category.create({
      data: { id: newId(), budgetId: budget.id, kind, name: 'Unplanned', isSystem: true },
    });
    const item = await tx.budgetItem.create({
      data: {
        id: newId(),
        categoryId: category.id,
        name: 'Unplanned',
        description: UNPLANNED[kind],
        startDate: budget.startDate,
        endDate: budget.endDate,
        estimatedAmount: 0,
        estimatedExecutionDate: fromPlainDate(unplannedAnchor(start, end)),
        frequency: 'MONTHLY',
        isSystem: true,
      },
    });
    await createItemBuckets(tx, item.id);
  }
}

function serializeSummary(budget: Budget, timeZone: string, totals: Awaited<ReturnType<typeof budgetTotals>>['budget']) {
  const today = todayIn(timeZone);
  return {
    id: budget.id,
    name: budget.name,
    description: budget.description,
    currency: budget.currency,
    startDate: isoDate(budget.startDate),
    endDate: isoDate(budget.endDate),
    alertThresholdPct: budget.alertThresholdPct,
    isActive: cmp(toPlainDate(budget.startDate), today) <= 0 && cmp(today, toPlainDate(budget.endDate)) <= 0,
    totals,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

export async function list(userId: string, timeZone: string) {
  const budgets = await prisma.budget.findMany({ where: { userId }, orderBy: { startDate: 'desc' } });
  const today = todayIn(timeZone);
  return Promise.all(budgets.map(async (b) => serializeSummary(b, timeZone, (await budgetTotals(b.id, today)).budget)));
}

export async function get(userId: string, id: string, timeZone: string) {
  const budget = await getOwnedBudget(prisma, userId, id);
  const today = todayIn(timeZone);
  const categories = await prisma.category.findMany({
    where: { budgetId: id },
    orderBy: [{ isSystem: 'asc' }, { createdAt: 'asc' }],
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  const totals = await budgetTotals(id, today);
  // The bucket open today (or the next one) for each item, for compact gauges
  const todayDate = fromPlainDate(today);
  const current = await prisma.bucket.findMany({
    where: { item: { category: { budgetId: id } }, endDate: { gte: todayDate } },
    orderBy: { startDate: 'asc' },
    distinct: ['itemId'],
  });
  const currentByItem = new Map(current.map((b) => [b.itemId, serializeBucket(b, budget.currency, today)]));
  return {
    ...serializeSummary(budget, timeZone, totals.budget),
    categories: categories.map((c) =>
      serializeCategory(
        c,
        c.items.map((i) =>
          serializeItem(i, { kind: c.kind, currency: budget.currency }, { ...totals.items.get(i.id), currentBucket: currentByItem.get(i.id) ?? null }),
        ),
      ),
    ),
  };
}

export async function create(userId: string, input: BudgetCreate, timeZone: string) {
  await assertNoOverlap(userId, input.currency, input.startDate, input.endDate);
  const adjustments: { path: string; adjustment: string }[] = [];
  const budget = await prisma.$transaction(
    async (tx) => {
      const budget = await tx.budget.create({
        data: {
          id: newId(),
          userId,
          name: input.name,
          description: input.description ?? null,
          currency: input.currency,
          startDate: new Date(`${input.startDate}T00:00:00Z`),
          endDate: new Date(`${input.endDate}T00:00:00Z`),
          alertThresholdPct: input.alertThresholdPct,
        },
      });
      await createUnplanned(tx, budget);
      // Guided / Complete modes send the whole tree; it is saved atomically (FR-022)
      for (const [ci, c] of input.categories.entries()) {
        const category = await tx.category.create({
          data: { id: newId(), budgetId: budget.id, kind: c.kind, name: c.name, description: c.description ?? null },
        });
        for (const [ii, item] of c.items.entries()) {
          try {
            const res = await createItemIn(tx, { ...category, budget }, item);
            res.adjustments.forEach((a) => adjustments.push({ path: `categories.${ci}.items.${ii}`, adjustment: a }));
          } catch (e) {
            if (e instanceof AppError && e.fields) {
              const fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [`categories.${ci}.items.${ii}.${k}`, v]));
              throw new AppError(e.status, e.code, e.message, fields);
            }
            throw e;
          }
        }
      }
      return budget;
    },
    { timeout: 30_000 },
  );
  return { ...(await get(userId, budget.id, timeZone)), adjustments };
}

/** Shifts a regular item into new budget dates, keeping its schedule pattern. */
function fitItem(
  item: { name: string; startDate: Date; endDate: Date; estimatedExecutionDate: Date; frequency: Parameters<typeof firstExecutionOnOrAfter>[0]['frequency']; customInterval: number | null; customUnit: Parameters<typeof firstExecutionOnOrAfter>[0]['customUnit'] },
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
) {
  const itemStart = toPlainDate(item.startDate);
  const itemEnd = toPlainDate(item.endDate);
  const newStart = cmp(itemStart, start) < 0 ? start : itemStart;
  const newEnd = cmp(itemEnd, end) > 0 ? end : itemEnd;
  const outside = () =>
    new AppError(422, 'VALIDATION_FAILED', `"${item.name}" would fall outside the new dates. Adjust or delete it first.`, {
      startDate: 'Conflicts with an item',
      endDate: 'Conflicts with an item',
    });
  if (cmp(newStart, newEnd) > 0) throw outside();
  let exec: Temporal.PlainDate | null = toPlainDate(item.estimatedExecutionDate);
  if (cmp(exec, newStart) < 0) {
    exec = firstExecutionOnOrAfter(
      { startDate: itemStart, endDate: newEnd, estimatedExecutionDate: exec, frequency: item.frequency, customInterval: item.customInterval, customUnit: item.customUnit },
      newStart,
    );
  }
  if (!exec || cmp(exec, newEnd) > 0) throw outside();
  return { startDate: fromPlainDate(newStart), endDate: fromPlainDate(newEnd), estimatedExecutionDate: fromPlainDate(exec) };
}

export async function update(userId: string, id: string, input: BudgetUpdate, timeZone: string) {
  const existing = await getOwnedBudget(prisma, userId, id);
  const startStr = input.startDate ?? isoDate(existing.startDate);
  const endStr = input.endDate ?? isoDate(existing.endDate);
  if (endStr <= startStr) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', { endDate: 'End date must be after the start date' });
  }
  const datesChanged = startStr !== isoDate(existing.startDate) || endStr !== isoDate(existing.endDate);
  if (datesChanged) await assertNoOverlap(userId, existing.currency, startStr, endStr, id);

  await prisma.$transaction(
    async (tx) => {
      const budget = await tx.budget.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          alertThresholdPct: input.alertThresholdPct,
          startDate: new Date(`${startStr}T00:00:00Z`),
          endDate: new Date(`${endStr}T00:00:00Z`),
        },
      });
      if (!datesChanged) return;
      const start = toPlainDate(budget.startDate);
      const end = toPlainDate(budget.endDate);
      const items = await tx.budgetItem.findMany({ where: { category: { budgetId: id } } });
      for (const item of items) {
        const data = item.isSystem
          ? { startDate: budget.startDate, endDate: budget.endDate, estimatedExecutionDate: fromPlainDate(unplannedAnchor(start, end)) }
          : fitItem(item, start, end);
        const changed =
          data.startDate.getTime() !== item.startDate.getTime() ||
          data.endDate.getTime() !== item.endDate.getTime() ||
          data.estimatedExecutionDate.getTime() !== item.estimatedExecutionDate.getTime();
        if (!changed) continue;
        await tx.budgetItem.update({ where: { id: item.id }, data });
        await regenerateItemBuckets(tx, item.id);
      }
    },
    { timeout: 30_000 },
  );
  return get(userId, id, timeZone);
}

export async function remove(userId: string, id: string) {
  await getOwnedBudget(prisma, userId, id);
  await prisma.$transaction(async (tx) => {
    await deleteTransactionsWhere(tx, { item: { category: { budgetId: id } } });
    await tx.budget.delete({ where: { id } });
  });
}

export async function deletionImpact(userId: string, id: string) {
  await getOwnedBudget(prisma, userId, id);
  const scope = { category: { budgetId: id } };
  const [categories, items, buckets, transactions] = await Promise.all([
    prisma.category.count({ where: { budgetId: id } }),
    prisma.budgetItem.count({ where: scope }),
    prisma.bucket.count({ where: { item: scope } }),
    prisma.transaction.count({ where: { item: scope } }),
  ]);
  return { categories, items, buckets, transactions };
}
