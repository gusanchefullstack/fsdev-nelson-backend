import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

beforeAll(resetDb);

const today = Temporal.Now.plainDateISO('America/Bogota');

describe('GET /dashboard (FR-035)', () => {
  it('shows active budgets with to-date totals, recent transactions and balances', async () => {
    const { agent } = await createUserAgent();
    const start = today.subtract({ months: 2 }).with({ day: 1 });
    const end = start.add({ years: 1 }).subtract({ days: 1 });
    const budget = (await agent.post('/api/v1/budgets').send({ name: 'This year', currency: 'USD', startDate: start.toString(), endDate: end.toString() })).body;
    // A budget that hasn't started yet is not active
    await agent.post('/api/v1/budgets').send({ name: 'Later', currency: 'USD', startDate: end.add({ days: 1 }).toString(), endDate: end.add({ months: 6 }).toString() });
    const cat = (await agent.post(`/api/v1/budgets/${budget.id}/categories`).send({ kind: 'EXPENSE', name: 'Housing' })).body;
    const rent = (
      await agent.post(`/api/v1/categories/${cat.id}/items`).send({
        name: 'Rent',
        description: 'Apartment',
        estimatedAmount: '1000.00',
        estimatedExecutionDate: start.with({ day: 5 }).toString(),
        frequency: 'MONTHLY',
      })
    ).body;
    const account = (await agent.post('/api/v1/financial-accounts').send({ name: 'Checking', type: 'CHECKING', currency: 'USD', openingBalance: '5000' })).body;
    const vendor = (await agent.post('/api/v1/vendors').send({ name: 'Landlord', type: 'HOUSING', currency: 'USD' })).body;
    const tx = await agent.post('/api/v1/transactions').send({
      kind: 'EXPENSE',
      amount: '1000.00',
      currency: 'USD',
      occurredAt: `${start.with({ day: 5 }).toString()}T10:00:00-05:00`,
      itemId: rent.id,
      financialAccountId: account.id,
      vendorId: vendor.id,
    });
    expect(tx.status, JSON.stringify(tx.body)).toBe(201);

    const res = await agent.get('/api/v1/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.activeBudgets.map((b: { name: string }) => b.name)).toEqual(['This year']);
    const totals = res.body.activeBudgets[0].totals;
    expect(totals.actualExpenseToDate).toBe('1000.00');
    // Expected so far = one estimate per bucket that has started
    const buckets = (await agent.get(`/api/v1/items/${rent.id}`)).body.buckets as { startDate: string }[];
    const started = buckets.filter((b) => b.startDate <= Temporal.Now.plainDateISO('America/Bogota').toString()).length;
    expect(totals.expectedExpenseToDate).toBe(`${started * 1000}.00`);
    expect(res.body.recentTransactions).toHaveLength(1);
    expect(res.body.financialAccounts[0].currentBalance).toBe('4000.00');
    expect(res.body.unreadAlertCount).toBe(0);
  });
});
