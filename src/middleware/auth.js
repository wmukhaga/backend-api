// Verifies the JWT sent as "Authorization: Bearer <token>" (management users only)
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { httpError, wrap } from './errorHandler.js';

export const requireAuth = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw httpError(401, 'Login required');

  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch { throw httpError(401, 'Invalid or expired token'); }

  // Session must still be active (allows logout / revoke)
  const { rows } = await query(
    'SELECT is_active FROM mgt_auth WHERE token_id = $1 AND expires_at > now()',
    [payload.tokenId]
  );
  if (!rows[0]?.is_active) throw httpError(401, 'Session ended, log in again');

  req.user = { userId: payload.userId, role: payload.role, tokenId: payload.tokenId };
  next();
});
