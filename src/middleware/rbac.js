// RBAC: usage -> router.post('/', requireAuth, requireRole('manager'), handler)
import { httpError } from './errorHandler.js';

export const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user) return next(httpError(401, 'Login required'));
  if (req.user.role === 'manager') return next(); // manager = super admin
  if (!allowed.includes(req.user.role)) return next(httpError(403, 'You do not have permission'));
  next();
};
