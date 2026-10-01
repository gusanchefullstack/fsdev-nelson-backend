/**
 * Performance check for SC-005: one user, a one-year budget with 50 items and 2,000 transactions,
 * then times the dashboard and report endpoints. Run against the development branch:
 *   npx tsx --env-file=.env scripts/seed-perf.ts
 */
import 'temporal-polyfill/global';
import request from 'supertest';
import { app } from '../src/app.js';
import { findBucket } from '../src/domain/allocation.js';
import { newId } from '../src/lib/ids.js';
import { prisma } from '../src/lib/prisma.js';
import { localDateOf, toPlainDate } from '../src/lib/temporal.js';

const TARGET_MS = 2000;
const today = Temporal.Now.plainDateISO('America/Bogota');
const start = today.with({ day: 1 }).subtract({ months: 6 });
const end = start.add({ years: 1 }).subtract({ days: 1 });

async function removePerfUsers() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'perf_' } }, select: { id: true } });
  for (const { id } of users) {
    // Transactions first: they reference buckets with RESTRICT
    await prisma.transaction.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
}

async function main() {
  await removePerfUsers();
  const agent = request.agent(app);
  const tag = Date.now().toString(36);
  const signUp = await agent
    .post('/api/auth/sign-up/email')
    .set('Origin', process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .send({ email: `perf_${tag}@example.com`, password: 'Passw0rd!', name: 'Perf', username: `perf_${tag}` });
  const userId = (signUp.body as { user: { id: string } }).user.id;
  await agent.put('/api/v1/me/profile').send({
    firstName: 'Perf', lastName: 'User', username: `perf_${tag}`, address: '1 Main', city: 'Bogota', state: 'DC',
    postalCode: '110111', country: 'CO', phone: '+573001234567', timeZone: 'America/Bogota', avatarUrl: '/avatars/avatar-1.svg',
  });

  // 50 items across 10 categories, created through the API like a Complete-mode budget
  const frequencies = ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'QUARTERLY', 'MONTHLY'] as const;
  const categories = Array.from({ length: 10 }, (_, c) => ({
    kind: c < 2 ? 'INCOME' : 'EXPENSE',
    name: `Category ${c + 1}`,
    items: Array.from({ length: 5 }, (_, i) => ({
      name: `Item ${c + 1}.${i + 1}`,
      description: 'Seeded',
      estimatedAmount: String(50 + ((c * 5 + i) % 7) * 40),
      estimatedExecutionDate: start.add({ days: (c * 5 + i) % 25 }).toString(),
      frequency: frequencies[i]!,
    })),
  }));
  const budgetRes = await agent.post('/api/v1/budgets').send({ name: 'Perf year', currency: 'USD', startDate: start.toString(), endDate: end.toString(), mode: 'COMPLETE', categories });
  if (budgetRes.status !== 201) throw new Error(JSON.stringify(budgetRes.body));
  const budgetId = (budgetRes.body as { id: string }).id;
  const account = (await agent.post('/api/v1/financial-accounts').send({ name: 'Checking', type: 'CHECKING', currency: 'USD', openingBalance: '100000' })).body as { id: string };
  const vendor = (await agent.post('/api/v1/vendors').send({ name: 'Shop', type: 'RETAIL', currency: 'USD' })).body as { id: string };
  const payor = (await agent.post('/api/v1/payors').send({ name: 'Employer', type: 'EMPLOYER', currency: 'USD' })).body as { id: string };

  // 2,000 transactions spread over the elapsed part of the year, inserted in bulk
  const items = await prisma.budgetItem.findMany({ where: { category: { budgetId }, isSystem: false }, include: { buckets: true, category: true } });
  const elapsed = Math.max(start.until(today).days, 1);
  const rows = [];
  for (let n = 0; n < 2000; n++) {
    const item = items[n % items.length]!;
    const instant = Temporal.PlainDateTime.from(`${start.add({ days: n % elapsed }).toString()}T12:00`).toZonedDateTime('America/Bogota').toInstant();
    const localDate = localDateOf(instant, 'America/Bogota');
    const bucket = findBucket(item.buckets.map((b) => ({ ...b, startDate: toPlainDate(b.startDate), endDate: toPlainDate(b.endDate) })), localDate);
    if (!bucket) continue;
    const income = item.category.kind === 'INCOME';
    rows.push({
      id: newId(), userId, kind: item.category.kind, amount: String(10 + (n % 90)), currency: 'USD' as const,
      occurredAt: new Date(instant.epochMilliseconds), timeZone: 'America/Bogota', localDate: new Date(`${localDate.toString()}T00:00:00Z`),
      itemId: item.id, bucketId: bucket.id, financialAccountId: account.id,
      payorId: income ? payor.id : null, vendorId: income ? null : vendor.id,
    });
  }
  await prisma.transaction.createMany({ data: rows });
  await prisma.$executeRaw`
    UPDATE "Bucket" b SET "actualAmount" = t.total, "actualDate" = t.last
    FROM (SELECT "bucketId", SUM(amount) total, MAX("localDate") last FROM "Transaction" WHERE "userId" = ${userId}::uuid GROUP BY "bucketId") t
    WHERE b.id = t."bucketId"`;
  console.log(`Seeded ${items.length} items and ${rows.length} transactions`);

  const endpoints = [
    '/api/v1/dashboard',
    `/api/v1/budgets/${budgetId}`,
    `/api/v1/budgets/${budgetId}/reports/forecast-vs-actual?level=budget`,
    `/api/v1/budgets/${budgetId}/reports/top?n=10`,
    `/api/v1/budgets/${budgetId}/reports/projection`,
    `/api/v1/budgets/${budgetId}/reports/insights`,
    '/api/v1/transactions?limit=25',
  ];
  let failed = false;
  for (const path of endpoints) {
    await agent.get(path); // warm-up (Neon compute may be cold)
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await agent.get(path);
      times.push(performance.now() - t0);
      if (res.status !== 200) throw new Error(`${path} → ${res.status}`);
    }
    const median = times.sort((a, b) => a - b)[1]!;
    failed ||= median > TARGET_MS;
    console.log(`${median > TARGET_MS ? 'SLOW' : 'ok  '} ${median.toFixed(0).padStart(5)} ms  ${path.replace(budgetId, ':id')}`);
  }
  await removePerfUsers();
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

void main();
