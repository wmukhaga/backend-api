// "Track tasks": staff tasks per event (deadline, owner, status)
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { httpError, wrap } from '../middleware/errorHandler.js';

const r = Router();
r.use(requireAuth);

r.get('/', wrap(async (req, res) => {
  const { eventId } = req.query;
  const { rows } = await query(
    'SELECT * FROM tasks WHERE ($1::uuid IS NULL OR event_id = $1) ORDER BY deadline', [eventId || null]);
  res.json(rows);
}));
r.post('/', audit('create_task', 'tasks'), wrap(async (req, res) => {
  const { eventId, title, assignedTo, deadline, resource } = req.body;
  if (!eventId || !title) throw httpError(400, 'eventId and title required');
  const { rows } = await query(
    'INSERT INTO tasks (event_id, title, assigned_to, deadline, resource) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [eventId, title, assignedTo || null, deadline || null, resource || null]);
  res.status(201).json(rows[0]);
}));
r.patch('/:id', audit('update_task', 'tasks'), wrap(async (req, res) => {
  // Editable fields: status (todo | in_progress | done), title,
  // deadline and resource. Only the fields sent in the body are changed.
  const allowed = ['status', 'title', 'deadline', 'resource'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (sets.length === 0) {
    res.json({ message: 'Updated' });
    return;
  }
  params.push(req.params.id);
  const { rowCount } = await query(`UPDATE tasks SET ${sets.join(', ')} WHERE task_id = $${params.length}`, params);
  if (!rowCount) throw httpError(404, 'Task not found');
  res.json({ message: 'Updated' });
}));
r.delete('/:id', audit('delete_task', 'tasks'), wrap(async (req, res) => {
  await query('DELETE FROM tasks WHERE task_id = $1', [req.params.id]);
  res.status(204).end();
}));
export default r;
