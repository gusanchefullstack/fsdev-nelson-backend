import { Router } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../../errors.js';
import { newId } from '../../lib/ids.js';
import { prisma } from '../../lib/prisma.js';
import { idParams, optionalText, requiredText } from '../../lib/schemas.js';
import { userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { contactFields } from './contact.js';

interface Row {
  id: string;
  name: string;
  description: string | null;
  type: string;
  currency: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { transactions: number };
}

/** Prisma delegate subset shared by Payor and Vendor. */
interface Delegate {
  findMany(args: object): Promise<Row[]>;
  findFirst(args: object): Promise<Row | null>;
  create(args: object): Promise<Row>;
  update(args: object): Promise<Row>;
  delete(args: object): Promise<unknown>;
}

const serialize = ({ _count, ...row }: Row) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  inUse: _count.transactions > 0,
});

/**
 * Payors (income sources) and vendors (expense destinations) have identical rules (FR-009, FR-010),
 * differing only in their type list.
 */
export function counterpartyRouter<T extends readonly [string, ...string[]]>(opts: {
  path: string;
  label: string;
  types: T;
  delegate: () => Delegate;
}) {
  const schema = z.object({
    name: requiredText('Name', 80),
    description: optionalText(500),
    type: z.enum(opts.types, { error: 'Choose a type from the list' }),
    currency: z.enum(['USD', 'COP'], { error: 'Choose USD or COP' }),
    ...contactFields,
  });
  const include = { _count: { select: { transactions: true } } };

  async function owned(userId: string, id: string) {
    const row = await opts.delegate().findFirst({ where: { id, userId }, include });
    if (!row) throw notFound(opts.label);
    return row;
  }

  const router = Router();
  router.get(`/${opts.path}`, async (_req, res) => {
    const rows = await opts.delegate().findMany({ where: { userId: userIdOf(res.locals) }, orderBy: { name: 'asc' }, include });
    res.json({ data: rows.map(serialize) });
  });
  router.post(`/${opts.path}`, validate({ body: schema }), async (req, res) => {
    const row = await opts.delegate().create({ data: { id: newId(), userId: userIdOf(res.locals), ...bodyOf(req, schema) }, include });
    res.status(201).json(serialize(row));
  });
  router.get(`/${opts.path}/:id`, validate({ params: idParams }), async (req, res) => {
    res.json(serialize(await owned(userIdOf(res.locals), req.params.id as string)));
  });
  router.put(`/${opts.path}/:id`, validate({ params: idParams, body: schema }), async (req, res) => {
    const id = req.params.id as string;
    await owned(userIdOf(res.locals), id);
    res.json(serialize(await opts.delegate().update({ where: { id }, data: bodyOf(req, schema), include })));
  });
  router.delete(`/${opts.path}/:id`, validate({ params: idParams }), async (req, res) => {
    const id = req.params.id as string;
    const row = await owned(userIdOf(res.locals), id);
    if (row._count.transactions > 0) {
      throw new AppError(409, 'IN_USE', `This ${opts.label} has transactions, so it can't be deleted.`);
    }
    await opts.delegate().delete({ where: { id } });
    res.status(204).end();
  });
  return router;
}

export const payorsRouter = counterpartyRouter({
  path: 'payors',
  label: 'payor',
  types: ['EMPLOYER', 'INVESTMENTS', 'RENTAL', 'BUSINESS_CLIENT', 'GOVERNMENT_BENEFITS', 'OTHER'] as const,
  delegate: () => prisma.payor as unknown as Delegate,
});

export const vendorsRouter = counterpartyRouter({
  path: 'vendors',
  label: 'vendor',
  types: [
    'UTILITY',
    'SUBSCRIPTION',
    'RETAIL',
    'GROCERIES',
    'RESTAURANT',
    'HOUSING',
    'HEALTHCARE',
    'INSURANCE',
    'TRANSPORTATION',
    'GOVERNMENT_TAXES',
    'OTHER',
  ] as const,
  delegate: () => prisma.vendor as unknown as Delegate,
});
