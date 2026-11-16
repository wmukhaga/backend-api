// Payments: M-Pesa STK push + card. We NEVER trust the browser saying "I paid".
// Only the server-to-server webhook (or our polling of the provider) can mark a booking paid.
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { buildQrPayload } from '../utils/tickets.js';
import { sendTicketEmail } from '../middleware/email.js';
import {stkpush, requestUpdate} from '../middleware/mpesa.js';

const r = Router();

// Reveller starts payment for a held booking
r.post('/mpesa/stk-push', wrap(async (req, res) => {
  const { bookingId, phoneNumber, amount, reference, description } = req.body;
  if (!bookingId || !phoneNumber) throw httpError(400, 'Missing bookingId or phoneNumber');
  if (!amount || !reference) throw httpError(400, 'Missing amount or reference');

  const response = await stkpush(bookingId, phoneNumber, amount, reference, description);

  // Store the CheckoutRequestID so the callback can look it up
  if (response.ResponseCode === '0') {
    await withTransaction(async (c) => {
      await c.query(
        `INSERT INTO transaction_details (merchant_id, request_id, reference, amount, phone_no, result_code, receipt_no)
         VALUES ($1,$2,$3,$4,$5,NULL,NULL)`,
        [response.MerchantRequestID, response.CheckoutRequestID, reference, amount, phoneNumber]
      );
    });
  }

  res.json(response);
}));   


r.post('/mpesa/callback', wrap(async (req, res) => {
  const cb = req.body?.Body?.stkCallback;
  if (!cb) throw httpError(400, 'Invalid callback body');
  const { CheckoutRequestID, ResultCode, ResultDesc } = cb;

  if (ResultCode !== 0) {
    console.error(`M-Pesa callback: ${CheckoutRequestID} failed: ${ResultDesc}`);
    return res.json({ ResultCode, ResultDesc });
  }

  // Extract metadata
  const items = cb.CallbackMetadata?.Item || [];
  const get = (name) => items.find(i => i.Name === name)?.Value;

  const callbackBody = {
    merchant_id: cb.MerchantRequestID,
    request_id: CheckoutRequestID,
    result_code: ResultCode,
    result_desc: ResultDesc,
    amount: get('Amount'),
    receipt_no: get('MpesaReceiptNumber'),
    transaction_date: get('TransactionDate'),
    phone_number: get('PhoneNumber'),
  };

  // Write to DB
  await transactionDetails(CheckoutRequestID, callbackBody);
  await markBookingPaid(CheckoutRequestID);

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));   

// Idempotent: calling twice does nothing the second time
export async function markBookingPaid(request_id) {
  let bookingId = null;
  await withTransaction(async (c) => {
    // Get the booking reference from the transaction details
    const bid = await c.query(`SELECT reference FROM transaction_details WHERE request_id = $1`, [request_id]);
    if (!bid.rows[0]) return;
    bookingId = bid.rows[0].reference;

    const b = await c.query(
      `UPDATE bookings SET status = 'paid' WHERE booking_id = $1 AND status = 'held' RETURNING event_id, no_of_tickets`,
      [bookingId]
    );
    if (!b.rows[0]) return;

    const t = await c.query(
      `UPDATE tickets SET status = 'paid' WHERE booking_id = $1 RETURNING ticket_id`,
      [bookingId]
    );
    for (const row of t.rows)
      await c.query('UPDATE tickets SET qr_payload = $1 WHERE ticket_id = $2',
        [buildQrPayload(row.ticket_id, b.rows[0].event_id), row.ticket_id]);
  }); // transaction commits here

  // ---- Send the ticket email (non-blocking; never fails the payment) ----
  const booking = await query(
    `SELECT b.booker_email, b.amount, e.name AS event_name, tt.type AS tier_type, b.no_of_tickets
     FROM bookings b
     JOIN events e ON e.event_id = b.event_id
     JOIN ticket_tiers tt ON tt.tier_id = b.tier_id
     WHERE b.booking_id = $1`,
    [bookingId]
  );
  const paidTickets = await query(
    `SELECT ticket_id, qr_payload FROM tickets
     WHERE booking_id = $1 AND status = 'paid'`,
    [bookingId]
  );

  if (booking.rows[0]?.booker_email) {
    await sendTicketEmail({
      to: booking.rows[0].booker_email,
      eventName: booking.rows[0].event_name,
      tierName: booking.rows[0].tier_type,
      quantity: booking.rows[0].no_of_tickets,
      qrPayloads: paidTickets.rows.map((r) => r.qr_payload),
      bookingId,
    }).catch((err) => console.error('[ticket email] failed', err.message));
  }
}

// update the database - transaction_details with the payment result
export async function transactionDetails(request_id, callbackBody) {
  await withTransaction(async (c) => {
    const tr_update = await c.query(`UPDATE transaction_details SET result_code = $1, description = $2, receipt_no = $3 WHERE request_id = $4 RETURNING reference`,[callbackBody.result_code, callbackBody.result_desc, callbackBody.receipt_no, callbackBody.request_id]);
  });
}


// TODO: POST /card/charge (card provider, e.g. Stripe/Flutterwave) + its webhook
export default r;
