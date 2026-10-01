import { AppError } from '../../errors.js';
import type { Budget } from '../../generated/prisma/client.js';
import { toDecimal } from '../../lib/money.js';
import { fromPlainDate, toPlainDate } from '../../lib/temporal.js';
import type { ItemInput } from './schemas.js';

const cmp = (a: Temporal.PlainDate, b: Temporal.PlainDate) => Temporal.PlainDate.compare(a, b);

/**
 * Applies the item date rules against its budget (FR-016, FR-017):
 * defaults to the budget range, start ≥ budget start, end clipped to budget end,
 * execution date inside the item range, user items need an amount > 0.
 */
export function resolveItemData(input: ItemInput, budget: Budget, opts: { isSystem?: boolean } = {}) {
  const budgetStart = toPlainDate(budget.startDate);
  const budgetEnd = toPlainDate(budget.endDate);
  const start = input.startDate ? Temporal.PlainDate.from(input.startDate) : budgetStart;
  let end = input.endDate ? Temporal.PlainDate.from(input.endDate) : budgetEnd;
  const exec = Temporal.PlainDate.from(input.estimatedExecutionDate);
  const adjustments: 'END_DATE_CLIPPED'[] = [];
  const fields: Record<string, string> = {};

  if (cmp(end, budgetEnd) > 0) {
    end = budgetEnd;
    adjustments.push('END_DATE_CLIPPED');
  }
  if (cmp(start, budgetStart) < 0) fields.startDate = "Start date can't be before the budget starts";
  else if (cmp(start, budgetEnd) > 0) fields.startDate = "Start date can't be after the budget ends";
  if (cmp(end, start) < 0) fields.endDate = 'End date must be on or after the start date';
  if (cmp(exec, start) < 0 || cmp(exec, end) > 0) {
    fields.estimatedExecutionDate = 'Execution date must fall between the start and end dates';
  }
  if (!opts.isSystem && Number(input.estimatedAmount) <= 0) fields.estimatedAmount = 'Enter an amount greater than 0';
  if (Object.keys(fields).length) throw new AppError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', fields);

  return {
    data: {
      name: input.name,
      description: input.description,
      startDate: fromPlainDate(start),
      endDate: fromPlainDate(end),
      estimatedAmount: toDecimal(input.estimatedAmount),
      estimatedExecutionDate: fromPlainDate(exec),
      frequency: input.frequency,
      customInterval: input.frequency === 'CUSTOM' ? (input.customInterval ?? null) : null,
      customUnit: input.frequency === 'CUSTOM' ? (input.customUnit ?? null) : null,
    },
    adjustments,
  };
}
