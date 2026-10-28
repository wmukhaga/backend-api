// Payments: M-Pesa STK push + card. We NEVER trust the browser saying "I paid".
// Only the server-to-server webhook (or our polling of the provider) can mark a booking paid.
import { Router } from 'express';
import { withTransaction } from '../db.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { buildQrPayload } from '../utils/tickets.js';

const r = Router();

// Reveller starts payment for a held booking
r.post('/mpesa/stk-push', wrap(async (req, res) => {
  // TODO: call Daraja API with booking amount + phone, save CheckoutRequestID in payments table
  throw httpError(501, 'Not implemented yet');
}));

// Safaricom calls this URL after the customer pays/cancels (must be public HTTPS - use ngrok in dev)
r.post('/mpesa/callback', wrap(async (req, res) => {
  // TODO: find payment by CheckoutRequestID; if ResultCode === 0 call markBookingPaid(bookingId)
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// Idempotent: calling twice does nothing the second time
export async function markBookingPaid(bookingId) {
  await withTransaction(async (c) => {
    const b = await c.query(`UPDATE bookings SET status = 'paid' WHERE booking_id = $1 AND status = 'held' RETURNING event_id`, [bookingId]);
    if (!b.rows[0]) return; // already processed or expired
    const t = await c.query(`UPDATE tickets SET status = 'paid' WHERE booking_id = $1 RETURNING ticket_id`, [bookingId]);
    for (const row of t.rows)
      await c.query('UPDATE tickets SET qr_payload = $1 WHERE ticket_id = $2',
        [buildQrPayload(row.ticket_id, b.rows[0].event_id), row.ticket_id]);
    // TODO: email e-tickets to booker_email
  });
}
// TODO: POST /card/charge (card provider, e.g. Stripe/Flutterwave) + its webhook
export default r;
