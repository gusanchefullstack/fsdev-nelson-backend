import { expect } from 'vitest';
import type { Agent } from './agents.js';

/** Builds the quickstart world: USD 2027 budget, Housing/Rent, Salaries/Salary, accounts, payor, vendor. */
export async function setupWorld(agent: Agent) {
  const post = async (path: string, body: object) => {
    const res = await agent.post(`/api/v1${path}`).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body;
  };
  const budget = await post('/budgets', { name: 'Household 2027', currency: 'USD', startDate: '2027-01-01', endDate: '2027-12-31' });
  const housing = await post(`/budgets/${budget.id}/categories`, { kind: 'EXPENSE', name: 'Housing' });
  const salaries = await post(`/budgets/${budget.id}/categories`, { kind: 'INCOME', name: 'Salaries' });
  const rent = await post(`/categories/${housing.id}/items`, {
    name: 'Rent',
    description: 'Apartment',
    estimatedAmount: '5000.00',
    estimatedExecutionDate: '2027-01-20',
    frequency: 'MONTHLY',
  });
  const salary = await post(`/categories/${salaries.id}/items`, {
    name: 'Salary',
    description: 'Monthly pay',
    estimatedAmount: '9850.00',
    estimatedExecutionDate: '2027-01-15',
    frequency: 'MONTHLY',
  });
  const checking = await post('/financial-accounts', { name: 'Main Checking', type: 'CHECKING', currency: 'USD', openingBalance: '10000.00' });
  const pesos = await post('/financial-accounts', { name: 'Pesos', type: 'SAVINGS', currency: 'COP', openingBalance: '0' });
  const acme = await post('/payors', { name: 'Acme Corp', type: 'EMPLOYER', currency: 'USD' });
  const landlord = await post('/vendors', { name: 'Landlord', type: 'HOUSING', currency: 'USD' });
  const detail = (await agent.get(`/api/v1/budgets/${budget.id}`)).body;
  const unplannedExpense = detail.categories.find((c: { isSystem: boolean; kind: string }) => c.isSystem && c.kind === 'EXPENSE').items[0];
  return { budget, housing, salaries, rent, salary, checking, pesos, acme, landlord, unplannedExpense };
}

export type World = Awaited<ReturnType<typeof setupWorld>>;

export const expense = (w: World, amount: string, occurredAt: string, extra: object = {}) => ({
  kind: 'EXPENSE',
  amount,
  currency: 'USD',
  occurredAt,
  itemId: w.rent.id,
  financialAccountId: w.checking.id,
  vendorId: w.landlord.id,
  ...extra,
});
