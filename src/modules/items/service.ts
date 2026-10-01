import { deleteTransactionsWhere } from '../../domain/cleanup.js';
import { getOwnedCategory, getOwnedItem } from '../../domain/ownership.js';
import { createItemBuckets, regenerateItemBuckets } from '../../domain/regenerate.js';
import { serializeBucket, serializeItem } from '../../domain/serialize.js';
import { AppError } from '../../errors.js';
import { newId } from '../../lib/ids.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { todayIn } from '../../lib/temporal.js';
import { resolveItemData } from './rules.js';
import type { ItemInput } from './schemas.js';

const systemError = () =>
  new AppError(409, 'SYSTEM_RECORD', 'The Unplanned item can only have its amount changed.');

export async function createItemIn(tx: Tx, category: { id: string; kind: 'INCOME' | 'EXPENSE'; budget: Parameters<typeof resolveItemData>[1] }, input: ItemInput) {
  const { data, adjustments } = resolveItemData(input, category.budget);
  const item = await tx.budgetItem.create({ data: { id: newId(), categoryId: category.id, ...data } });
  await createItemBuckets(tx, item.id);
  return { item, adjustments };
}

export async function create(userId: string, categoryId: string, input: ItemInput) {
  const category = await getOwnedCategory(prisma, userId, categoryId);
  const { item, adjustments } = await prisma.$transaction((tx) => createItemIn(tx, category, input));
  return serializeItem(item, { kind: category.kind, currency: category.budget.currency }, { adjustments });
}

export async function get(userId: string, id: string, timeZone: string) {
  const item = await getOwnedItem(prisma, userId, id);
  const buckets = await prisma.bucket.findMany({ where: { itemId: id }, orderBy: { sequence: 'asc' } });
  const today = todayIn(timeZone);
  const currency = item.category.budget.currency;
  return serializeItem(
    item,
    { kind: item.category.kind, currency },
    { budgetId: item.category.budgetId, categoryName: item.category.name, buckets: buckets.map((b) => serializeBucket(b, currency, today)) },
  );
}

const SCHEDULE_FIELDS = ['startDate', 'endDate', 'estimatedExecutionDate', 'frequency', 'customInterval', 'customUnit'] as const;

export async function update(userId: string, id: string, input: ItemInput, timeZone: string) {
  const existing = await getOwnedItem(prisma, userId, id);
  const budget = existing.category.budget;
  if (existing.isSystem) {
    // Only the allowance amount of an Unplanned item can change (FR-033)
    const changed =
      input.name !== existing.name ||
      (input.frequency && input.frequency !== existing.frequency) ||
      (input.startDate && input.startDate !== existing.startDate.toISOString().slice(0, 10)) ||
      (input.endDate && input.endDate !== existing.endDate.toISOString().slice(0, 10));
    if (changed) throw systemError();
    const amount = Number(input.estimatedAmount);
    if (!(amount >= 0)) throw new AppError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', { estimatedAmount: 'Amount cannot be negative' });
    await prisma.$transaction([
      prisma.budgetItem.update({ where: { id }, data: { estimatedAmount: input.estimatedAmount } }),
      prisma.bucket.updateMany({ where: { itemId: id }, data: { estimatedAmount: input.estimatedAmount } }),
    ]);
    return get(userId, id, timeZone);
  }

  const { data, adjustments } = resolveItemData(input, budget);
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => String(data[f]) !== String(existing[f]));
  await prisma.$transaction(async (tx) => {
    await tx.budgetItem.update({ where: { id }, data });
    if (scheduleChanged) {
      await regenerateItemBuckets(tx, id);
    } else if (!data.estimatedAmount.equals(existing.estimatedAmount)) {
      await tx.bucket.updateMany({ where: { itemId: id }, data: { estimatedAmount: data.estimatedAmount } });
    }
  });
  return { ...(await get(userId, id, timeZone)), adjustments };
}

export async function remove(userId: string, id: string) {
  const item = await getOwnedItem(prisma, userId, id);
  if (item.isSystem) throw new AppError(409, 'SYSTEM_RECORD', "The Unplanned item can't be deleted.");
  await prisma.$transaction(async (tx) => {
    await deleteTransactionsWhere(tx, { itemId: id });
    await tx.budgetItem.delete({ where: { id } });
  });
}

export async function deletionImpact(userId: string, id: string) {
  await getOwnedItem(prisma, userId, id);
  const [buckets, transactions] = await Promise.all([
    prisma.bucket.count({ where: { itemId: id } }),
    prisma.transaction.count({ where: { itemId: id } }),
  ]);
  return { categories: 0, items: 1, buckets, transactions };
}
