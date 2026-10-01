import type { Router } from 'express';
import { appRouter, sessionRouter } from '../routes.js';
import { budgetsRouter } from './budgets/routes.js';
import { categoriesRouter } from './categories/routes.js';
import { itemsRouter } from './items/routes.js';
import { meRouter } from './me/routes.js';

/** Each feature module registers its routes here. */
export function mountModules(api: Router): void {
  // Session only (profile may be incomplete)
  sessionRouter.use(meRouter);
  api.use((req, res, next) => (req.path.startsWith('/me') ? sessionRouter(req, res, next) : next()));
  // Everything else needs a completed profile
  appRouter.use(budgetsRouter, categoriesRouter, itemsRouter);
  api.use(appRouter);
}
