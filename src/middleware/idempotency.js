// Double-charge protection. The client generates a unique key per checkout attempt
import { httpError } from './errorHandler.js';

export const requireIdempotencyKey = (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key || key.length < 16) return next(httpError(400, 'Idempotency-Key header required'));
  req.idempotencyKey = key;
  next();
};
