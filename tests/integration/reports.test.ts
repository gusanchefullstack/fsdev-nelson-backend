import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent, type Agent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

let agent: Agent;
let budgetId: string;
let housingId: string;
let rentId: string;

// A fully past budget (2025), so every bucket is closed and figures are date-independent
beforeAll(async () => {
  await resetDb();
  ({ agent } = await createUserAgent());
  const post = async (path: string, body: object) => {
    const r = await agent.post(`/api/v1${path}`).send(body);
    expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
    return r.body;
  };
  const budget = await post('/budgets', { name: '2025', currency: 'USD', startDate: '2025-01-01', endDate: '2025-12-31' });
  budgetId = budget.id;
  const housing = await post(`/budgets/${budgetId}/categories`, { kind: 'EXPENSE', name: 'Housing' });
  housingId = housing.id;
  const subs = await post(`/budgets/${budgetId}/categories`, { kind: 'EXPENSE', name: 'Subscriptions' });
  const salaries = await post(`/budgets/${budgetId}/categories`, { kind: 'INCOME', name: 'Salaries' });
  const monthly = (name: string, amount: string, exec: string) => ({ name, description: name, estimatedAmount: amount, estimatedExecutionDate: exec, frequency: 'MONTHLY' });
  const rent = await post(`/categories/${housing.id}/items`, monthly('Rent', '1000.00', '2025-01-20'));
  rentId = rent.id;
  const netflix = await post(`/categories/${subs.id}/items`, monthly('Netflix', '20.00', '2025-01-20'));
  const salary = await post(`/categories/${salaries.id}/items`, monthly('Salary', '4000.00', '2025-01-15'));
  const account = await post('/financial-accounts', { name: 'Checking', type: 'CHECKING', currency: 'USD', openingBalance: '0' });
  const landlord = await post('/vendors', { name: 'Landlord', type: 'HOUSING', currency: 'USD' });
  const streaming = await post('/vendors', { name: 'Netflix Inc', type: 'SUBSCRIPTION', currency: 'USD' });
  const acme = await post('/payors', { name: 'Acme', type: 'EMPLOYER', currency: 'USD' });
  const tx = (kind: string, itemId: string, amount: string, date: string, party: object) =>
    post('/transactions', { kind, amount, currency: 'USD', occurredAt: `${date}T12:00:00-05:00`, itemId, financialAccountId: account.id, ...party });
  for (const [d, a] of [['2025-01-18', '1000.00'], ['2025-02-20', '1200.00'], ['2025-03-19', '1100.00']] as const) await tx('EXPENSE', rent.id, a, d, { vendorId: landlord.id });
  for (const [d, a] of [['2025-01-20', '23.00'], ['2025-02-20', '24.00'], ['2025-03-20', '23.00']] as const) await tx('EXPENSE', netflix.id, a, d, { vendorId: streaming.id });
  for (const [d, a] of [['2025-01-15', '4000.00'], ['2025-02-14', '4000.00'], ['2025-03-14', '3500.00']] as const) await tx('INCOME', salary.id, a, d, { payorId: acme.id });
});

describe('reports (FR-038–FR-040)', () => {
  it('forecast vs actual per month at budget level', async () => {
    const r = (await agent.get(`/api/v1/budgets/${budgetId}/reports/forecast-vs-actual?level=budget`)).body;
    expect(r.currency).toBe('USD');
    const jan = r.series.filter((s: { period: string }) => s.period === '2025-01');
    expect(jan).toEqual([
      { period: '2025-01', kind: 'EXPENSE', expected: '1020.00', actual: '1023.00' },
      { period: '2025-01', kind: 'INCOME', expected: '4000.00', actual: '4000.00' },
    ]);
    expect(r.series.find((s: { period: string; kind: string }) => s.period === '2025-12' && s.kind === 'EXPENSE')).toMatchObject({ expected: '1020.00', actual: '0.00' });
  });

  it('forecast vs actual narrows to a category or item', async () => {
    const cat = (await agent.get(`/api/v1/budgets/${budgetId}/reports/forecast-vs-actual?level=category&targetId=${housingId}`)).body;
    expect(cat.series.find((s: { period: string }) => s.period === '2025-02')).toMatchObject({ expected: '1000.00', actual: '1200.00' });
    const item = (await agent.get(`/api/v1/budgets/${budgetId}/reports/forecast-vs-actual?level=item&targetId=${rentId}`)).body;
    expect(item.series).toHaveLength(12);
    const missing = await agent.get(`/api/v1/budgets/${budgetId}/reports/forecast-vs-actual?level=item`);
    expect(missing.status).toBe(422);
  });

  it('top N by item and by counterparty', async () => {
    const byItem = (await agent.get(`/api/v1/budgets/${budgetId}/reports/top?n=5`)).body;
    expect(byItem.expenses).toEqual([
      expect.objectContaining({ name: 'Rent', amount: '3300.00', sharePct: 97.9 }),
      expect.objectContaining({ name: 'Netflix', amount: '70.00', sharePct: 2.1 }),
    ]);
    expect(byItem.incomes).toEqual([expect.objectContaining({ name: 'Salary', amount: '11500.00', sharePct: 100 })]);
    const byParty = (await agent.get(`/api/v1/budgets/${budgetId}/reports/top?n=10&by=counterparty&from=2025-02-01&to=2025-02-28`)).body;
    expect(byParty.expenses.map((e: { name: string; amount: string }) => [e.name, e.amount])).toEqual([
      ['Landlord', '1200.00'],
      ['Netflix Inc', '24.00'],
    ]);
    expect((await agent.get(`/api/v1/budgets/${budgetId}/reports/top?n=7`)).status).toBe(422);
  });

  it('projection equals actuals once every bucket has closed', async () => {
    const p = (await agent.get(`/api/v1/budgets/${budgetId}/reports/projection`)).body;
    expect(p.expense).toEqual({ planned: '12240.00', actualToDate: '3370.00', projected: '3370.00', unbudgeted: '0.00' });
    expect(p.income).toMatchObject({ planned: '48000.00', actualToDate: '11500.00', projected: '11500.00' });
    expect(p.items.find((i: { name: string }) => i.name === 'Rent')).toMatchObject({ ratio: 0.275 });
  });

  it('flags items that keep missing their estimate', async () => {
    const { data } = (await agent.get(`/api/v1/budgets/${budgetId}/reports/insights`)).body;
    const names = data.map((i: { itemName: string }) => i.itemName).sort();
    expect(names).toEqual(['Netflix', 'Rent', 'Salary']);
    const rent = data.find((i: { itemName: string }) => i.itemName === 'Rent');
    expect(rent).toMatchObject({ deviatingBuckets: 10, completedBuckets: 12 });
    expect(rent.suggestion).toMatch(/Rent came in under its estimate in 10 of 12 buckets/);
  });
});
