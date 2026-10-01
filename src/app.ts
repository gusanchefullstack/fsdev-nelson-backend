import { toNodeHandler } from 'better-auth/node';
import express from 'express';
// Vercel's builder reads helmet's CommonJS typings, where neither the default import nor `.default`
// type-checks as callable; at runtime `.default` is the middleware factory in both module systems
import * as Helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { AppError } from './errors.js';
import { auth } from './lib/auth.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { mountModules } from './modules/index.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
const helmet = Helmet.default as unknown as () => express.RequestHandler;
app.use(helmet());
app.use(requestId);
app.use(pinoHttp({ logger, customProps: (_req, res) => ({ requestId: res.locals.requestId as string }) }));

// Better Auth must see the raw body, so it is mounted before express.json()
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '100kb' }));

const api = express.Router();
mountModules(api);
app.use('/api/v1', api);

app.use(() => {
  throw new AppError(404, 'NOT_FOUND', "We couldn't find what you were looking for.");
});
app.use(errorHandler);

export default app;
