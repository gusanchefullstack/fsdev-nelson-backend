import { Router } from 'express';
import { idParams } from '../../lib/schemas.js';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { listQuerySchema, transactionInputSchema, type ListQuery } from './schemas.js';
import * as service from './service.js';

export const transactionsRouter = Router();

transactionsRouter.get('/transactions', validate({ query: listQuerySchema }), async (_req, res) => {
  res.json(await service.list(userIdOf(res.locals), res.locals.query as ListQuery));
});

transactionsRouter.post('/transactions', validate({ body: transactionInputSchema }), async (req, res) => {
  res.status(201).json(await service.create(userIdOf(res.locals), bodyOf(req, transactionInputSchema), timeZoneOf(res.locals)));
});

transactionsRouter.get('/transactions/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.get(userIdOf(res.locals), req.params.id as string));
});

transactionsRouter.put('/transactions/:id', validate({ params: idParams, body: transactionInputSchema }), async (req, res) => {
  res.json(await service.update(userIdOf(res.locals), req.params.id as string, bodyOf(req, transactionInputSchema), timeZoneOf(res.locals)));
});

transactionsRouter.delete('/transactions/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(userIdOf(res.locals), req.params.id as string);
  res.status(204).end();
});
