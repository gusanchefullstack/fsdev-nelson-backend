import type { Bucket, BudgetItem, Category, Currency, FlowKind } from '../generated/prisma/client.js';
import { toMoneyString } from '../lib/money.js';
import { isoDate, toPlainDate } from '../lib/temporal.js';

export type BucketStatus = 'PAST' | 'CURRENT' | 'FUTURE';

export function bucketStatus(bucket: Pick<Bucket, 'startDate' | 'endDate'>, today: Temporal.PlainDate): BucketStatus {
  if (Temporal.PlainDate.compare(toPlainDate(bucket.endDate), today) < 0) return 'PAST';
  if (Temporal.PlainDate.compare(toPlainDate(bucket.startDate), today) > 0) return 'FUTURE';
  return 'CURRENT';
}

export function serializeBucket(b: Bucket, currency: Currency, today: Temporal.PlainDate) {
  return {
    id: b.id,
    sequence: b.sequence,
    startDate: isoDate(b.startDate),
    endDate: isoDate(b.endDate),
    estimatedExecutionDate: isoDate(b.estimatedExecutionDate),
    estimatedAmount: toMoneyString(b.estimatedAmount),
    actualAmount: toMoneyString(b.actualAmount),
    actualDate: b.actualDate ? isoDate(b.actualDate) : null,
    currency,
    status: bucketStatus(b, today),
    over: b.actualAmount.greaterThan(b.estimatedAmount),
  };
}

export function serializeItem(
  item: BudgetItem,
  ctx: { kind: FlowKind; currency: Currency },
  extra: Record<string, unknown> = {},
) {
  return {
    id: item.id,
    categoryId: item.categoryId,
    kind: ctx.kind,
    currency: ctx.currency,
    isSystem: item.isSystem,
    name: item.name,
    description: item.description,
    startDate: isoDate(item.startDate),
    endDate: isoDate(item.endDate),
    estimatedAmount: toMoneyString(item.estimatedAmount),
    estimatedExecutionDate: isoDate(item.estimatedExecutionDate),
    frequency: item.frequency,
    customInterval: item.customInterval,
    customUnit: item.customUnit,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    ...extra,
  };
}

export function serializeCategory(c: Category, items: ReturnType<typeof serializeItem>[] = []) {
  return {
    id: c.id,
    budgetId: c.budgetId,
    kind: c.kind,
    name: c.name,
    description: c.description,
    isSystem: c.isSystem,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    items,
  };
}
