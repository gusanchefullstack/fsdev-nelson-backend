import { prisma } from '../../src/lib/prisma.js';

/** Empties every table on the test branch (order respects foreign keys). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "Alert", "Transaction", "Bucket", "BudgetItem", "Category", "Budget",
      "FinancialAccount", "Payor", "Vendor", "Profile", "Session", "Account", "Verification", "User"
    RESTART IDENTITY CASCADE`);
}
