import { isValidPhoneNumber } from 'libphonenumber-js';
import { z } from 'zod';
import { USERNAME_PATTERN } from '../../lib/auth.js';
import { isValidTimeZone } from '../../lib/temporal.js';

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const phoneSchema = z
  .string({ error: 'Phone number is required' })
  .regex(/^\+\d{6,15}$/, 'Enter the number with its country code')
  .refine((v) => isValidPhoneNumber(v), 'This phone number is not valid for the selected country');

export const countrySchema = z
  .string({ error: 'Country is required' })
  .regex(/^[A-Z]{2}$/, 'Choose a country from the list');

export const profileSchema = z.object({
  firstName: text('First name', 60),
  lastName: text('Last name', 60),
  username: z
    .string({ error: 'Username is required' })
    .trim()
    .toLowerCase()
    .min(3, 'Use at least 3 characters')
    .max(30, 'Use 30 characters or fewer')
    .regex(USERNAME_PATTERN, 'Use only letters, numbers, dots and underscores'),
  address: text('Address', 120),
  city: text('City', 120),
  state: text('State', 120),
  postalCode: text('Postal code', 20),
  country: countrySchema,
  phone: phoneSchema,
  timeZone: z
    .string({ error: 'Time zone is required' })
    .refine(isValidTimeZone, 'Choose a time zone from the list'),
  avatarUrl: z
    .string({ error: 'Choose an avatar' })
    .min(1, 'Choose an avatar')
    .refine((v) => v.startsWith('/avatars/') || v.startsWith('https://'), 'Choose an avatar'),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const preferencesSchema = z.object({ theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']) });
