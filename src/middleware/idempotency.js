// Double-charge protection. The client generates a unique key per checkout attempt
// (e.g. crypto.randomUUID() when the page loads) and sends it as a header.
// Same key twice (double click / retry) => same booking, never two.
import { httpError } from './errorHandler.js';

export const requireIdempotencyKey = (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key || key.length < 16) return next(httpError(400, 'Idempotency-Key header required'));
  req.idempotencyKey = key;
  next();
};
