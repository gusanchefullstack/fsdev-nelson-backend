import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, env } from 'prisma/config';

// Load .env locally (or .env.test via PRISMA_ENV_FILE); in CI/Vercel variables come from the environment
const envFile = process.env.PRISMA_ENV_FILE ?? '.env';
if (existsSync(envFile)) loadEnvFile(envFile);

// Migrations use the direct (non-pooled) Neon connection
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DIRECT_URL') },
});
