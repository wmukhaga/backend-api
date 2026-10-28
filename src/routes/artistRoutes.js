import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { httpError, wrap } from '../middleware/errorHandler.js';

const r = Router();
// ADMIN side
r.get('/', requireAuth, requireRole('coordinator', 'hospitality'), wrap(async (req, res) => { throw httpError(501, 'TODO: list artists by event'); }));
r.post('/', requireAuth, requireRole('coordinator'), wrap(async (req, res) => { throw httpError(501, 'TODO: add artist to event, email verification link'); }));
// ARTIST side (no password: token from emailed link, artists.verification_token)
r.post('/verify/:token', wrap(async (req, res) => { throw httpError(501, 'TODO: mark verified, return short-lived artist token'); }));
r.put('/me/profile', wrap(async (req, res) => { throw httpError(501, 'TODO: update preferences JSON'); }));
r.post('/me/entourage', wrap(async (req, res) => { throw httpError(501, 'TODO: register entourage member, send verification'); }));
export default r;
