export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'PROFILE_INCOMPLETE'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'IN_USE'
  | 'SYSTEM_RECORD'
  | 'BUDGET_OVERLAP'
  | 'TRANSACTIONS_OUT_OF_RANGE'
  | 'OUTSIDE_ITEM_RANGE'
  | 'CURRENCY_MISMATCH'
  | 'KIND_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** Expected, user-facing error. `message` must be friendly and safe to display. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'item'): AppError =>
  new AppError(404, 'NOT_FOUND', `We couldn't find that ${what}.`);
