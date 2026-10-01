import type { RequestHandler } from 'express';
import type { z } from 'zod';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/** Validates and replaces req.body / req.params; parsed query goes to res.locals.query. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) res.locals.query = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  };

/** Typed access to a body already validated by `validate({ body: schema })`. */
export const bodyOf = <S extends z.ZodType>(req: { body: unknown }, _schema: S): z.infer<S> => req.body as z.infer<S>;
