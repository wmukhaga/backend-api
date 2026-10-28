// Signed QR payload so fake tickets can't be forged. Gate scanner can verify
// the signature OFFLINE if it holds the secret, then check ticket status in local DB.
import crypto from 'crypto';

export function buildQrPayload(ticketId, eventId) {
  const sig = crypto.createHmac('sha256', process.env.TICKET_SIGNING_SECRET)
    .update(`${ticketId}.${eventId}`).digest('hex').slice(0, 16);
  return `${ticketId}.${eventId}.${sig}`;
}

export function verifyQrPayload(payload) {
  const [ticketId, eventId, sig] = String(payload).split('.');
  if (!ticketId || !eventId || !sig) return null;
  const ok = buildQrPayload(ticketId, eventId) === payload;
  return ok ? { ticketId, eventId } : null;
}
