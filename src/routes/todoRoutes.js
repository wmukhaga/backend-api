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
  const { eventId, title, assignedTo, deadline } = req.body;
  if (!eventId || !title) throw httpError(400, 'eventId and title required');
  const { rows } = await query(
    'INSERT INTO tasks (event_id, title, assigned_to, deadline) VALUES ($1,$2,$3,$4) RETURNING *',
    [eventId, title, assignedTo || null, deadline || null]);
  res.status(201).json(rows[0]);
}));
r.patch('/:id', audit('update_task', 'tasks'), wrap(async (req, res) => {
  const { status } = req.body; // todo | in_progress | done
  const { rowCount } = await query('UPDATE tasks SET status = $1 WHERE task_id = $2', [status, req.params.id]);
  if (!rowCount) throw httpError(404, 'Task not found');
  res.json({ message: 'Updated' });
}));
r.delete('/:id', audit('delete_task', 'tasks'), wrap(async (req, res) => {
  await query('DELETE FROM tasks WHERE task_id = $1', [req.params.id]);
  res.status(204).end();
}));
export default r;
