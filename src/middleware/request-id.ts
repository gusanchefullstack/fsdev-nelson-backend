import type { RequestHandler } from 'express';
import { newId } from '../lib/ids.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : newId();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
