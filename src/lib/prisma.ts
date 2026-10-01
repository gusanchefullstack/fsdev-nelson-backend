import { PrismaNeon } from '@prisma/adapter-neon';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

export const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = typeof prisma | Tx;
