import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { evaluateEndedIncomeBuckets, listAlerts } from '../alerts/service.js';
import * as budgets from '../budgets/service.js';
import * as transactions from '../transactions/service.js';
import { toMoneyString } from '../../lib/money.js';

export const dashboardRouter = Router();

/** Everything the dashboard shows in one request (FR-035). */
dashboardRouter.get('/dashboard', async (_req, res) => {
  const userId = userIdOf(res.locals);
  const timeZone = timeZoneOf(res.locals);
  // Income shortfalls are only known once a bucket ends; check those first (research R9)
  await evaluateEndedIncomeBuckets(userId, timeZone);
  const [all, recent, accounts, alerts] = await Promise.all([
    budgets.list(userId, timeZone),
    transactions.list(userId, { limit: 10 }),
    prisma.financialAccount.findMany({ where: { userId }, orderBy: { name: 'asc' }, include: { _count: { select: { transactions: true } } } }),
    listAlerts(userId, { unreadOnly: true }),
  ]);
  res.json({
    activeBudgets: all.filter((b) => b.isActive),
    recentTransactions: recent.data,
    financialAccounts: accounts.map(({ _count, ...a }) => ({
      ...a,
      openingBalance: toMoneyString(a.openingBalance),
      currentBalance: toMoneyString(a.currentBalance),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      inUse: _count.transactions > 0,
    })),
    unreadAlerts: alerts.data,
    unreadAlertCount: alerts.unreadCount,
  });
});
