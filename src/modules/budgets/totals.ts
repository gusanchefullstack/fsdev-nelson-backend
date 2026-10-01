import { computeTotals, type TotalsBucket } from '../../domain/totals.js';
import { prisma } from '../../lib/prisma.js';

/** Loads a budget's buckets and computes budget- and item-level to-date totals. */
export async function budgetTotals(budgetId: string, today: Temporal.PlainDate) {
  const buckets = await prisma.bucket.findMany({
    where: { item: { category: { budgetId } } },
    select: {
      itemId: true,
      startDate: true,
      endDate: true,
      estimatedAmount: true,
      actualAmount: true,
      item: { select: { isSystem: true, category: { select: { kind: true } } } },
    },
  });
  const rows: TotalsBucket[] = buckets.map((b) => ({
    itemId: b.itemId,
    kind: b.item.category.kind,
    isSystem: b.item.isSystem,
    startDate: b.startDate,
    estimatedAmount: b.estimatedAmount,
    actualAmount: b.actualAmount,
  }));
  return computeTotals(rows, today);
}
