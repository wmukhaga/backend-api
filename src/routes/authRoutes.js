// Management staff auth (admin panel). Revellers never log in. Artists use an emailed link (see artistRoutes).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit, recordAction } from '../middleware/audit.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { sendPasswordResetEmail } from '../middleware/email.js';

const r = Router();

const MANAGEMENT_ROLES = new Set([
  'manager', 'coordinator', 'finance', 'logistics', 'production',
  'marketing', 'hospitality', 'compliance', 'gate_staff',
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Manager creates staff accounts (no public sign-up on an admin system)
r.post('/register', requireAuth, requireRole('manager'), audit('create_user', 'mgt_users'), wrap(async (req, res) => {
  const { name, staffId, email, role, password } = req.body || {};
  if (!name || !staffId || !email || !role || !password) throw httpError(400, 'Missing fields');
  if (name.trim().length < 2) throw httpError(400, 'Name must be at least 2 characters');
  if (staffId.trim().length < 2) throw httpError(400, 'Staff ID must be at least 2 characters');
  if (!EMAIL_PATTERN.test(email.trim())) throw httpError(400, 'A valid email is required');
  if (!MANAGEMENT_ROLES.has(role)) throw httpError(400, 'Invalid management role');
  if (String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters');
  const hash = await bcrypt.hash(password, 12);
  try {
    const created = await withTransaction(async (c) => {
      const u = await c.query(
        'INSERT INTO mgt_users (name, staff_id, email, role) VALUES ($1,$2,$3,$4) RETURNING user_id',
        [name.trim(), staffId.trim(), email.trim().toLowerCase(), role]
      );
      await c.query(
        'INSERT INTO mgt_auth (user_id, password_hash) VALUES ($1,$2)',
        [u.rows[0].user_id, hash]
      );
      return u.rows[0];
    });
    res.status(201).json({ userId: created.user_id });
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Staff ID or email already exists');
    throw err;
  }
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

r.post('/forgot-password', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email) {
    const { rows } = await query(
      `SELECT u.user_id, u.name, u.email
       FROM mgt_users u
       JOIN mgt_auth a ON a.user_id = u.user_id
       WHERE u.email = $1`,
      [email]
    );
    const user = rows[0];
    if (user) {
      const token = jwt.sign(
        { userId: user.user_id, purpose: 'password-reset' },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
      );
      const result = await sendPasswordResetEmail(user, token, { expiresInMinutes: 30 });
      if (!result.success) console.error('[forgot-password] email failed:', result.error);
    }
  }
  res.json({ message: 'If an account exists for this email, a reset link has been sent.' });
}));

r.post('/reset-password/:token', wrap(async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');

  let payload;
  try {
    payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
  } catch {
    throw httpError(400, 'Reset link is invalid or has expired');
  }
  if (payload.purpose !== 'password-reset' || !payload.userId) {
    throw httpError(400, 'Invalid reset link');
  }

  const { rows } = await query(
    'SELECT auth_id FROM mgt_auth WHERE user_id = $1',
    [payload.userId]
  );
  if (!rows[0]) throw httpError(400, 'Reset link is invalid');

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    `UPDATE mgt_auth
     SET password_hash = $1, is_active = false, token_id = NULL, expires_at = NULL
     WHERE auth_id = $2`,
    [passwordHash, rows[0].auth_id]
  );
  res.json({ message: 'Password reset successfully. Please log in again.' });
}));

export default r;
