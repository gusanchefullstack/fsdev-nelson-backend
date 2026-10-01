import type { Tx } from '../lib/prisma.js';

type AlertHook = (tx: Tx, budgetId: string, bucketIds: string[]) => Promise<unknown>;

let alertHook: AlertHook = () => Promise.resolve([]);

/** Lets the alerts module plug into bucket changes without circular imports. */
export function setAlertHook(fn: AlertHook): void {
  alertHook = fn;
}

export const runAlertHook: AlertHook = (tx, budgetId, bucketIds) => alertHook(tx, budgetId, bucketIds);
