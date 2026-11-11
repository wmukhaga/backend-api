import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';
import { wrap } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth);

const COST_CLASS_NAMES = {
  marketing: 'MARKETING',
  artist: 'ARTISTS',
  sound_equipment: 'SOUND_EQUIP',
  on_ground: 'ON_GROUND',
};

const REPORT_ROLES = ['finance', 'coordinator', 'manager'];

router.get('/dashboard', requireRole(...REPORT_ROLES), wrap(async (req, res) => {
  const [events, tasks, revenue, upcoming, activity] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE event_stage IN ('published','on_sale','ongoing'))::int AS live FROM events`),
    query(`SELECT COUNT(*) FILTER (WHERE status <> 'done')::int AS open, COUNT(*) FILTER (WHERE status = 'done')::int AS completed FROM tasks`),
    query(`SELECT COALESCE(SUM(amount),0)::float8 AS total FROM bookings WHERE status = 'paid'`),
    query(`SELECT event_id AS id, name, event_date AS "eventDate", UPPER(event_stage::text) AS "eventStage" FROM events WHERE event_date > now() AND NOT is_cancelled ORDER BY event_date LIMIT 5`),
    query(`SELECT l.log_id AS id, l.log_timestamp AS timestamp, u.name AS "actorName", l.action FROM audit_logs l 
          JOIN mgt_users u ON u.user_id = l.actor_id ORDER BY l.log_timestamp DESC LIMIT 5`),
  ]);

  res.json({
    kpis: {
      totalEvents: events.rows[0].total,
      liveEvents: events.rows[0].live,
      openTasks: tasks.rows[0].open,
      completedTasks: tasks.rows[0].completed,
      totalRevenue: revenue.rows[0].total,
    },
    upcomingEvents: upcoming.rows,
    recentActivity: activity.rows,
  });
}));


router.get('/events', wrap(async (req, res) => {
  const { rows } = await query('SELECT event_id AS id, name FROM events ORDER BY event_date DESC');
  res.json(rows);
}));

router.get('/management-team', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT user_id AS id, name
     FROM mgt_users
     ORDER BY name`);
  res.json(rows);
}));


router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT t.task_id AS id, t.title, u.name AS "teamOnboard", t.resource AS resources, t.deadline AS "dueDate",
     CASE t.status WHEN 'done' THEN 'COMPLETED' ELSE UPPER(t.status) END AS status FROM tasks t
     LEFT JOIN mgt_users u ON u.user_id = t.assigned_to
     ORDER BY t.deadline NULLS LAST, t.title`);
  res.json(rows);
}));


router.get('/events/:id/metrics', requireRole(...REPORT_ROLES), wrap(async (req, res) => {
  const sold = await query(
    `SELECT COALESCE(SUM(no_of_tickets),0)::int AS tickets_sold, COALESCE(SUM(amount),0)::float8 AS revenue
     FROM bookings WHERE event_id = $1 AND status = 'paid'`, [req.params.id]);

  const perTier = await query(
    `SELECT t.type::text AS type, SUM(b.no_of_tickets)::int AS tickets FROM bookings b 
     JOIN ticket_tiers t ON t.tier_id = b.tier_id
     WHERE b.event_id = $1 AND b.status = 'paid' GROUP BY t.type`, [req.params.id]);

  const costs = await query(
    'SELECT COALESCE(SUM(amount),0)::float8 AS total_costs FROM costs WHERE event_id = $1',
    [req.params.id]);

  const byTier = {};
  for (const row of perTier.rows) byTier[row.type.toUpperCase()] = row.tickets;

  const { revenue } = sold.rows[0];
  const totalCosts = costs.rows[0].total_costs;

  res.json({
    netRevenue: revenue - totalCosts,
    revenue,
    totalCosts,
    tickets: { total: sold.rows[0].tickets_sold, byTier },
  });
}));


router.get('/events/:id/costs', requireRole(...REPORT_ROLES), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT cost_id AS id, name, classification::text AS classification, amount::float8 AS amount, cost_date AS "costDate"
     FROM costs WHERE event_id = $1 ORDER BY cost_date`, [req.params.id]);

  res.json(rows.map((row) => ({ ...row, classification: COST_CLASS_NAMES[row.classification] })));
}));

router.post('/events/:id/costs', requireRole('finance'), audit('add_cost', 'costs'), wrap(async (req, res) => {
  const { name, classification, amount, costDate } = req.body;
  const { rows } = await query(
    'INSERT INTO costs (event_id, name, classification, amount, cost_date) VALUES ($1,$2,$3,$4,COALESCE($5, now())) RETURNING *',
    [req.params.id, name, classification, amount, costDate]);
  res.status(201).json(rows[0]);
}));


router.get('/audit-logs', requireRole('compliance'), wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const { rows } = await query(
    `SELECT l.log_id AS id,
            l.log_timestamp AS timestamp,
            u.name AS "actorName",
            l.action,
            l.resource,
            l.log_metadata AS metadata
     FROM audit_logs l
     JOIN mgt_users u ON u.user_id = l.actor_id
     ORDER BY l.log_timestamp DESC
     LIMIT $1`, [limit]);

  res.json(rows);
}));

// TODO: GET /events/:id/report?format=pdf  (guideline: reports with logo, date, filters)
// TODO: PII cleanup job - null out booker_phone/email N days after event completes
export default router;