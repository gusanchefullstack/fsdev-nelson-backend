import { AppError } from '../errors.js';
import { newId } from '../lib/ids.js';
import type { Tx } from '../lib/prisma.js';
import { fromPlainDate, isoDate, toPlainDate } from '../lib/temporal.js';
import { generateBuckets } from './buckets.js';
import { runAlertHook } from './hooks.js';

/** Recomputes a bucket's actual amount (sum) and actual date (latest transaction). */
export async function recomputeBucket(tx: Tx, bucketId: string): Promise<void> {
  const agg = await tx.transaction.aggregate({
    where: { bucketId },
    _sum: { amount: true },
    _max: { localDate: true },
  });
  await tx.bucket.update({
    where: { id: bucketId },
    data: { actualAmount: agg._sum.amount ?? 0, actualDate: agg._max.localDate },
  });
}

/** Creates the buckets for a newly created item. */
export async function createItemBuckets(tx: Tx, itemId: string): Promise<void> {
  const item = await tx.budgetItem.findUniqueOrThrow({ where: { id: itemId } });
  const windows = generateBuckets({
    startDate: toPlainDate(item.startDate),
    endDate: toPlainDate(item.endDate),
    estimatedExecutionDate: toPlainDate(item.estimatedExecutionDate),
    frequency: item.frequency,
    customInterval: item.customInterval,
    customUnit: item.customUnit,
  });
  await tx.bucket.createMany({
    data: windows.map((w) => ({
      id: newId(),
      itemId,
      sequence: w.sequence,
      startDate: fromPlainDate(w.startDate),
      endDate: fromPlainDate(w.endDate),
      estimatedExecutionDate: fromPlainDate(w.estimatedExecutionDate),
      estimatedAmount: item.estimatedAmount,
    })),
  });
}

/**
 * Rebuilds an item's buckets after its schedule changed (data-model "Bucket regeneration"):
 * insert new buckets → move transactions → recompute → delete old buckets → re-evaluate alerts.
 * Runs inside the caller's transaction so any failure rolls everything back.
 */
export async function regenerateItemBuckets(tx: Tx, itemId: string): Promise<void> {
  const item = await tx.budgetItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { category: { select: { budgetId: true } } },
  });
  const old = await tx.bucket.findMany({ where: { itemId }, select: { id: true } });
  // Free the (itemId, sequence) slots for the new rows
  await tx.bucket.updateMany({ where: { itemId }, data: { sequence: { decrement: 100_000 } } });

  const windows = generateBuckets({
    startDate: toPlainDate(item.startDate),
    endDate: toPlainDate(item.endDate),
    estimatedExecutionDate: toPlainDate(item.estimatedExecutionDate),
    frequency: item.frequency,
    customInterval: item.customInterval,
    customUnit: item.customUnit,
  });
  const fresh = windows.map((w) => ({
    id: newId(),
    itemId,
    sequence: w.sequence,
    startDate: fromPlainDate(w.startDate),
    endDate: fromPlainDate(w.endDate),
    estimatedExecutionDate: fromPlainDate(w.estimatedExecutionDate),
    estimatedAmount: item.estimatedAmount,
  }));
  await tx.bucket.createMany({ data: fresh });

  const transactions = await tx.transaction.findMany({ where: { itemId }, select: { id: true, localDate: true } });
  const touched = new Set<string>();
  for (const t of transactions) {
    const target = fresh.find((b) => b.startDate <= t.localDate && t.localDate <= b.endDate);
    if (!target) {
      throw new AppError(
        409,
        'TRANSACTIONS_OUT_OF_RANGE',
        `This change would leave a transaction from ${isoDate(t.localDate)} outside "${item.name}". Adjust the dates or move that transaction first.`,
      );
    }
    await tx.transaction.update({ where: { id: t.id }, data: { bucketId: target.id } });
    touched.add(target.id);
  }
  // New buckets start at 0; only those that received transactions need recomputing
  for (const id of touched) await recomputeBucket(tx, id);
  await tx.bucket.deleteMany({ where: { id: { in: old.map((b) => b.id) } } });
  await runAlertHook(tx, item.category.budgetId, fresh.map((b) => b.id));
}
