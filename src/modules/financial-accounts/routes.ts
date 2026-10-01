import { Router } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../../errors.js';
import type { FinancialAccount } from '../../generated/prisma/client.js';
import { newId } from '../../lib/ids.js';
import { moneySchema, toDecimal, toMoneyString } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { idParams, optionalText, requiredText } from '../../lib/schemas.js';
import { userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { contactFields } from '../counterparties/contact.js';

const schema = z.object({
  name: requiredText('Name', 80),
  description: optionalText(500),
  type: z.enum(['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'DIGITAL_WALLET', 'BROKERAGE', 'LOAN', 'OTHER'], {
    error: 'Choose an account type',
  }),
  currency: z.enum(['USD', 'COP'], { error: 'Choose USD or COP' }),
  openingBalance: moneySchema,
  ...contactFields,
});

type Row = FinancialAccount & { _count: { transactions: number } };
const include = { _count: { select: { transactions: true } } } as const;

const serialize = ({ _count, ...a }: Row) => ({
  ...a,
  openingBalance: toMoneyString(a.openingBalance),
  currentBalance: toMoneyString(a.currentBalance),
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
  inUse: _count.transactions > 0,
});

async function owned(userId: string, id: string): Promise<Row> {
  const row = await prisma.financialAccount.findFirst({ where: { id, userId }, include });
  if (!row) throw notFound('account');
  return row;
}

export const financialAccountsRouter = Router();

financialAccountsRouter.get('/financial-accounts', async (_req, res) => {
  const rows = await prisma.financialAccount.findMany({ where: { userId: userIdOf(res.locals) }, orderBy: { name: 'asc' }, include });
  res.json({ data: rows.map(serialize) });
});

financialAccountsRouter.post('/financial-accounts', validate({ body: schema }), async (req, res) => {
  const input = bodyOf(req, schema);
  const row = await prisma.financialAccount.create({
    data: { id: newId(), userId: userIdOf(res.locals), ...input, currentBalance: toDecimal(input.openingBalance) },
    include,
  });
  res.status(201).json(serialize(row));
});

financialAccountsRouter.get('/financial-accounts/:id', validate({ params: idParams }), async (req, res) => {
  res.json(serialize(await owned(userIdOf(res.locals), req.params.id as string)));
});

financialAccountsRouter.put('/financial-accounts/:id', validate({ params: idParams, body: schema }), async (req, res) => {
  const id = req.params.id as string;
  const existing = await owned(userIdOf(res.locals), id);
  const input = bodyOf(req, schema);
  if (input.currency !== existing.currency && existing._count.transactions > 0) {
    throw new AppError(409, 'IN_USE', "This account has transactions, so its currency can't change.", {
      currency: "Can't change once used",
    });
  }
  // Transactions already applied stay applied: shift the balance by the opening-balance difference
  const delta = toDecimal(input.openingBalance).sub(existing.openingBalance);
  const row = await prisma.financialAccount.update({
    where: { id },
    data: { ...input, currentBalance: { increment: delta } },
    include,
  });
  res.json(serialize(row));
});

financialAccountsRouter.delete('/financial-accounts/:id', validate({ params: idParams }), async (req, res) => {
  const id = req.params.id as string;
  const row = await owned(userIdOf(res.locals), id);
  if (row._count.transactions > 0) {
    throw new AppError(409, 'IN_USE', "This account has transactions, so it can't be deleted.");
  }
  await prisma.financialAccount.delete({ where: { id } });
  res.status(204).end();
});
