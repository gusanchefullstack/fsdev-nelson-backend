import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';
import { AppError } from '../errors.js';
import { auth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export interface AuthedLocals {
  userId: string;
  timeZone: string;
}

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Please log in again.');
  }
  res.locals.userId = session.user.id;
  next();
};

/** Blocks the app until the profile is complete (FR-003); exposes the profile time zone. */
export const requireProfile: RequestHandler = async (_req, res, next) => {
  const profile = await prisma.profile.findUnique({
    where: { userId: res.locals.userId as string },
    select: { timeZone: true },
  });
  if (!profile) {
    throw new AppError(403, 'PROFILE_INCOMPLETE', 'Please complete your profile to continue.');
  }
  res.locals.timeZone = profile.timeZone;
  next();
};

export const userIdOf = (locals: Record<string, unknown>): string => locals.userId as string;
export const timeZoneOf = (locals: Record<string, unknown>): string => locals.timeZone as string;
