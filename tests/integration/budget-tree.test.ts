import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

beforeAll(resetDb);

const item = (name: string, amount: string, exec: string, frequency = 'MONTHLY') => ({
  name,
  description: `${name} item`,
  estimatedAmount: amount,
  estimatedExecutionDate: exec,
  frequency,
});

const tree = {
  name: 'Household 2027',
  currency: 'USD',
  startDate: '2027-01-01',
  endDate: '2027-12-31',
  mode: 'GUIDED',
  categories: [
    { kind: 'INCOME', name: 'Salaries', items: [item('Salary', '9850.00', '2027-01-15')] },
    { kind: 'EXPENSE', name: 'Housing', items: [item('Rent', '5000.00', '2027-01-20')] },
    { kind: 'EXPENSE', name: 'Subscriptions', items: [{ ...item('Netflix', '20.00', '2027-03-20'), startDate: '2027-03-15', endDate: '2028-03-15' }] },
  ],
};

describe('Guided and Complete creation (FR-022)', () => {
  it('creates the whole tree plus Unplanned in one request', async () => {
    const { agent } = await createUserAgent();
    const res = await agent.post('/api/v1/budgets').send(tree);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const names = res.body.categories.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['Housing', 'Salaries', 'Subscriptions', 'Unplanned', 'Unplanned']);
    expect(res.body.adjustments).toEqual([{ path: 'categories.2.items.0', adjustment: 'END_DATE_CLIPPED' }]);
    const rent = res.body.categories.find((c: { name: string }) => c.name === 'Housing').items[0];
    expect((await agent.get(`/api/v1/items/${rent.id}`)).body.buckets).toHaveLength(12);
  });

  it('Complete mode produces the same structure as Guided', async () => {
    const { agent } = await createUserAgent();
    const guided = (await agent.post('/api/v1/budgets').send(tree)).body;
    const complete = (await agent.post('/api/v1/budgets').send({ ...tree, currency: 'COP', mode: 'COMPLETE' })).body;
    const shape = (b: { categories: { kind: string; name: string; items: { name: string; endDate: string }[] }[] }) =>
      b.categories.map((c) => [c.kind, c.name, c.items.map((i) => [i.name, i.endDate])]).sort();
    expect(shape(complete)).toEqual(shape(guided));
  });

  it('rejects an invalid item with its path and saves nothing', async () => {
    const { agent } = await createUserAgent();
    const bad = structuredClone(tree);
    bad.categories[1]!.items[0]!.estimatedExecutionDate = '2028-02-01';
    const res = await agent.post('/api/v1/budgets').send(bad);
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty(['categories.1.items.0.estimatedExecutionDate']);
    expect((await agent.get('/api/v1/budgets')).body.data).toHaveLength(0);
  });

  it('reports schema errors with nested paths', async () => {
    const { agent } = await createUserAgent();
    const bad = structuredClone(tree);
    bad.categories[0]!.items[0]!.estimatedAmount = 'abc';
    const res = await agent.post('/api/v1/budgets').send(bad);
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty(['categories.0.items.0.estimatedAmount']);
  });
});
