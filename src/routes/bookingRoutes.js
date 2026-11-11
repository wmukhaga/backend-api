// Revellers book WITHOUT login. Flow: checkout (hold stock) -> pay (payments) -> webhook marks paid.
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { httpError, wrap } from '../middleware/errorHandler.js';

const r = Router();

r.post('/checkout', requireIdempotencyKey, wrap(async (req, res) => {
  const { tierId, quantity, phone, email } = req.body;
  if (!tierId || !quantity || quantity < 1 || quantity > 10 || !phone || !email)
    throw httpError(400, 'tierId, quantity (1-10), phone and email required');

  // 1. Same key already used? Return the same booking (no duplicate on double click/retry)
  const existing = await query('SELECT * FROM bookings WHERE idempotency_key = $1', [req.idempotencyKey]);
  if (existing.rows[0]) return res.status(200).json(existing.rows[0]);

  const booking = await withTransaction(async (c) => {
    // 2. ATOMIC stock decrement: the WHERE clause is the guard against overselling.
    const stock = await c.query(
      `UPDATE ticket_tiers t SET available = available - $1
       FROM events e
       WHERE t.tier_id = $2 AND t.available >= $1
         AND e.event_id = t.event_id AND e.event_stage = 'on_sale'
       RETURNING t.event_id, t.price`, [quantity, tierId]);
    if (!stock.rows[0]) throw httpError(409, 'Not enough tickets available');
    const { event_id, price } = stock.rows[0];

    // 3. Booking in "held" state with a short TTL
    const ttl = Number(process.env.HOLD_TTL_SECONDS || 600); 
    const b = await c.query(
      `INSERT INTO bookings (idempotency_key, event_id, tier_id, no_of_tickets, amount,
         booker_phone, booker_email, status, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'held', now() + ($8 || ' seconds')::interval) RETURNING *`,
      [req.idempotencyKey, event_id, tierId, quantity, price * quantity, phone, email, ttl]);

    // 4. One ticket row per seat, state HELD
    for (let i = 0; i < quantity; i++)
      await c.query(`INSERT INTO tickets (booking_id, event_id, tier_id, status) VALUES ($1,$2,$3,'held')`,
        [b.rows[0].booking_id, event_id, tierId]);
    return b.rows[0];
  });
  res.status(201).json(booking);
}));

// Polling endpoint: frontend asks "is my payment done yet?"
r.get('/:id/status', wrap(async (req, res) => {
  const { rows } = await query('SELECT booking_id, status, hold_expires_at FROM bookings WHERE booking_id = $1', [req.params.id]);
  if (!rows[0]) throw httpError(404, 'Booking not found');
  res.json(rows[0]);
}));

// Reveller gets e-tickets (only once paid)
r.get('/:id/tickets', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT ticket_id, qr_payload, status FROM tickets
     WHERE booking_id = $1 AND status IN ('paid','verified','used')`, [req.params.id]);
  res.json(rows);
}));
export default r;
