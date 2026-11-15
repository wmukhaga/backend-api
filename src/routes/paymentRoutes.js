// Payments: M-Pesa STK push + card. We NEVER trust the browser saying "I paid".
// Only the server-to-server webhook (or our polling of the provider) can mark a booking paid.
import { Router } from 'express';
import { withTransaction } from '../db.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { buildQrPayload } from '../utils/tickets.js';
import {stkpush, requestUpdate} from '../middleware/mpesa.js';

const r = Router();

// Reveller starts payment for a held booking
r.post('/mpesa/stk-push', wrap(async (req, res) => {
  const { bookingId, phoneNumber, amount, reference, description } = req.body;
  if (!bookingId || !phoneNumber) throw httpError(400, 'Missing bookingId or phoneNumber');
  if (!amount || !reference) throw httpError(400, 'Missing amount or reference');

  const response = await stkpush(bookingId, phoneNumber, amount, reference, description);
  res.json(response);
}));

// Safaricom calls this URL after the customer pays/cancels (must be public HTTPS - use ngrok in dev)
r.post('/mpesa/callback', wrap(async (req, res) => {
  const {request_id} = req.body;
  if (!request_id) throw httpError(400, 'Missing request_id');
  const response = await requestUpdate(request_id);

  const fullResponse = await response.json();
  const {ResultCode, ResultDesc} = response;
  if (ResultCode !== 0) {
    console.error(`M-Pesa callback: request_id=${request_id} failed: ${ResultDesc}`);
    return res.json({ ResultCode, ResultDesc });
  }

  // reconstruct the body of callback 
  const callbackBody = {
    ...fullResponse,
    merchant_id: fullResponse.MerchantRequestID,
    request_id: fullResponse.CheckoutRequestID, 
    result_code: fullResponse.ResultCode,
    result_desc: fullResponse.ResultDesc,
    amount: fullResponse.CallbackMetadata.Item.find(i => i.Name === 'Amount')?.Value,
    receipt_no: fullResponse.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber')?.Value,
    transaction_date: fullResponse.CallbackMetadata.Item.find(i => i.Name === 'TransactionDate')?.Value,
    phone_number: fullResponse.CallbackMetadata.Item.find(i => i.Name === 'PhoneNumber')?.Value
  };

  // payment successful, mark booking paid
  await markBookingPaid(request_id);
  await transactionDetails(request_id, callbackBody);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// Idempotent: calling twice does nothing the second time
export async function markBookingPaid(request_id) {
  await withTransaction(async (c) => {
    // Get the booking reference from the transaction details
    const bid = await c.query(`SELECT reference FROM transaction_details WHERE request_id = $1`, [request_id]);
    if (!bid.rows[0]) return;
    const b = await c.query(`UPDATE bookings SET status = 'paid' WHERE booking_id = $1 AND status = 'held' RETURNING event_id`, [bid.rows[0].reference]);
    if (!b.rows[0]) return; 
    const t = await c.query(`UPDATE tickets SET status = 'paid' WHERE booking_id = $1 RETURNING ticket_id`, [bid.rows[0].reference]);
    for (const row of t.rows)
      await c.query('UPDATE tickets SET qr_payload = $1 WHERE ticket_id = $2',
        [buildQrPayload(row.ticket_id, b.rows[0].event_id), row.ticket_id]);
  });
}

// update the database - transaction_details with the payment result
export async function transactionDetails(request_id, callbackBody) {
  await withTransaction(async (c) => {
    const tr_update = await c.query(`UPDATE transaction_details SET result_code = $1, description = $2, receipt_no = $3 WHERE request_id = $4 RETURNING reference`,[callbackBody.result_code, callbackBody.result_desc, callbackBody.receipt_no, callbackBody.request_id]);
  });
}

// TODO: email the buyer with the ticket 

// TODO: POST /card/charge (card provider, e.g. Stripe/Flutterwave) + its webhook
export default r;
