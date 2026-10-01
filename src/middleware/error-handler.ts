import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError, type ErrorCode } from '../errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { logger } from '../lib/logger.js';

interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; requestId?: string };
}

const GENERIC = 'Something went wrong on our side. Please try again.';

function fromZod(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return new AppError(422, 'VALIDATION_FAILED', 'Please check the highlighted fields.', fields);
}

// Postgres errors can arrive wrapped by the driver adapter; look for a SQLSTATE anywhere
function pgCode(err: unknown): string | undefined {
  const text = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})) ?? '';
  return /23P01/.test(text) ? '23P01' : /23503|23001/.test(text) ? '23503' : undefined;
}

function fromPrisma(err: Prisma.PrismaClientKnownRequestError): AppError | undefined {
  switch (err.code) {
    case 'P2002': {
      const target = (err.meta?.target as string[] | string | undefined)?.toString() ?? '';
      const field = target.includes('name') ? 'name' : target.includes('username') ? 'username' : '_';
      return new AppError(409, 'CONFLICT', 'That name is already in use. Please choose another.', {
        [field]: 'Already in use',
      });
    }
    case 'P2003':
    case 'P2014':
      return new AppError(409, 'IN_USE', 'This record is in use by other records, so it can\'t be deleted.');
    case 'P2025':
      return new AppError(404, 'NOT_FOUND', "We couldn't find that item.");
    default:
      return undefined;
  }
}

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return fromZod(err);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return new AppError(413, 'FILE_TOO_LARGE', 'Images must be 2 MB or smaller.');
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return new AppError(400, 'VALIDATION_FAILED', 'The request could not be read. Please try again.');
  }
  const code = pgCode(err);
  if (code === '23P01') {
    return new AppError(
      409,
      'BUDGET_OVERLAP',
      'You already have a budget in this currency for part of this period. Choose dates that don\'t overlap.',
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) return fromPrisma(err);
  if (code === '23503') {
    return new AppError(409, 'IN_USE', 'This record is in use by other records, so it can\'t be deleted.');
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const requestId = res.locals.requestId as string | undefined;
  const known = toAppError(err);
  if (known) {
    if (known.status >= 500) logger.error({ err, requestId }, known.message);
    const body: ErrorBody = { error: { code: known.code, message: known.message, requestId } };
    if (known.fields) body.error.fields = known.fields;
    res.status(known.status).json(body);
    return;
  }
  // Unknown failure: full details in logs only (Principle IV)
  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: GENERIC, requestId } } satisfies ErrorBody);
};
