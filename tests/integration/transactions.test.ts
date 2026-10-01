import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent, type Agent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';
import { expense, setupWorld, type World } from '../helpers/fixtures.js';

beforeAll(resetDb);

async function fresh(): Promise<{ agent: Agent; w: World }> {
  const { agent } = await createUserAgent();
  return { agent, w: await setupWorld(agent) };
}

const balanceOf = async (agent: Agent, id: string) => (await agent.get(`/api/v1/financial-accounts/${id}`)).body.currentBalance as string;
const bucketsOf = async (agent: Agent, itemId: string) =>
  (await agent.get(`/api/v1/items/${itemId}`)).body.buckets as { id: string; startDate: string; actualAmount: string; actualDate: string | null }[];

describe('recording transactions (FR-026–FR-030)', () => {
  it('allocates an expense to its bucket and lowers the account balance', async () => {
    const { agent, w } = await fresh();
    const res = await agent.post('/api/v1/transactions').send(expense(w, '5000.00', '2027-03-18T10:00:00-05:00'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.bucket).toMatchObject({ startDate: '2027-03-05', endDate: '2027-04-04', actualAmount: '5000.00', actualDate: '2027-03-18' });
    expect(res.body.transaction).toMatchObject({ localDate: '2027-03-18', timeZone: 'America/Bogota', itemName: 'Rent' });
    expect(res.body.transaction.origin).toMatchObject({ name: 'Main Checking', type: 'FINANCIAL_ACCOUNT' });
    expect(res.body.transaction.destination).toMatchObject({ name: 'Landlord', type: 'VENDOR' });
    expect(await balanceOf(agent, w.checking.id)).toBe('5000.00');
  });

  it('sums several transactions in one bucket and keeps the latest date (FR-029)', async () => {
    const { agent, w } = await fresh();
    await agent.post('/api/v1/transactions').send(expense(w, '5000.00', '2027-03-18T10:00:00-05:00'));
    const second = await agent.post('/api/v1/transactions').send(expense(w, '100.00', '2027-03-25T09:00:00-05:00'));
    expect(second.body.bucket).toMatchObject({ actualAmount: '5100.00', actualDate: '2027-03-25' });
  });

  it('records income from a payor into an account', async () => {
    const { agent, w } = await fresh();
    const res = await agent.post('/api/v1/transactions').send({
      kind: 'INCOME',
      amount: '9850.00',
      currency: 'USD',
      occurredAt: '2027-01-15T08:00:00-05:00',
      itemId: w.salary.id,
      financialAccountId: w.checking.id,
      payorId: w.acme.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await balanceOf(agent, w.checking.id)).toBe('19850.00');
  });

  it('enforces origin/destination by kind and the item kind (FR-027)', async () => {
    const { agent, w } = await fresh();
    const noVendor = await agent.post('/api/v1/transactions').send(expense(w, '10.00', '2027-03-18T10:00:00-05:00', { vendorId: null }));
    expect(noVendor.status).toBe(422);
    expect(noVendor.body.error.fields).toHaveProperty('vendorId');
    const wrongKind = await agent.post('/api/v1/transactions').send(expense(w, '10.00', '2027-03-18T10:00:00-05:00', { itemId: w.salary.id }));
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error.code).toBe('KIND_MISMATCH');
  });

  it('rejects currency mismatches (FR-032)', async () => {
    const { agent, w } = await fresh();
    const txCurrency = await agent.post('/api/v1/transactions').send(expense(w, '10.00', '2027-03-18T10:00:00-05:00', { currency: 'COP' }));
    expect(txCurrency.body.error.code).toBe('CURRENCY_MISMATCH');
    const accountCurrency = await agent
      .post('/api/v1/transactions')
      .send(expense(w, '10.00', '2027-03-18T10:00:00-05:00', { financialAccountId: w.pesos.id }));
    expect(accountCurrency.status).toBe(422);
    expect(accountCurrency.body.error.code).toBe('CURRENCY_MISMATCH');
  });

  it('rejects dates outside the item range (FR-028)', async () => {
    const { agent, w } = await fresh();
    const res = await agent.post('/api/v1/transactions').send(expense(w, '10.00', '2028-01-10T10:00:00-05:00'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_ITEM_RANGE');
  });

  it('accepts unplanned spending on the system item', async () => {
    const { agent, w } = await fresh();
    const res = await agent.post('/api/v1/transactions').send(expense(w, '300.00', '2027-03-10T10:00:00-05:00', { itemId: w.unplannedExpense.id }));
    expect(res.status).toBe(201);
    const budget = (await agent.get(`/api/v1/budgets/${w.budget.id}`)).body;
    expect(budget.totals.unbudgetedExpense).toBe('300.00');
  });
});

describe('editing and deleting (FR-021, FR-031)', () => {
  it('recalculates buckets and balances on update and delete', async () => {
    const { agent, w } = await fresh();
    const created = (await agent.post('/api/v1/transactions').send(expense(w, '5000.00', '2027-03-18T10:00:00-05:00'))).body.transaction;
    const moved = await agent.put(`/api/v1/transactions/${created.id}`).send(expense(w, '4800.00', '2027-04-18T10:00:00-05:00'));
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const buckets = await bucketsOf(agent, w.rent.id);
    expect(buckets.find((b) => b.startDate === '2027-03-05')!.actualAmount).toBe('0.00');
    expect(buckets.find((b) => b.startDate === '2027-04-05')!.actualAmount).toBe('4800.00');
    expect(await balanceOf(agent, w.checking.id)).toBe('5200.00');

    expect((await agent.delete(`/api/v1/transactions/${created.id}`)).status).toBe(204);
    expect(await balanceOf(agent, w.checking.id)).toBe('10000.00');
    expect((await bucketsOf(agent, w.rent.id)).every((b) => b.actualAmount === '0.00')).toBe(true);
  });

  it('keeps the original time zone when the profile changes or the update omits it', async () => {
    const { agent, w } = await fresh();
    const created = (await agent.post('/api/v1/transactions').send(expense(w, '50.00', '2027-03-18T23:30:00-05:00'))).body.transaction;
    const profile = (await agent.get('/api/v1/me')).body.profile;
    expect((await agent.put('/api/v1/me/profile').send({ ...profile, timeZone: 'Asia/Tokyo' })).status).toBe(200);
    const after = (await agent.get(`/api/v1/transactions/${created.id}`)).body;
    expect(after).toMatchObject({ timeZone: 'America/Bogota', localDate: '2027-03-18' });
    const updated = await agent.put(`/api/v1/transactions/${created.id}`).send(expense(w, '60.00', '2027-03-18T23:30:00-05:00'));
    expect(updated.body.transaction).toMatchObject({ timeZone: 'America/Bogota', localDate: '2027-03-18' });
  });
});

describe('schedules, cascades and in-use protection (FR-011, FR-020)', () => {
  it('keeps transactions when an item schedule changes, and blocks changes that would orphan them', async () => {
    const { agent, w } = await fresh();
    await agent.post('/api/v1/transactions').send(expense(w, '5000.00', '2027-03-18T10:00:00-05:00'));
    const body = { name: 'Rent', description: 'Apartment', estimatedAmount: '5000.00', estimatedExecutionDate: '2027-02-10', frequency: 'QUARTERLY' };
    const quarterly = await agent.put(`/api/v1/items/${w.rent.id}`).send(body);
    expect(quarterly.status, JSON.stringify(quarterly.body)).toBe(200);
    expect(quarterly.body.buckets.reduce((s: number, b: { actualAmount: string }) => s + Number(b.actualAmount), 0)).toBe(5000);
    const narrowed = await agent.put(`/api/v1/items/${w.rent.id}`).send({ ...body, startDate: '2027-06-01', estimatedExecutionDate: '2027-06-10' });
    expect(narrowed.status).toBe(409);
    expect(narrowed.body.error.code).toBe('TRANSACTIONS_OUT_OF_RANGE');
  });

  it('blocks deleting accounts, payors and vendors with transactions', async () => {
    const { agent, w } = await fresh();
    await agent.post('/api/v1/transactions').send(expense(w, '10.00', '2027-03-18T10:00:00-05:00'));
    expect((await agent.delete(`/api/v1/vendors/${w.landlord.id}`)).body.error.code).toBe('IN_USE');
    expect((await agent.delete(`/api/v1/financial-accounts/${w.checking.id}`)).body.error.code).toBe('IN_USE');
  });

  it.each(['budget', 'category', 'item'] as const)('deleting a %s with transactions succeeds and restores balances', async (what) => {
    const { agent, w } = await fresh();
    await agent.post('/api/v1/transactions').send(expense(w, '5000.00', '2027-03-18T10:00:00-05:00'));
    await agent.post('/api/v1/transactions').send(expense(w, '100.00', '2027-05-18T10:00:00-05:00'));
    expect(await balanceOf(agent, w.checking.id)).toBe('4900.00');
    const path = { budget: `/budgets/${w.budget.id}`, category: `/categories/${w.housing.id}`, item: `/items/${w.rent.id}` }[what];
    const res = await agent.delete(`/api/v1${path}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(await balanceOf(agent, w.checking.id)).toBe('10000.00');
  });
});

describe('listing (FR-034)', () => {
  it('filters and paginates newest first', async () => {
    const { agent, w } = await fresh();
    for (const day of ['10', '11', '12']) {
      await agent.post('/api/v1/transactions').send(expense(w, '1.00', `2027-03-${day}T10:00:00-05:00`));
    }
    await agent.post('/api/v1/transactions').send({
      kind: 'INCOME', amount: '9850.00', currency: 'USD', occurredAt: '2027-03-15T08:00:00-05:00',
      itemId: w.salary.id, financialAccountId: w.checking.id, payorId: w.acme.id,
    });
    const page1 = (await agent.get('/api/v1/transactions?kind=EXPENSE&limit=2')).body;
    expect(page1.data.map((t: { localDate: string }) => t.localDate)).toEqual(['2027-03-12', '2027-03-11']);
    const page2 = (await agent.get(`/api/v1/transactions?kind=EXPENSE&limit=2&cursor=${page1.nextCursor}`)).body;
    expect(page2.data.map((t: { localDate: string }) => t.localDate)).toEqual(['2027-03-10']);
    expect(page2.nextCursor).toBeNull();
    const ranged = (await agent.get('/api/v1/transactions?from=2027-03-11&to=2027-03-15')).body.data;
    expect(ranged).toHaveLength(3);
    expect((await agent.get(`/api/v1/transactions?payorId=${w.acme.id}`)).body.data).toHaveLength(1);
  });

  it("returns 404 for another user's transaction (FR-006)", async () => {
    const { agent, w } = await fresh();
    const t = (await agent.post('/api/v1/transactions').send(expense(w, '1.00', '2027-03-10T10:00:00-05:00'))).body.transaction;
    const other = await createUserAgent();
    expect((await other.agent.get(`/api/v1/transactions/${t.id}`)).status).toBe(404);
    expect((await other.agent.delete(`/api/v1/transactions/${t.id}`)).status).toBe(404);
  });
});
