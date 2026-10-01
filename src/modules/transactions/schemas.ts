import { z } from 'zod';
import { moneySchema } from '../../lib/money.js';
import { optionalText } from '../../lib/schemas.js';
import { isValidTimeZone } from '../../lib/temporal.js';

const uuid = (label: string) => z.uuid(`Choose ${label}`);

export const transactionInputSchema = z
  .object({
    kind: z.enum(['INCOME', 'EXPENSE'], { error: 'Choose income or expense' }),
    amount: moneySchema.refine((v) => Number(v) > 0, 'Enter an amount greater than 0'),
    currency: z.enum(['USD', 'COP'], { error: 'Choose a currency' }),
    occurredAt: z.iso.datetime({ offset: true, error: 'Enter a valid date and time' }),
    timeZone: z.string().refine(isValidTimeZone, 'Choose a valid time zone').optional(),
    itemId: uuid('a budget item'),
    financialAccountId: uuid('an account'),
    payorId: z.uuid().nullish(),
    vendorId: z.uuid().nullish(),
    note: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'INCOME' && !v.payorId) ctx.addIssue({ code: 'custom', path: ['payorId'], message: 'Choose who paid you' });
    if (v.kind === 'EXPENSE' && !v.vendorId) ctx.addIssue({ code: 'custom', path: ['vendorId'], message: 'Choose who you paid' });
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const listQuerySchema = z.object({
  budgetId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  financialAccountId: z.uuid().optional(),
  payorId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
