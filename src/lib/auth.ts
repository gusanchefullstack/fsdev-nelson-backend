import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { env } from '../config/env.js';
import { newId } from './ids.js';
import { prisma } from './prisma.js';

export const USERNAME_PATTERN = /^[a-z0-9_.]+$/;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
  user: {
    additionalFields: {
      theme: { type: 'string', required: false, defaultValue: 'SYSTEM', input: false },
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => USERNAME_PATTERN.test(value.toLowerCase()),
    }),
  ],
  trustedOrigins: [env.FRONTEND_ORIGIN],
  rateLimit: { enabled: env.NODE_ENV === 'production', window: 60, max: 100 },
  advanced: {
    database: { generateId: () => newId() },
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
  },
  hooks: {
    before: createAuthMiddleware((ctx) => {
      if (ctx.path !== '/sign-up/email') return Promise.resolve();
      const password = (ctx.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== 'string' || !PASSWORD_RULE.test(password)) {
        throw new APIError('BAD_REQUEST', {
          message: 'Use at least 8 characters with at least one letter and one number.',
        });
      }
      return Promise.resolve();
    }),
  },
});

export type AuthSession = typeof auth.$Infer.Session;
