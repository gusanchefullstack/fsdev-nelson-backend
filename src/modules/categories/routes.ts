import { Router } from 'express';
import { userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import { idParams } from '../../lib/schemas.js';
import { categoryCreateSchema, categoryUpdateSchema } from './schemas.js';
import * as service from './service.js';

export const categoriesRouter = Router();

categoriesRouter.post('/budgets/:id/categories', validate({ params: idParams, body: categoryCreateSchema }), async (req, res) => {
  res.status(201).json(await service.create(userIdOf(res.locals), req.params.id as string, bodyOf(req, categoryCreateSchema)));
});

categoriesRouter.patch('/categories/:id', validate({ params: idParams, body: categoryUpdateSchema }), async (req, res) => {
  res.json(await service.update(userIdOf(res.locals), req.params.id as string, bodyOf(req, categoryUpdateSchema)));
});

categoriesRouter.delete('/categories/:id', validate({ params: idParams }), async (req, res) => {
  await service.remove(userIdOf(res.locals), req.params.id as string);
  res.status(204).end();
});

categoriesRouter.get('/categories/:id/deletion-impact', validate({ params: idParams }), async (req, res) => {
  res.json(await service.deletionImpact(userIdOf(res.locals), req.params.id as string));
});
