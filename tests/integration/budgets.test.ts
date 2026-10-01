import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent, type Agent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

beforeAll(resetDb);

const budget2027 = { name: 'Household 2027', currency: 'USD', startDate: '2027-01-01', endDate: '2027-12-31' };
const rent = {
  name: 'Rent',
  description: 'Apartment rent',
  estimatedAmount: '5000.00',
  estimatedExecutionDate: '2027-01-20',
  frequency: 'MONTHLY',
};

interface Item { id: string; endDate: string; adjustments?: string[]; isSystem: boolean; buckets?: { startDate: string; endDate: string }[] }
interface Category { id: string; kind: string; name: string; isSystem: boolean; items: Item[] }

async function newBudget(agent: Agent, body: object = budget2027) {
  const res = await agent.post('/api/v1/budgets').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; categories: Category[] };
}

async function newCategory(agent: Agent, budgetId: string, kind = 'EXPENSE', name = 'Housing') {
  const res = await agent.post(`/api/v1/budgets/${budgetId}/categories`).send({ kind, name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Category;
}

describe('budgets (FR-012–FR-014, FR-033)', () => {
  it('creates a budget with system Unplanned income and expense categories', async () => {
    const { agent } = await createUserAgent();
    const budget = await newBudget(agent);
    const system = budget.categories.filter((c) => c.isSystem);
    expect(system.map((c) => c.kind).sort()).toEqual(['EXPENSE', 'INCOME']);
    for (const c of system) {
      expect(c.name).toBe('Unplanned');
      expect(c.items).toHaveLength(1);
      expect(c.items[0]!.isSystem).toBe(true);
    }
  });

  it('rejects an overlapping budget in the same currency but accepts another currency', async () => {
    const { agent } = await createUserAgent();
    await newBudget(agent);
    const overlap = await agent.post('/api/v1/budgets').send({ ...budget2027, startDate: '2027-06-01', endDate: '2028-05-31' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('BUDGET_OVERLAP');
    const cop = await agent.post('/api/v1/budgets').send({ ...budget2027, currency: 'COP', startDate: '2027-06-01', endDate: '2028-05-31' });
    expect(cop.status).toBe(201);
  });

  it('validates dates and threshold', async () => {
    const { agent } = await createUserAgent();
    const res = await agent.post('/api/v1/budgets').send({ ...budget2027, endDate: '2026-12-31', alertThresholdPct: 0 });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['endDate', 'alertThresholdPct']));
  });

  it('cannot change the currency after creation', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const res = await agent.patch(`/api/v1/budgets/${b.id}`).send({ currency: 'COP', name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.name).toBe('Renamed');
  });
});

describe('categories and items (FR-015–FR-019, FR-023)', () => {
  it('creates a monthly item with 12 buckets', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    const res = await agent.post(`/api/v1/categories/${cat.id}/items`).send(rent);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.startDate).toBe('2027-01-01');
    expect(res.body.currency).toBe('USD');
    const item = await agent.get(`/api/v1/items/${res.body.id}`);
    expect(item.body.buckets).toHaveLength(12);
    expect(item.body.buckets[1]).toMatchObject({ startDate: '2027-02-05', endDate: '2027-03-04', estimatedAmount: '5000.00' });
  });

  it('clips an end date beyond the budget and reports it (FR-017)', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id, 'EXPENSE', 'Subscriptions');
    const res = await agent.post(`/api/v1/categories/${cat.id}/items`).send({
      ...rent,
      name: 'Netflix',
      estimatedAmount: '20.00',
      startDate: '2027-03-15',
      endDate: '2028-03-15',
      estimatedExecutionDate: '2027-03-20',
    });
    expect(res.status).toBe(201);
    expect(res.body.endDate).toBe('2027-12-31');
    expect(res.body.adjustments).toEqual(['END_DATE_CLIPPED']);
  });

  it('rejects a start before the budget and an execution date outside the item', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    const early = await agent.post(`/api/v1/categories/${cat.id}/items`).send({ ...rent, startDate: '2026-12-01' });
    expect(early.status).toBe(422);
    expect(early.body.error.fields).toHaveProperty('startDate');
    const exec = await agent
      .post(`/api/v1/categories/${cat.id}/items`)
      .send({ ...rent, startDate: '2027-03-01', estimatedExecutionDate: '2027-02-20' });
    expect(exec.status).toBe(422);
    expect(exec.body.error.fields).toHaveProperty('estimatedExecutionDate');
  });

  it('requires interval and unit for custom frequencies, and amount > 0 for user items', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    const res = await agent.post(`/api/v1/categories/${cat.id}/items`).send({ ...rent, frequency: 'CUSTOM' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['customInterval', 'customUnit']));
    const zero = await agent.post(`/api/v1/categories/${cat.id}/items`).send({ ...rent, estimatedAmount: '0' });
    expect(zero.status).toBe(422);
    expect(zero.body.error.fields).toHaveProperty('estimatedAmount');
  });

  it('protects the system Unplanned category and item', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const sys = b.categories.find((c) => c.isSystem && c.kind === 'EXPENSE')!;
    expect((await agent.patch(`/api/v1/categories/${sys.id}`).send({ name: 'Other' })).body.error.code).toBe('SYSTEM_RECORD');
    expect((await agent.delete(`/api/v1/categories/${sys.id}`)).body.error.code).toBe('SYSTEM_RECORD');
    const item = sys.items[0]!;
    expect((await agent.delete(`/api/v1/items/${item.id}`)).body.error.code).toBe('SYSTEM_RECORD');
    const full = (await agent.get(`/api/v1/items/${item.id}`)).body;
    const renamed = await agent.put(`/api/v1/items/${item.id}`).send({ ...full, name: 'Misc' });
    expect(renamed.body.error.code).toBe('SYSTEM_RECORD');
    const allowance = await agent.put(`/api/v1/items/${item.id}`).send({ ...full, estimatedAmount: '150.00' });
    expect(allowance.status).toBe(200);
    expect(allowance.body.estimatedAmount).toBe('150.00');
  });

  it('regenerates buckets when the frequency changes', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    const item = (await agent.post(`/api/v1/categories/${cat.id}/items`).send(rent)).body;
    const res = await agent.put(`/api/v1/items/${item.id}`).send({ ...rent, frequency: 'QUARTERLY' });
    expect(res.status).toBe(200);
    expect(res.body.buckets).toHaveLength(4);
  });

  it('reports deletion impact and cascades deletes', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    await agent.post(`/api/v1/categories/${cat.id}/items`).send(rent);
    const impact = await agent.get(`/api/v1/categories/${cat.id}/deletion-impact`);
    expect(impact.body).toEqual({ categories: 0, items: 1, buckets: 12, transactions: 0 });
    const budgetImpact = await agent.get(`/api/v1/budgets/${b.id}/deletion-impact`);
    expect(budgetImpact.body).toMatchObject({ categories: 3, items: 3, buckets: 36 });
    expect((await agent.delete(`/api/v1/categories/${cat.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/v1/budgets/${b.id}`)).status).toBe(204);
    expect((await agent.get(`/api/v1/budgets/${b.id}`)).status).toBe(404);
  });

  it('shifts and clips items when the budget dates change', async () => {
    const { agent } = await createUserAgent();
    const b = await newBudget(agent);
    const cat = await newCategory(agent, b.id);
    const item = (await agent.post(`/api/v1/categories/${cat.id}/items`).send(rent)).body;
    const res = await agent.patch(`/api/v1/budgets/${b.id}`).send({ endDate: '2027-06-30' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const updated = (await agent.get(`/api/v1/items/${item.id}`)).body;
    expect(updated.endDate).toBe('2027-06-30');
    expect(updated.buckets).toHaveLength(6);
  });
});

describe('data isolation (FR-006)', () => {
  it("returns 404 for another user's budget, category and item", async () => {
    const a = await createUserAgent();
    const bUser = await createUserAgent();
    const budget = await newBudget(a.agent);
    const cat = await newCategory(a.agent, budget.id);
    const item = (await a.agent.post(`/api/v1/categories/${cat.id}/items`).send(rent)).body;
    expect((await bUser.agent.get(`/api/v1/budgets/${budget.id}`)).status).toBe(404);
    expect((await bUser.agent.patch(`/api/v1/categories/${cat.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await bUser.agent.get(`/api/v1/items/${item.id}`)).status).toBe(404);
    expect((await bUser.agent.delete(`/api/v1/budgets/${budget.id}`)).status).toBe(404);
    expect((await bUser.agent.get('/api/v1/budgets')).body.data).toHaveLength(0);
  });
});
