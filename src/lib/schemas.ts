import { z } from 'zod';

export const idParams = z.object({ id: z.uuid('Invalid id') });
export const isoDate = (label = 'Date') => z.iso.date(`${label} must be a valid date (YYYY-MM-DD)`);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullish()
    // undefined = "not sent" (keep current value); empty string = clear
    .transform((v) => (v === undefined ? undefined : v || null));
export const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);
