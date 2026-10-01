import type { Router } from 'express';
import { appRouter, sessionRouter } from '../routes.js';

/** Each feature module registers its routes here. */
export function mountModules(api: Router): void {
  api.use(sessionRouter);
  api.use(appRouter);
}
