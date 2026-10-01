import { z } from 'zod';
import { isoDate, optionalText, requiredText } from '../../lib/schemas.js';
import { categoryCreateSchema } from '../categories/schemas.js';
import { itemInputSchema } from '../items/schemas.js';

const threshold = z
  .number({ error: 'Enter a whole percentage' })
  .int('Enter a whole percentage')
  .min(1, 'Use a value from 1 to 100')
  .max(100, 'Use a value from 1 to 100');

const endAfterStart = (v: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx) => {
  if (v.startDate && v.endDate && v.endDate <= v.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after the start date' });
  }
};

export const budgetCreateSchema = z
  .object({
    name: requiredText('Name', 80),
    description: optionalText(500),
    currency: z.enum(['USD', 'COP'], { error: 'Choose USD or COP' }),
    startDate: isoDate('Start date'),
    endDate: isoDate('End date'),
    alertThresholdPct: threshold.default(10),
    mode: z.enum(['LITE', 'GUIDED', 'COMPLETE']).default('LITE'),
    categories: z.array(categoryCreateSchema.extend({ items: z.array(itemInputSchema).default([]) })).default([]),
  })
  .superRefine(endAfterStart);

export const budgetUpdateSchema = z
  .object({
    name: requiredText('Name', 80).optional(),
    description: optionalText(500),
    startDate: isoDate('Start date').optional(),
    endDate: isoDate('End date').optional(),
    alertThresholdPct: threshold.optional(),
  })
  .superRefine(endAfterStart);

export type BudgetCreate = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdate = z.infer<typeof budgetUpdateSchema>;
