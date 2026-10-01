import { z } from 'zod';
import { moneySchema } from '../../lib/money.js';
import { isoDate, requiredText } from '../../lib/schemas.js';

export const itemInputSchema = z
  .object({
    name: requiredText('Name', 80),
    description: requiredText('Description', 500),
    startDate: isoDate('Start date').optional(),
    endDate: isoDate('End date').optional(),
    estimatedAmount: moneySchema.refine((v) => Number(v) >= 0, 'Amount cannot be negative'),
    estimatedExecutionDate: isoDate('Execution date'),
    frequency: z.enum(['ONE_TIME', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'CUSTOM'], {
      error: 'Choose a frequency',
    }),
    customInterval: z.number().int().nullish(),
    customUnit: z.enum(['DAYS', 'MONTHS']).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.frequency !== 'CUSTOM') return;
    if (!v.customUnit) ctx.addIssue({ code: 'custom', path: ['customUnit'], message: 'Choose days or months' });
    const max = v.customUnit === 'MONTHS' ? 24 : 365;
    if (v.customInterval == null || v.customInterval < 1 || v.customInterval > max) {
      ctx.addIssue({ code: 'custom', path: ['customInterval'], message: `Enter a whole number from 1 to ${max}` });
    }
  });

export type ItemInput = z.infer<typeof itemInputSchema>;
