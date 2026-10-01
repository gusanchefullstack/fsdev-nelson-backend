import { Router } from 'express';
import { requireProfile, requireSession } from './middleware/auth.js';

// Routes that work before the profile is complete (US1)
export const sessionRouter = Router();
sessionRouter.use(requireSession);

// Everything else requires a completed profile (FR-003)
export const appRouter = Router();
appRouter.use(requireSession, requireProfile);
