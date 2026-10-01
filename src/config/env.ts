import { z } from 'zod';
import { logger } from '../lib/logger.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  FRONTEND_ORIGIN: z.url(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Configuration errors are for operators only; never leak to clients
    logger.fatal({ issues: z.treeifyError(parsed.error) }, 'Invalid environment configuration');
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
