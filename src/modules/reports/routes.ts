import { Router } from 'express';
import { z } from 'zod';
import { idParams } from '../../lib/schemas.js';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as service from './service.js';

const fvaQuery = z.object({ level: z.enum(['budget', 'category', 'item']), targetId: z.uuid().optional() });
const topQuery = z.object({
  n: z.coerce.number().refine((v) => v === 5 || v === 10, 'Use 5 or 10').default(5),
  by: z.enum(['item', 'counterparty']).default('item'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const reportsRouter = Router();

reportsRouter.get('/budgets/:id/reports/forecast-vs-actual', validate({ params: idParams, query: fvaQuery }), async (req, res) => {
  const q = res.locals.query as z.infer<typeof fvaQuery>;
  res.json(await service.forecastVsActual(userIdOf(res.locals), req.params.id as string, q.level, q.targetId, timeZoneOf(res.locals)));
});

reportsRouter.get('/budgets/:id/reports/top', validate({ params: idParams, query: topQuery }), async (req, res) => {
  res.json(await service.topN(userIdOf(res.locals), req.params.id as string, res.locals.query as z.infer<typeof topQuery>));
});

reportsRouter.get('/budgets/:id/reports/projection', validate({ params: idParams }), async (req, res) => {
  res.json(await service.projection(userIdOf(res.locals), req.params.id as string, timeZoneOf(res.locals)));
});

reportsRouter.get('/budgets/:id/reports/insights', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.insights(userIdOf(res.locals), req.params.id as string, timeZoneOf(res.locals)) });
});
