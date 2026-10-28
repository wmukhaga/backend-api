// Dashboard metrics, costs, reports, audit logs
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';
import { wrap } from '../middleware/errorHandler.js';

const r = Router();
r.use(requireAuth);

// Per-event metrics: tickets sold, revenue, costs, profit
r.get('/events/:id/metrics', requireRole('finance', 'coordinator'), wrap(async (req, res) => {
  const sold = await query(`SELECT COALESCE(SUM(no_of_tickets),0) AS tickets_sold, COALESCE(SUM(amount),0) AS revenue
                            FROM bookings WHERE event_id = $1 AND status = 'paid'`, [req.params.id]);
  const costs = await query('SELECT COALESCE(SUM(amount),0) AS total_costs FROM costs WHERE event_id = $1', [req.params.id]);
  const tasks = await query(`SELECT status, COUNT(*) FROM tasks WHERE event_id = $1 GROUP BY status`, [req.params.id]);
  res.json({ ...sold.rows[0], ...costs.rows[0], profit: sold.rows[0].revenue - costs.rows[0].total_costs, tasks: tasks.rows });
}));

r.get('/events/:id/costs', requireRole('finance'), wrap(async (req, res) => {
  res.json((await query('SELECT * FROM costs WHERE event_id = $1 ORDER BY cost_date', [req.params.id])).rows);
}));
r.post('/events/:id/costs', requireRole('finance'), audit('add_cost', 'costs'), wrap(async (req, res) => {
  const { name, classification, amount, costDate } = req.body;
  const { rows } = await query(
    'INSERT INTO costs (event_id, name, classification, amount, cost_date) VALUES ($1,$2,$3,$4,COALESCE($5, now())) RETURNING *',
    [req.params.id, name, classification, amount, costDate]);
  res.status(201).json(rows[0]);
}));

r.get('/audit-logs', requireRole('compliance'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT l.*, u.name AS actor_name FROM audit_logs l JOIN mgt_users u ON u.user_id = l.actor_id
     ORDER BY log_timestamp DESC LIMIT 200`);
  res.json(rows);
}));
// TODO: GET /events/:id/report?format=pdf  (guideline: reports with logo, date, filters)
// TODO: PII cleanup job - null out booker_phone/email N days after event completes
export default r;
