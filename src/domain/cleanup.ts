import type { Prisma } from '../generated/prisma/client.js';
import type { Tx } from '../lib/prisma.js';

/**
 * Deletes transactions explicitly after reversing their effect on account balances (FR-020, FR-021).
 * Must run before deleting a budget/category/item, because Transaction → Bucket is RESTRICT.
 */
export async function deleteTransactionsWhere(tx: Tx, where: Prisma.TransactionWhereInput): Promise<number> {
  const groups = await tx.transaction.groupBy({ by: ['financialAccountId', 'kind'], where, _sum: { amount: true } });
  for (const g of groups) {
    const amount = g._sum.amount;
    if (!amount) continue;
    // Income had increased the balance and expenses decreased it; undo that
    await tx.financialAccount.update({
      where: { id: g.financialAccountId },
      data: { currentBalance: g.kind === 'INCOME' ? { decrement: amount } : { increment: amount } },
    });
  }
  const { count } = await tx.transaction.deleteMany({ where });
  return count;
}
