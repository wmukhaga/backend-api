// On-site scanning. Gate devices keep a LOCAL copy of tickets and sync later.
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { verifyQrPayload } from '../utils/tickets.js';
import { httpError, wrap } from '../middleware/errorHandler.js';

const r = Router();
r.use(requireAuth, requireRole('gate_staff', 'logistics'));

// Gate device downloads all paid tickets for an event (to store in its local DB, e.g. SQLite/IndexedDB)
r.get('/manifest/:eventId', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT ticket_id, qr_payload, status, tier_id FROM tickets WHERE event_id = $1 AND status IN ('paid','verified')`,
    [req.params.eventId]);
  res.json(rows);
}));

// Online scan (when internet works)
r.post('/scan', wrap(async (req, res) => {
  const parsed = verifyQrPayload(req.body.payload);
  if (!parsed) throw httpError(400, 'Invalid ticket');
  const { rowCount } = await query(
    `UPDATE tickets SET status = 'used', used_at = now() WHERE ticket_id = $1 AND status IN ('paid','verified')`,
    [parsed.ticketId]);
  if (!rowCount) throw httpError(409, 'Ticket already used or not valid');
  res.json({ valid: true });
}));

// Offline scans uploaded in a batch. First scan wins; duplicates are flagged, not lost.
r.post('/sync', wrap(async (req, res) => {
  const { deviceId, scans } = req.body; // scans: [{ticketId, scannedAt}]
  const results = [];
  for (const s of scans || []) {
    const u = await query(`UPDATE tickets SET status='used', used_at=$1 WHERE ticket_id=$2 AND status IN ('paid','verified')`, [s.scannedAt, s.ticketId]);
    await query('INSERT INTO offline_sync_logs (ticket_id, scanner_device_id, scanned_at, is_reconciled, conflict) VALUES ($1,$2,$3,true,$4)',
      [s.ticketId, deviceId, s.scannedAt, u.rowCount === 0]);
    results.push({ ticketId: s.ticketId, conflict: u.rowCount === 0 });
  }
  res.json({ results });
}));
export default r;
