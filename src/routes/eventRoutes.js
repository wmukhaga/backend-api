import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';
import { httpError, wrap } from '../middleware/errorHandler.js';
import { canMove } from '../utils/eventStages.js';

const r = Router();

// PUBLIC: revellers browse events (no login). Only show sellable stages.
r.get('/', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT e.event_id, e.name, e.location, e.event_date, e.event_stage,
            json_agg(json_build_object('tierId', t.tier_id, 'type', t.type, 'price', t.price, 'available', t.available)) AS tiers
     FROM events e LEFT JOIN ticket_tiers t ON t.event_id = e.event_id
     WHERE e.event_stage IN ('published','on_sale','sold_out')
     GROUP BY e.event_id ORDER BY e.event_date`);
  res.json(rows);
}));

r.get('/:id', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM events WHERE event_id = $1', [req.params.id]);
  if (!rows[0]) throw httpError(404, 'Event not found');
  res.json(rows[0]);
}));

// ADMIN: create event + its ticket tiers in one transaction
r.post('/', requireAuth, requireRole('coordinator'), audit('create_event', 'events'), wrap(async (req, res) => {
  const { name, location, eventDate, tiers } = req.body; // tiers: [{type:'regular', price:1000, total:500}]
  if (!name || !location || !eventDate || !tiers?.length) throw httpError(400, 'Missing fields');
  const eventId = await withTransaction(async (c) => {
    const e = await c.query(
      'INSERT INTO events (name, location, event_date, approver_id) VALUES ($1,$2,$3,$4) RETURNING event_id',
      [name, location, eventDate, req.user.userId]);
    for (const t of tiers)
      await c.query('INSERT INTO ticket_tiers (event_id, type, price, total, available) VALUES ($1,$2,$3,$4,$4)',
        [e.rows[0].event_id, t.type, t.price, t.total]);
    return e.rows[0].event_id;
  });
  res.status(201).json({ eventId });
}));

r.patch('/:id', requireAuth, requireRole('coordinator'), audit('update_event', 'events'), wrap(async (req, res) => {
  const { name, location, eventDate } = req.body;
  const { rowCount } = await query(
    `UPDATE events SET name = COALESCE($1,name), location = COALESCE($2,location),
     event_date = COALESCE($3,event_date) WHERE event_id = $4 AND event_stage IN ('draft','published')`,
    [name, location, eventDate, req.params.id]);
  if (!rowCount) throw httpError(409, 'Event not found or no longer editable');
  res.json({ message: 'Updated' });
}));

// Move event through its life cycle. Illegal jumps are rejected.
r.post('/:id/stage', requireAuth, requireRole('coordinator'), audit('change_event_stage', 'events'), wrap(async (req, res) => {
  const { stage } = req.body;
  const { rows } = await query('SELECT event_stage FROM events WHERE event_id = $1', [req.params.id]);
  if (!rows[0]) throw httpError(404, 'Event not found');
  if (!canMove(rows[0].event_stage, stage))
    throw httpError(409, `Cannot move from ${rows[0].event_stage} to ${stage}`);
 await query(
  `UPDATE events SET event_stage = $1, is_cancelled = $2 WHERE event_id = $3`,
  [stage, stage === 'cancelled', req.params.id]
);
  res.json({ message: `Event is now ${stage}` });
}));

// TODO on cancel: notify ticket holders + trigger refunds
export default r;
