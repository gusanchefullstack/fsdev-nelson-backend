import { notFound } from '../errors.js';
import type { Db } from '../lib/prisma.js';

// Every lookup is scoped to the signed-in user; other users' ids behave as "not found" (FR-006)

export async function getOwnedBudget(db: Db, userId: string, id: string) {
  const budget = await db.budget.findFirst({ where: { id, userId } });
  if (!budget) throw notFound('budget');
  return budget;
}

export async function getOwnedCategory(db: Db, userId: string, id: string) {
  const category = await db.category.findFirst({ where: { id, budget: { userId } }, include: { budget: true } });
  if (!category) throw notFound('category');
  return category;
}

export async function getOwnedItem(db: Db, userId: string, id: string) {
  const item = await db.budgetItem.findFirst({
    where: { id, category: { budget: { userId } } },
    include: { category: { include: { budget: true } } },
  });
  if (!item) throw notFound('budget item');
  return item;
}
