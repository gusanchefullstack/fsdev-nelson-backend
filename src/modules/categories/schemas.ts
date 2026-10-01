import { z } from 'zod';
import { optionalText, requiredText } from '../../lib/schemas.js';

export const categoryCreateSchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE'], { error: 'Choose income or expense' }),
  name: requiredText('Name', 80),
  description: optionalText(500),
});

export const categoryUpdateSchema = z.object({
  name: requiredText('Name', 80).optional(),
  description: optionalText(500),
});

export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
