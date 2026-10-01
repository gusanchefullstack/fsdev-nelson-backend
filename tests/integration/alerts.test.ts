import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent, type Agent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

beforeAll(resetDb);

// 2025 is fully in the past, so every bucket has started and ended: results don't depend on today
async function world(agent: Agent, rentAmount = '100.00', withSalary = false) {
  const post = async (path: string, body: object) => {
    const r = await agent.post(`/api/v1${path}`).send(body);
    expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(201);
    return r.body;
  };
  const budget = await post('/budgets', { name: '2025', currency: 'USD', startDate: '2025-01-01', endDate: '2025-12-31' });
  const housing = await post(`/budgets/${budget.id}/categories`, { kind: 'EXPENSE', name: 'Housing' });
  const salaries = await post(`/budgets/${budget.id}/categories`, { kind: 'INCOME', name: 'Salaries' });
  const monthly = (name: string, amount: string, exec: string) => ({ name, description: name, estimatedAmount: amount, estimatedExecutionDate: exec, frequency: 'MONTHLY' });
  const rent = await post(`/categories/${housing.id}/items`, monthly('Rent', rentAmount, '2025-01-20'));
  // Only income tests add a salary; otherwise unpaid 2025 income would raise its own alerts
  const salary = withSalary ? await post(`/categories/${salaries.id}/items`, monthly('Salary', '1000.00', '2025-01-15')) : null;
  const account = await post('/financial-accounts', { name: 'Checking', type: 'CHECKING', currency: 'USD', openingBalance: '0' });
  const vendor = await post('/vendors', { name: 'Landlord', type: 'HOUSING', currency: 'USD' });
  const payor = await post('/payors', { name: 'Acme', type: 'EMPLOYER', currency: 'USD' });
  const expense = (amount: string, date = '2025-01-18') =>
    agent.post('/api/v1/transactions').send({ kind: 'EXPENSE', amount, currency: 'USD', occurredAt: `${date}T12:00:00-05:00`, itemId: rent.id, financialAccountId: account.id, vendorId: vendor.id });
  const income = (amount: string, date: string) =>
    agent.post('/api/v1/transactions').send({ kind: 'INCOME', amount, currency: 'USD', occurredAt: `${date}T12:00:00-05:00`, itemId: salary!.id, financialAccountId: account.id, payorId: payor.id });
  return { budget, rent, salary, account, vendor, expense, income };
}

const activeAlerts = async (agent: Agent) => (await agent.get('/api/v1/alerts')).body;

describe('item-level alerts (FR-042)', () => {
  it('raises one expense alert per breach until it clears, then can raise again', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent);
    const first = await w.expense('111.00');
    expect(first.body.newAlerts.map((a: { type: string }) => a.type)).toContain('ITEM_EXPENSE_OVER');
    expect(first.body.newAlerts[0].message).toMatch(/Rent is \$11\.00 over its \$100\.00 estimate/);

    const second = await w.expense('5.00');
    expect(second.body.newAlerts.filter((a: { type: string }) => a.type === 'ITEM_EXPENSE_OVER')).toHaveLength(0);
    expect((await activeAlerts(agent)).data.filter((a: { type: string }) => a.type === 'ITEM_EXPENSE_OVER')).toHaveLength(1);

    // Back within the threshold → cleared; a new breach raises a fresh alert
    await agent.delete(`/api/v1/transactions/${second.body.transaction.id}`);
    await agent.delete(`/api/v1/transactions/${first.body.transaction.id}`);
    const cleared = (await activeAlerts(agent)).data.find((a: { type: string }) => a.type === 'ITEM_EXPENSE_OVER');
    expect(cleared.cleared).toBe(true);
    const again = await w.expense('150.00');
    expect(again.body.newAlerts.map((a: { type: string }) => a.type)).toContain('ITEM_EXPENSE_OVER');
  });

  it('raises income alerts after the bucket ends short, when the dashboard loads', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent, '100.00', true);
    await w.income('1000.00', '2025-01-15');
    await w.income('850.00', '2025-02-14');
    const dash = (await agent.get('/api/v1/dashboard')).body;
    const under = dash.unreadAlerts.filter((a: { type: string }) => a.type === 'ITEM_INCOME_UNDER');
    // Feb is short; Mar–Dec received nothing → all ended short
    expect(under.length).toBe(11);
    expect(under.some((a: { message: string }) => /Salary came in \$150\.00 below/.test(a.message))).toBe(true);
    // Evaluated once: a second load adds nothing
    expect((await agent.get('/api/v1/dashboard')).body.unreadAlertCount).toBe(dash.unreadAlertCount);
  });

  it('does not alert on Unplanned items without an allowance', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent, '5000.00');
    const unplanned = (await agent.get(`/api/v1/budgets/${w.budget.id}`)).body.categories.find((c: { isSystem: boolean; kind: string }) => c.isSystem && c.kind === 'EXPENSE').items[0];
    const res = await agent.post('/api/v1/transactions').send({
      kind: 'EXPENSE',
      amount: '300.00',
      currency: 'USD',
      occurredAt: '2025-01-18T12:00:00-05:00',
      itemId: unplanned.id,
      financialAccountId: w.account.id,
      vendorId: w.vendor.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.newAlerts.filter((a: { type: string }) => a.type === 'ITEM_EXPENSE_OVER')).toHaveLength(0);
  });
});

describe('budget-level alerts (FR-042)', () => {
  it('raises one budget alert when cumulative spending exceeds the plan', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent); // plan: 12 × 100 = 1200
    const res = await w.expense('1400.00');
    expect(res.body.newAlerts.map((a: { type: string }) => a.type).sort()).toEqual(['BUDGET_EXPENSE_OVER', 'ITEM_EXPENSE_OVER']);
    const again = await w.expense('10.00', '2025-02-18');
    expect(again.body.newAlerts.filter((a: { type: string }) => a.type === 'BUDGET_EXPENSE_OVER')).toHaveLength(0);
  });

  it('uses the current threshold for later evaluations', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent);
    await agent.patch(`/api/v1/budgets/${w.budget.id}`).send({ alertThresholdPct: 50 });
    const res = await w.expense('140.00');
    expect(res.body.newAlerts).toHaveLength(0);
  });
});

describe('managing alerts (FR-043)', () => {
  it('marks read, dismisses and reads all', async () => {
    const { agent } = await createUserAgent();
    const w = await world(agent);
    await w.expense('150.00');
    await w.expense('150.00', '2025-03-18');
    let list = await activeAlerts(agent);
    expect(list.unreadCount).toBe(2);
    const [a, b] = list.data;
    expect((await agent.patch(`/api/v1/alerts/${a.id}`).send({ read: true })).body.read).toBe(true);
    expect((await activeAlerts(agent)).unreadCount).toBe(1);
    await agent.patch(`/api/v1/alerts/${b.id}`).send({ dismissed: true });
    list = await activeAlerts(agent);
    expect(list.data.map((x: { id: string }) => x.id)).not.toContain(b.id);
    await w.expense('150.00', '2025-04-18');
    expect((await agent.post('/api/v1/alerts/read-all')).status).toBe(204);
    expect((await activeAlerts(agent)).unreadCount).toBe(0);
    const other = await createUserAgent();
    expect((await other.agent.patch(`/api/v1/alerts/${a.id}`).send({ read: true })).status).toBe(404);
  });
});
