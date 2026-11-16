import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { sendEntourageVerificationEmail, sendVerificationEmail } from '../middleware/email.js';

const r = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ARTIST_TOKEN_LIFETIME = '2h';
const VERIFICATION_TOKEN_LIFETIME_MS = 72 * 60 * 60 * 1000;

function requireArtist(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  try {
    const payload = jwt.verify(token, process.env.ARTIST_TOKEN_SECRET);
    if (payload.type !== 'artist') throw new Error('Not an artist token');
    req.artistId = payload.artistId;
    next();
  } catch {
    next(httpError(401, 'Please open the link from your email again'));
  }
}


r.get('/', requireAuth, requireRole('coordinator', 'hospitality'), wrap(async (req, res) => {
  const { eventId } = req.query;
  if (!eventId) throw httpError(400, 'eventId is required');

  const artists = await query(
    `SELECT artist_id AS id, name, email, preference, is_verified AS "isVerified"
     FROM artists WHERE event_id = $1 ORDER BY name`, [eventId]);

  const members = await query(
    `SELECT e.entourage_id AS id, e.artist_id AS "artistId", e.name, e.email, e.is_verified AS "isVerified" FROM entourage e
     JOIN artists a ON a.artist_id = e.artist_id WHERE a.event_id = $1
     ORDER BY e.name`, [eventId]);

  const result = artists.rows.map((artist) => ({
    id: artist.id,
    name: artist.name,
    email: artist.email,
    isVerified: artist.isVerified,
    preferences: artist.preference?.notes || '',
    entourage: members.rows.filter((member) => member.artistId === artist.id),
  }));

  res.json(result);
}));

// Add an artist to an event and email them a verification link
r.post('/', requireAuth, requireRole('coordinator'), audit('add_artist', 'artists'), wrap(async (req, res) => {
  const { eventId, name, email, event_id } = req.body;

  if (!eventId) throw httpError(400, 'eventId is required');
  if (!name || !name.trim()) throw httpError(400, 'name is required');
  if (!EMAIL_PATTERN.test(email || '')) throw httpError(400, 'A valid email is required');

  // The issue time allows the link to expire without a schema change.
  const verificationToken =
    `${Date.now().toString(36)}.${crypto.randomBytes(32).toString('hex')}`;

  let artist;
  try {
    const { rows } = await query(
      `INSERT INTO artists (event_id, name, email, verification_token, verification_sent)
       VALUES ($1, $2, $3, $4, true)
       RETURNING artist_id AS id, name, email, is_verified AS "isVerified"`,
      [eventId, name.trim(), email.trim().toLowerCase(), verificationToken]);
    artist = rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'This artist is already added to the event');
    if (err.code === '23503') throw httpError(404, 'Event not found');
    throw err;
  }

  const emailResult = await sendVerificationEmail(artist, verificationToken);
  if (!emailResult.success) {
    await query('DELETE FROM artists WHERE artist_id = $1', [artist.id]);
    throw httpError(502, 'Artist was not added because the verification email could not be sent');
  }

  res.status(201).json(artist);
}));

// verify the artist's email by clicking the link. Returns a JWT for further requests.
r.post('/verify/:token', wrap(async (req, res) => {
  const tokenIssuedAt = Number.parseInt(req.params.token.split('.')[0], 36);
  if (
    !Number.isFinite(tokenIssuedAt) ||
    Date.now() - tokenIssuedAt > VERIFICATION_TOKEN_LIFETIME_MS
  ) {
    throw httpError(410, 'This verification link has expired');
  }

  const { rows } = await query(
    `UPDATE artists
     SET is_verified = true, verification_token = NULL
     WHERE verification_token = $1 AND verification_sent = true AND is_verified = false
     RETURNING artist_id AS id, event_id AS "eventId", name`, [req.params.token]);

  if (rows.length === 0) throw httpError(404, 'This link is not valid');

  const artist = rows[0];
  const token = jwt.sign(
    { artistId: artist.id, type: 'artist' },
    process.env.ARTIST_TOKEN_SECRET,
    { expiresIn: ARTIST_TOKEN_LIFETIME });

  res.json({ token, artist });
}));

// save artist profile (preferences) -- only after verification
r.put('/profile', requireArtist, wrap(async (req, res) => {
  const { preferences } = req.body;
  if (typeof preferences !== 'string' || !preferences.trim()) {
    throw httpError(400, 'preferences is required');
  }

  // The column is JSONB, so the text is stored as { "notes": "..." }
  await query(
    'UPDATE artists SET preference = $1 WHERE artist_id = $2',
    [JSON.stringify({ notes: preferences.trim() }), req.artistId]);

  res.json({ message: 'Profile saved' });
}));

// Verify an entourage member's email from their invitation link.
r.post('/entourage/verify/:token', wrap(async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, process.env.ARTIST_TOKEN_SECRET);
  } catch {
    throw httpError(410, 'This verification link is invalid or expired');
  }

  if (payload.type !== 'entourage' || payload.artistId !== req.query.artistId) {
    throw httpError(404, 'This verification link is not valid');
  }

  const { rows } = await query(
    `UPDATE entourage
     SET is_verified = true
     WHERE entourage_id = $1 AND artist_id = $2 AND is_verified = false
     RETURNING entourage_id AS id, name`,
    [payload.entourageId, payload.artistId]
  );
  if (rows.length === 0) throw httpError(404, 'This verification link is not valid');

  res.json({ member: rows[0] });
}));

// artist adds entourage members (bandmates, dancers, etc). Only after verification. Each member gets a row in the DB.
r.post('/entourage', requireArtist, wrap(async (req, res) => {
  const { members } = req.body;

  if (!Array.isArray(members) || members.length === 0) {
    throw httpError(400, 'members must be a list with at least one person');
  }

  // Check everyone first, so we never save only half of the list
  for (const member of members) {
    if (!member.name || !member.name.trim()) throw httpError(400, 'Every member needs a name');
    if (!EMAIL_PATTERN.test(member.email || '')) throw httpError(400, 'Every member needs a valid email');
  }

  const saved = [];
  for (const member of members) {
    const { rows } = await query(
      `INSERT INTO entourage (artist_id, name, email) VALUES ($1, $2, $3)
       RETURNING entourage_id AS id, name, email`,
      [req.artistId, member.name.trim(), member.email ? member.email.trim().toLowerCase() : null]);
    const savedMember = rows[0];
    const artistResult = await query(
      'SELECT artist_id AS id, name FROM artists WHERE artist_id = $1',
      [req.artistId]
    );
    const invitationToken = jwt.sign(
      { entourageId: savedMember.id, artistId: req.artistId, type: 'entourage' },
      process.env.ARTIST_TOKEN_SECRET,
      { expiresIn: '72h' }
    );
    const emailResult = await sendEntourageVerificationEmail(
      savedMember,
      artistResult.rows[0],
      invitationToken
    );
    if (!emailResult.success) {
      await query('DELETE FROM entourage WHERE entourage_id = $1', [savedMember.id]);
      throw httpError(502, 'Entourage member was not added because the verification email could not be sent');
    }
    saved.push(savedMember);
  }
  res.status(201).json(saved);
}));

export default r;