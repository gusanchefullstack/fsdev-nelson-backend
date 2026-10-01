import { Router } from 'express';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { idParams } from '../../lib/schemas.js';
import { itemInputSchema } from './schemas.js';
import * as service from './service.js';

export const itemsRouter = Router();

itemsRouter.post('/categories/:id/items', validate({ params: idParams, body: itemInputSchema }), async (req, res) => {
  res.status(201).json(await service.create(userIdOf(res.locals), req.params.id as string, bodyOf(req, itemInputSchema)));
});

itemsRouter.get('/items/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.get(userIdOf(res.locals), req.params.id as string, timeZoneOf(res.locals)));
});

itemsRouter.put('/items/:id', validate({ params: idParams, body: itemInputSchema }), async (req, res) => {
  res.json(await service.update(userIdOf(res.locals), req.params.id as string, bodyOf(req, itemInputSchema), timeZoneOf(res.locals)));
});

itemsRouter.delete('/items/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(userIdOf(res.locals), req.params.id as string);
  res.status(204).end();
});

itemsRouter.get('/items/:id/deletion-impact', validate({ params: idParams }), async (req, res) => {
  res.json(await service.deletionImpact(userIdOf(res.locals), req.params.id as string));
});
