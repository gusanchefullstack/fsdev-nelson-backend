import { Router } from 'express';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { idParams } from '../../lib/schemas.js';
import { budgetCreateSchema, budgetUpdateSchema } from './schemas.js';
import * as service from './service.js';

export const budgetsRouter = Router();

budgetsRouter.get('/budgets', async (_req, res) => {
  res.json({ data: await service.list(userIdOf(res.locals), timeZoneOf(res.locals)) });
});

budgetsRouter.post('/budgets', validate({ body: budgetCreateSchema }), async (req, res) => {
  res.status(201).json(await service.create(userIdOf(res.locals), bodyOf(req, budgetCreateSchema), timeZoneOf(res.locals)));
});

budgetsRouter.get('/budgets/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.get(userIdOf(res.locals), req.params.id as string, timeZoneOf(res.locals)));
});

budgetsRouter.patch('/budgets/:id', validate({ params: idParams, body: budgetUpdateSchema }), async (req, res) => {
  res.json(await service.update(userIdOf(res.locals), req.params.id as string, bodyOf(req, budgetUpdateSchema), timeZoneOf(res.locals)));
});

budgetsRouter.delete('/budgets/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(userIdOf(res.locals), req.params.id as string);
  res.status(204).end();
});

budgetsRouter.get('/budgets/:id/deletion-impact', validate({ params: idParams }), async (req, res) => {
  res.json(await service.deletionImpact(userIdOf(res.locals), req.params.id as string));
});
