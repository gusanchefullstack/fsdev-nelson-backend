import { Router } from 'express';
import { z } from 'zod';
import { idParams } from '../../lib/schemas.js';
import { timeZoneOf, userIdOf } from '../../middleware/auth.js';
import { bodyOf, validate } from '../../middleware/validate.js';
import * as service from './service.js';

const listQuery = z.object({ unreadOnly: z.enum(['true', 'false']).optional() });
const patchBody = z.object({ read: z.boolean().optional(), dismissed: z.boolean().optional() });

export const alertsRouter = Router();

alertsRouter.get('/alerts', validate({ query: listQuery }), async (_req, res) => {
  const userId = userIdOf(res.locals);
  await service.evaluateEndedIncomeBuckets(userId, timeZoneOf(res.locals));
  const q = res.locals.query as z.infer<typeof listQuery>;
  res.json(await service.listAlerts(userId, { unreadOnly: q.unreadOnly === 'true' }));
});

alertsRouter.patch('/alerts/:id', validate({ params: idParams, body: patchBody }), async (req, res) => {
  res.json(await service.updateAlert(userIdOf(res.locals), req.params.id as string, bodyOf(req, patchBody)));
});

alertsRouter.post('/alerts/read-all', async (_req, res) => {
  await service.readAll(userIdOf(res.locals));
  res.status(204).end();
});
