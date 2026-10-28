// Management staff auth (admin panel). Revellers never log in. Artists use an emailed link (see artistRoutes).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit, recordAction } from '../middleware/audit.js';
import { httpError, wrap } from '../middleware/errorHandler.js';

const r = Router();

// Manager creates staff accounts (no public sign-up on an admin system)
r.post('/register', requireAuth, requireRole('manager'), audit('create_user', 'mgt_users'), wrap(async (req, res) => {
  const { name, staffId, email, role, password } = req.body;
  if (!name || !staffId || !email || !role || !password) throw httpError(400, 'Missing fields');
  if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
  const hash = await bcrypt.hash(password, 12);
  const u = await query(
    'INSERT INTO mgt_users (name, staff_id, email, role) VALUES ($1,$2,$3,$4) RETURNING user_id',
    [name, staffId, email, role]);
  await query('INSERT INTO mgt_auth (user_id, password_hash) VALUES ($1,$2)', [u.rows[0].user_id, hash]);
  res.status(201).json({ userId: u.rows[0].user_id });
}));

r.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query(
    `SELECT u.user_id, u.role, a.auth_id, a.password_hash FROM mgt_users u
     JOIN mgt_auth a ON a.user_id = u.user_id WHERE u.email = $1`, [email]);
  const row = rows[0];
  // same message for wrong email/password: don't reveal which one exists
  if (!row || !(await bcrypt.compare(password || '', row.password_hash)))
    throw httpError(401, 'Invalid email or password');

  const tokenId = crypto.randomUUID();
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const token = jwt.sign({ userId: row.user_id, role: row.role, tokenId }, process.env.JWT_SECRET, { expiresIn });
  await query(
    `UPDATE mgt_auth SET is_active = true, last_login = now(), token_id = $1,
     expires_at = now() + interval '8 hours', device_metadata = $2 WHERE auth_id = $3`,
    [tokenId, JSON.stringify({ ip: req.ip, userAgent: req.headers['user-agent'] }), row.auth_id]);
  await recordAction(row.user_id, 'login', 'mgt_auth');
  res.json({ token, role: row.role });
}));

r.post('/logout', requireAuth, wrap(async (req, res) => {
  await query('UPDATE mgt_auth SET is_active = false WHERE token_id = $1', [req.user.tokenId]);
  res.json({ message: 'Logged out' });
}));

// TODO: POST /forgot-password, POST /reset-password (emailed one-time token), optional 2FA (guideline bonus)
export default r;
