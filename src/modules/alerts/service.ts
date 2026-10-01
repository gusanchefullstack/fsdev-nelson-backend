import { budgetBreach, bucketBreach } from '../../domain/alerts.js';
import { setAlertHook } from '../../domain/hooks.js';
import { notFound } from '../../errors.js';
import { Prisma, type AlertType, type Currency } from '../../generated/prisma/client.js';
import { newId } from '../../lib/ids.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { fromPlainDate, todayIn } from '../../lib/temporal.js';

const money = (v: number, currency: Currency) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(v);
const range = (a: Date, b: Date) =>
  `${new Date(a).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${new Date(b).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;

interface AlertRow {
  id: string;
  type: AlertType;
  budgetId: string;
  bucketId: string | null;
  expectedAmount: { toNumber(): number };
  actualAmount: { toNumber(): number };
  thresholdPct: number;
  readAt: Date | null;
  clearedAt: Date | null;
  createdAt: Date;
  budget: { name: string; currency: Currency };
  bucket: { startDate: Date; endDate: Date; item: { id: string; name: string } } | null;
}

/** Friendly, ready-to-display text for an alert. */
function message(a: AlertRow): string {
  const c = a.budget.currency;
  const exp = a.expectedAmount.toNumber();
  const act = a.actualAmount.toNumber();
  const t = `(threshold ${a.thresholdPct}%)`;
  switch (a.type) {
    case 'ITEM_EXPENSE_OVER':
      return `${a.bucket!.item.name} is ${money(act - exp, c)} over its ${money(exp, c)} estimate for ${range(a.bucket!.startDate, a.bucket!.endDate)} ${t}.`;
    case 'ITEM_INCOME_UNDER':
      return `${a.bucket!.item.name} came in ${money(exp - act, c)} below its ${money(exp, c)} estimate for ${range(a.bucket!.startDate, a.bucket!.endDate)} ${t}.`;
    case 'BUDGET_EXPENSE_OVER':
      return `Spending in ${a.budget.name} is ${money(act - exp, c)} over plan so far: ${money(act, c)} of ${money(exp, c)} ${t}.`;
    case 'BUDGET_INCOME_UNDER':
      return `Income in ${a.budget.name} is ${money(exp - act, c)} below plan so far: ${money(act, c)} of ${money(exp, c)} ${t}.`;
  }
}

const include = {
  budget: { select: { name: true, currency: true } },
  bucket: { select: { startDate: true, endDate: true, item: { select: { id: true, name: true } } } },
} as const;

function serialize(a: AlertRow) {
  return {
    id: a.id,
    type: a.type,
    budgetId: a.budgetId,
    budgetName: a.budget.name,
    itemId: a.bucket?.item.id ?? null,
    itemName: a.bucket?.item.name ?? null,
    bucketId: a.bucketId,
    expectedAmount: a.expectedAmount.toNumber().toFixed(2),
    actualAmount: a.actualAmount.toNumber().toFixed(2),
    currency: a.budget.currency,
    thresholdPct: a.thresholdPct,
    message: message(a),
    read: a.readAt !== null,
    cleared: a.clearedAt !== null,
    createdAt: a.createdAt.toISOString(),
  };
}

interface Condition {
  userId: string;
  budgetId: string;
  bucketId: string | null;
  type: AlertType;
  breach: boolean;
  expected: number;
  actual: number;
  thresholdPct: number;
}

/**
 * Applies many conditions in a constant number of queries: clears the ones no longer breached and
 * raises the breached ones that have no active alert yet (one active alert per condition, FR-042).
 */
async function applyConditions(tx: Tx, conditions: Condition[]): Promise<string[]> {
  const cleared = conditions.filter((c) => !c.breach);
  if (cleared.length) {
    await tx.alert.updateMany({
      where: { clearedAt: null, OR: cleared.map((c) => ({ budgetId: c.budgetId, bucketId: c.bucketId, type: c.type })) },
      data: { clearedAt: new Date() },
    });
  }
  const raised = conditions.filter((c) => c.breach);
  if (!raised.length) return [];
  const values = raised.map(
    (c) =>
      Prisma.sql`(${newId()}::uuid, ${c.userId}::uuid, ${c.budgetId}::uuid, ${c.bucketId}::uuid, ${c.type}::"AlertType", ${c.expected}, ${c.actual}, ${c.thresholdPct}, now(), now())`,
  );
  // ON CONFLICT skips conditions that already have an active alert (unique index alert_active_unique)
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Alert" (id, "userId", "budgetId", "bucketId", type, "expectedAmount", "actualAmount", "thresholdPct", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return inserted.map((r) => r.id);
}

async function budgetContext(tx: Tx, budgetId: string) {
  const budget = await tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { userId: true, alertThresholdPct: true } });
  const profile = await tx.profile.findUnique({ where: { userId: budget.userId }, select: { timeZone: true } });
  return { ...budget, today: fromPlainDate(todayIn(profile?.timeZone ?? 'UTC')) };
}

/** Budget-level conditions on cumulative totals (expenses: started buckets; income: closed buckets). */
async function evaluateBudget(tx: Tx, budgetId: string, ctx: Awaited<ReturnType<typeof budgetContext>>) {
  const buckets = await tx.bucket.findMany({
    where: { item: { category: { budgetId } } },
    select: { startDate: true, endDate: true, estimatedAmount: true, actualAmount: true, item: { select: { category: { select: { kind: true } } } } },
  });
  const conditions: Condition[] = [];
  for (const kind of ['EXPENSE', 'INCOME'] as const) {
    const rows = buckets.filter((b) => b.item.category.kind === kind && (kind === 'EXPENSE' ? b.startDate <= ctx.today : b.endDate < ctx.today));
    const expected = rows.reduce((s, b) => s + b.estimatedAmount.toNumber(), 0);
    // Expense actuals count everything recorded, including Unplanned (FR-033a)
    const actual = (kind === 'EXPENSE' ? buckets.filter((b) => b.item.category.kind === kind) : rows).reduce((s, b) => s + b.actualAmount.toNumber(), 0);
    conditions.push({
      userId: ctx.userId,
      budgetId,
      bucketId: null,
      type: kind === 'EXPENSE' ? 'BUDGET_EXPENSE_OVER' : 'BUDGET_INCOME_UNDER',
      breach: budgetBreach({ kind, expected, actual, thresholdPct: ctx.alertThresholdPct }),
      expected,
      actual,
      thresholdPct: ctx.alertThresholdPct,
    });
  }
  return conditions;
}

/** Re-evaluates the touched buckets and the budget after any money change (research R9). Returns new alerts. */
export async function evaluateAfterWrite(tx: Tx, budgetId: string, bucketIds: string[]) {
  const ctx = await budgetContext(tx, budgetId);
  const buckets = await tx.bucket.findMany({
    where: { id: { in: bucketIds } },
    select: { id: true, endDate: true, estimatedAmount: true, actualAmount: true, item: { select: { category: { select: { kind: true } } } } },
  });
  const conditions: Condition[] = buckets.map((b) => {
    const kind = b.item.category.kind;
    const expected = b.estimatedAmount.toNumber();
    const actual = b.actualAmount.toNumber();
    return {
      userId: ctx.userId,
      budgetId,
      bucketId: b.id,
      type: kind === 'EXPENSE' ? 'ITEM_EXPENSE_OVER' : 'ITEM_INCOME_UNDER',
      breach: bucketBreach({ kind, expected, actual, thresholdPct: ctx.alertThresholdPct, ended: b.endDate < ctx.today }),
      expected,
      actual,
      thresholdPct: ctx.alertThresholdPct,
    };
  });
  conditions.push(...(await evaluateBudget(tx, budgetId, ctx)));
  const ids = await applyConditions(tx, conditions);
  if (!ids.length) return [];
  const rows = await tx.alert.findMany({ where: { id: { in: ids } }, include, orderBy: { createdAt: 'asc' } });
  return (rows as unknown as AlertRow[]).map(serialize);
}

setAlertHook(evaluateAfterWrite);

/** Income shortfalls are only known once a bucket ends; checked when the user opens the app (research R9). */
export async function evaluateEndedIncomeBuckets(userId: string, timeZone: string): Promise<void> {
  const today = fromPlainDate(todayIn(timeZone));
  const pending = await prisma.bucket.findMany({
    where: { endDate: { lt: today }, incomeEvaluatedAt: null, item: { category: { kind: 'INCOME', budget: { userId } } } },
    select: { id: true, item: { select: { category: { select: { budgetId: true } } } } },
  });
  const byBudget = new Map<string, string[]>();
  for (const b of pending) byBudget.set(b.item.category.budgetId, [...(byBudget.get(b.item.category.budgetId) ?? []), b.id]);
  for (const [budgetId, ids] of byBudget) {
    await prisma.$transaction(async (tx) => {
      await evaluateAfterWrite(tx, budgetId, ids);
      await tx.bucket.updateMany({ where: { id: { in: ids } }, data: { incomeEvaluatedAt: new Date() } });
    });
  }
}

export async function listAlerts(userId: string, opts: { unreadOnly?: boolean } = {}) {
  const [rows, unreadCount] = await Promise.all([
    prisma.alert.findMany({
      where: { userId, dismissedAt: null, readAt: opts.unreadOnly ? null : undefined, ...(opts.unreadOnly ? { clearedAt: null } : {}) },
      include,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.alert.count({ where: { userId, dismissedAt: null, readAt: null, clearedAt: null } }),
  ]);
  return { data: (rows as unknown as AlertRow[]).map(serialize), unreadCount };
}

export async function updateAlert(userId: string, id: string, patch: { read?: boolean; dismissed?: boolean }) {
  const existing = await prisma.alert.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('alert');
  const row = await prisma.alert.update({
    where: { id },
    data: {
      readAt: patch.read === undefined ? undefined : patch.read ? (existing.readAt ?? new Date()) : null,
      dismissedAt: patch.dismissed ? new Date() : undefined,
    },
    include,
  });
  return serialize(row);
}

export async function readAll(userId: string): Promise<void> {
  await prisma.alert.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

