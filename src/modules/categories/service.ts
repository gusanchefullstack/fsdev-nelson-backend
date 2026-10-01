import { deleteTransactionsWhere } from '../../domain/cleanup.js';
import { getOwnedBudget, getOwnedCategory } from '../../domain/ownership.js';
import { serializeCategory } from '../../domain/serialize.js';
import { AppError } from '../../errors.js';
import { newId } from '../../lib/ids.js';
import { prisma } from '../../lib/prisma.js';
import type { CategoryCreate, CategoryUpdate } from './schemas.js';

const systemError = (verb: string) =>
  new AppError(409, 'SYSTEM_RECORD', `The Unplanned category can't be ${verb}.`);

export async function create(userId: string, budgetId: string, input: CategoryCreate) {
  await getOwnedBudget(prisma, userId, budgetId);
  const category = await prisma.category.create({ data: { id: newId(), budgetId, ...input } });
  return serializeCategory(category);
}

export async function update(userId: string, id: string, input: CategoryUpdate) {
  const existing = await getOwnedCategory(prisma, userId, id);
  if (existing.isSystem) throw systemError('renamed');
  const category = await prisma.category.update({ where: { id }, data: input });
  return serializeCategory(category);
}

export async function remove(userId: string, id: string) {
  const existing = await getOwnedCategory(prisma, userId, id);
  if (existing.isSystem) throw systemError('deleted');
  await prisma.$transaction(async (tx) => {
    await deleteTransactionsWhere(tx, { item: { categoryId: id } });
    await tx.category.delete({ where: { id } });
  });
}

export async function deletionImpact(userId: string, id: string) {
  await getOwnedCategory(prisma, userId, id);
  const [items, buckets, transactions] = await Promise.all([
    prisma.budgetItem.count({ where: { categoryId: id } }),
    prisma.bucket.count({ where: { item: { categoryId: id } } }),
    prisma.transaction.count({ where: { item: { categoryId: id } } }),
  ]);
  return { categories: 0, items, buckets, transactions };
}
