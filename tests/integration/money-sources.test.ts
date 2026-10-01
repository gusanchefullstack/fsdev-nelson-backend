import { beforeAll, describe, expect, it } from 'vitest';
import { createUserAgent } from '../helpers/agents.js';
import { resetDb } from '../helpers/db.js';

beforeAll(resetDb);

const account = { name: 'Main Checking', type: 'CHECKING', currency: 'USD', openingBalance: '10000.00' };
const payor = { name: 'Acme Corp', type: 'EMPLOYER', currency: 'USD' };
const vendor = { name: 'PGE', type: 'UTILITY', currency: 'USD', phone: '+14155550123', country: 'US' };

describe('financial accounts (FR-007, FR-008)', () => {
  it('creates, reads, updates and deletes', async () => {
    const { agent } = await createUserAgent();
    const created = await agent.post('/api/v1/financial-accounts').send(account);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ currentBalance: '10000.00', inUse: false });

    const updated = await agent
      .put(`/api/v1/financial-accounts/${created.body.id}`)
      .send({ ...account, name: 'Checking', openingBalance: '12000.00' });
    expect(updated.status).toBe(200);
    // Changing the opening balance shifts the current balance by the same amount
    expect(updated.body).toMatchObject({ name: 'Checking', currentBalance: '12000.00' });

    expect((await agent.get('/api/v1/financial-accounts')).body.data).toHaveLength(1);
    expect((await agent.delete(`/api/v1/financial-accounts/${created.body.id}`)).status).toBe(204);
    expect((await agent.get(`/api/v1/financial-accounts/${created.body.id}`)).status).toBe(404);
  });

  it('requires name, type, currency and opening balance with field messages', async () => {
    const { agent } = await createUserAgent();
    const res = await agent.post('/api/v1/financial-accounts').send({});
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['name', 'type', 'currency', 'openingBalance']));
  });

  it('rejects duplicate names per user and invalid phone numbers', async () => {
    const { agent } = await createUserAgent();
    await agent.post('/api/v1/financial-accounts').send(account);
    const dup = await agent.post('/api/v1/financial-accounts').send(account);
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields).toHaveProperty('name');
    const phone = await agent.post('/api/v1/financial-accounts').send({ ...account, name: 'Other', phone: '+1123' });
    expect(phone.status).toBe(422);
    expect(phone.body.error.fields).toHaveProperty('phone');
  });

  it('allows negative opening balances (credit cards, overdraft)', async () => {
    const { agent } = await createUserAgent();
    const res = await agent.post('/api/v1/financial-accounts').send({ ...account, name: 'Amex', type: 'CREDIT_CARD', openingBalance: '-850.25' });
    expect(res.status).toBe(201);
    expect(res.body.currentBalance).toBe('-850.25');
  });
});

describe('payors and vendors (FR-009, FR-010)', () => {
  it('creates, updates and deletes payors and vendors', async () => {
    const { agent } = await createUserAgent();
    const p = await agent.post('/api/v1/payors').send(payor);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const v = await agent.post('/api/v1/vendors').send(vendor);
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.phone).toBe('+14155550123');

    expect((await agent.put(`/api/v1/payors/${p.body.id}`).send({ ...payor, description: 'Salary' })).body.description).toBe('Salary');
    expect((await agent.get('/api/v1/vendors')).body.data).toHaveLength(1);
    expect((await agent.delete(`/api/v1/payors/${p.body.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/v1/vendors/${v.body.id}`)).status).toBe(204);
  });

  it('validates the type list', async () => {
    const { agent } = await createUserAgent();
    const res = await agent.post('/api/v1/vendors').send({ ...vendor, type: 'CHECKING' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toHaveProperty('type');
  });
});

describe('data isolation (FR-006)', () => {
  it("hides another user's accounts, payors and vendors", async () => {
    const a = await createUserAgent();
    const b = await createUserAgent();
    const acc = (await a.agent.post('/api/v1/financial-accounts').send(account)).body;
    const pay = (await a.agent.post('/api/v1/payors').send(payor)).body;
    const ven = (await a.agent.post('/api/v1/vendors').send(vendor)).body;
    expect((await b.agent.get(`/api/v1/financial-accounts/${acc.id}`)).status).toBe(404);
    expect((await b.agent.put(`/api/v1/payors/${pay.id}`).send(payor)).status).toBe(404);
    expect((await b.agent.delete(`/api/v1/vendors/${ven.id}`)).status).toBe(404);
    expect((await b.agent.get('/api/v1/financial-accounts')).body.data).toHaveLength(0);
  });
});
