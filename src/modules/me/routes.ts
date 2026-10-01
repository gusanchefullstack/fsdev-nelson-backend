import { Router } from 'express';
import { userIdOf } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { avatarUpload, storeAvatar } from './avatar.js';
import { preferencesSchema, profileSchema } from './schemas.js';
import * as service from './service.js';

// Mounted on the session router: works before the profile exists
export const meRouter = Router();

meRouter.get('/me', async (_req, res) => {
  res.json(await service.getMe(userIdOf(res.locals)));
});

meRouter.put('/me/profile', validate({ body: profileSchema }), async (req, res) => {
  res.json(await service.upsertProfile(userIdOf(res.locals), req.body));
});

meRouter.patch('/me/preferences', validate({ body: preferencesSchema }), async (req, res) => {
  await service.updateTheme(userIdOf(res.locals), (req.body as { theme: 'SYSTEM' | 'LIGHT' | 'DARK' }).theme);
  res.status(204).end();
});

meRouter.put('/me/avatar', avatarUpload, async (req, res) => {
  const userId = userIdOf(res.locals);
  const avatarUrl = await storeAvatar(userId, req.file);
  await service.setAvatar(userId, avatarUrl);
  res.json({ avatarUrl });
});
