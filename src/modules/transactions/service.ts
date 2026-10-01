import { findBucket } from '../../domain/allocation.js';
import { runAlertHook } from '../../domain/hooks.js';
import { getOwnedItem } from '../../domain/ownership.js';
import { recomputeBucket } from '../../domain/regenerate.js';
import { serializeBucket } from '../../domain/serialize.js';
import { AppError, notFound } from '../../errors.js';
import type { Prisma, Transaction } from '../../generated/prisma/client.js';
import { newId } from '../../lib/ids.js';
import { toDecimal, toMoneyString } from '../../lib/money.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { fromPlainDate, isoDate, localDateOf, toPlainDate, todayIn } from '../../lib/temporal.js';
import type { ListQuery, TransactionInput } from './schemas.js';

const include = {
  item: { select: { name: true, category: { select: { budgetId: true } } } },
  financialAccount: { select: { id: true, name: true } },
  payor: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude;

type Row = Prisma.TransactionGetPayload<{ include: typeof include }>;

function serialize(t: Row) {
  const account = { id: t.financialAccount.id, name: t.financialAccount.name, type: 'FINANCIAL_ACCOUNT' as const };
  return {
    id: t.id,
    kind: t.kind,
    amount: toMoneyString(t.amount),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    timeZone: t.timeZone,
    localDate: isoDate(t.localDate),
    itemId: t.itemId,
    itemName: t.item.name,
    budgetId: t.item.category.budgetId,
    bucketId: t.bucketId,
    financialAccountId: t.financialAccountId,
    payorId: t.payorId,
    vendorId: t.vendorId,
    note: t.note,
    origin: t.kind === 'INCOME' ? { id: t.payor!.id, name: t.payor!.name, type: 'PAYOR' as const } : account,
    destination: t.kind === 'INCOME' ? account : { id: t.vendor!.id, name: t.vendor!.name, type: 'VENDOR' as const },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const signed = (kind: 'INCOME' | 'EXPENSE', amount: Prisma.Decimal) => (kind === 'INCOME' ? amount : amount.negated());

/** Validates a transaction against its item, budget and money sources; returns the resolved values. */
async function resolve(userId: string, input: TransactionInput, timeZone: string) {
  const item = await getOwnedItem(prisma, userId, input.itemId);
  const budget = item.category.budget;
  if (input.kind !== item.category.kind) {
    throw new AppError(422, 'KIND_MISMATCH', `"${item.name}" is ${item.category.kind === 'INCOME' ? 'an income' : 'an expense'} item. Choose a matching item or change the type.`, {
      itemId: 'Type does not match this item',
    });
  }
  const account = await prisma.financialAccount.findFirst({ where: { id: input.financialAccountId, userId } });
  if (!account) throw notFound('account');
  if (input.kind === 'INCOME' && !(await prisma.payor.findFirst({ where: { id: input.payorId!, userId }, select: { id: true } }))) {
    throw notFound('payor');
  }
  if (input.kind === 'EXPENSE' && !(await prisma.vendor.findFirst({ where: { id: input.vendorId!, userId }, select: { id: true } }))) {
    throw notFound('vendor');
  }
  // FR-032: one currency per budget; no conversion
  if (input.currency !== budget.currency || account.currency !== budget.currency) {
    const field = input.currency !== budget.currency ? 'currency' : 'financialAccountId';
    throw new AppError(
      422,
      'CURRENCY_MISMATCH',
      `This budget uses ${budget.currency}. Record the transaction in ${budget.currency} from an account that holds ${budget.currency}.`,
      { [field]: `Must be ${budget.currency}` },
    );
  }
  const occurredAt = Temporal.Instant.from(input.occurredAt);
  const localDate = localDateOf(occurredAt, timeZone);
  const buckets = await prisma.bucket.findMany({ where: { itemId: item.id }, orderBy: { sequence: 'asc' } });
  const bucket = findBucket(
    buckets.map((b) => ({ ...b, startDate: toPlainDate(b.startDate), endDate: toPlainDate(b.endDate) })),
    localDate,
  );
  if (!bucket) {
    throw new AppError(
      422,
      'OUTSIDE_ITEM_RANGE',
      `"${item.name}" runs from ${isoDate(item.startDate)} to ${isoDate(item.endDate)}. Choose a date in that range, or adjust the item's dates.`,
      { occurredAt: 'Outside the item dates' },
    );
  }
  return {
    budget,
    data: {
      kind: input.kind,
      amount: toDecimal(input.amount),
      currency: input.currency,
      occurredAt: new Date(occurredAt.epochMilliseconds),
      timeZone,
      localDate: fromPlainDate(localDate),
      itemId: item.id,
      bucketId: bucket.id,
      financialAccountId: account.id,
      payorId: input.kind === 'INCOME' ? input.payorId! : null,
      vendorId: input.kind === 'EXPENSE' ? input.vendorId! : null,
      note: input.note ?? null,
    },
  };
}

async function adjustBalance(tx: Tx, accountId: string, delta: Prisma.Decimal) {
  await tx.financialAccount.update({ where: { id: accountId }, data: { currentBalance: { increment: delta } } });
}

async function result(tx: Tx, id: string, budgetId: string, bucketIds: string[], timeZone: string) {
  const newAlerts = await runAlertHook(tx, budgetId, bucketIds);
  const row = await tx.transaction.findUniqueOrThrow({ where: { id }, include });
  const bucket = await tx.bucket.findUniqueOrThrow({ where: { id: row.bucketId } });
  return { transaction: serialize(row), bucket: serializeBucket(bucket, row.currency, todayIn(timeZone)), newAlerts };
}

export async function create(userId: string, input: TransactionInput, profileTimeZone: string) {
  const { budget, data } = await resolve(userId, input, input.timeZone ?? profileTimeZone);
  return prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({ data: { id: newId(), userId, ...data } });
    await recomputeBucket(tx, created.bucketId);
    await adjustBalance(tx, created.financialAccountId, signed(created.kind, created.amount));
    return result(tx, created.id, budget.id, [created.bucketId], profileTimeZone);
  });
}

async function owned(userId: string, id: string): Promise<Transaction> {
  const t = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!t) throw notFound('transaction');
  return t;
}

export async function update(userId: string, id: string, input: TransactionInput, profileTimeZone: string) {
  const existing = await owned(userId, id);
  // FR-031: keep the original zone unless the user explicitly changes it
  const { budget, data } = await resolve(userId, input, input.timeZone ?? existing.timeZone);
  return prisma.$transaction(async (tx) => {
    await adjustBalance(tx, existing.financialAccountId, signed(existing.kind, existing.amount).negated());
    const updated = await tx.transaction.update({ where: { id }, data });
    await adjustBalance(tx, updated.financialAccountId, signed(updated.kind, updated.amount));
    const bucketIds = [...new Set([existing.bucketId, updated.bucketId])];
    for (const b of bucketIds) await recomputeBucket(tx, b);
    return result(tx, id, budget.id, bucketIds, profileTimeZone);
  });
}

export async function remove(userId: string, id: string) {
  const existing = await owned(userId, id);
  const budgetId = (await prisma.budgetItem.findUniqueOrThrow({ where: { id: existing.itemId }, select: { category: { select: { budgetId: true } } } })).category.budgetId;
  await prisma.$transaction(async (tx) => {
    await adjustBalance(tx, existing.financialAccountId, signed(existing.kind, existing.amount).negated());
    await tx.transaction.delete({ where: { id } });
    await recomputeBucket(tx, existing.bucketId);
    await runAlertHook(tx, budgetId, [existing.bucketId]);
  });
}

export async function get(userId: string, id: string) {
  await owned(userId, id);
  return serialize(await prisma.transaction.findUniqueOrThrow({ where: { id }, include }));
}

const encodeCursor = (t: { localDate: Date; occurredAt: Date; id: string }) =>
  Buffer.from(`${t.localDate.toISOString()}|${t.occurredAt.toISOString()}|${t.id}`).toString('base64url');

function decodeCursor(cursor: string) {
  const [localDate, occurredAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!localDate || !occurredAt || !id) throw new AppError(422, 'VALIDATION_FAILED', 'Invalid page cursor.');
  return { localDate: new Date(localDate), occurredAt: new Date(occurredAt), id };
}

export async function list(userId: string, q: Partial<ListQuery> & { limit: number }) {
  const where: Prisma.TransactionWhereInput = {
    userId,
    kind: q.kind,
    itemId: q.itemId,
    financialAccountId: q.financialAccountId,
    payorId: q.payorId,
    vendorId: q.vendorId,
    item: q.budgetId ? { category: { budgetId: q.budgetId } } : undefined,
    localDate: q.from || q.to ? { gte: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, lte: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined } : undefined,
  };
  if (q.cursor) {
    // Keyset pagination on (localDate, occurredAt, id) descending
    const c = decodeCursor(q.cursor);
    where.AND = [
      {
        OR: [
          { localDate: { lt: c.localDate } },
          { localDate: c.localDate, occurredAt: { lt: c.occurredAt } },
          { localDate: c.localDate, occurredAt: c.occurredAt, id: { lt: c.id } },
        ],
      },
    ];
  }
  const rows = await prisma.transaction.findMany({
    where,
    include,
    orderBy: [{ localDate: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { data: page.map(serialize), nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null };
}
