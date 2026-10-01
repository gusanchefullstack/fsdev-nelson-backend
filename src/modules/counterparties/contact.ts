import { isValidPhoneNumber } from 'libphonenumber-js';
import { z } from 'zod';
import { optionalText } from '../../lib/schemas.js';

/** Optional contact fields shared by accounts, payors and vendors. */
export const contactFields = {
  address: optionalText(120),
  city: optionalText(120),
  postalCode: optionalText(20),
  state: optionalText(120),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Choose a country from the list')
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .refine((v) => v === '' || isValidPhoneNumber(v), 'This phone number is not valid for the selected country')
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
};

export const contactSelect = { address: true, city: true, postalCode: true, state: true, country: true, phone: true } as const;
