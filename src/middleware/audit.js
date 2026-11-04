// Usage: router.post('/', requireAuth, audit('create_event','events'), handler)
import { query } from '../db.js';

export async function recordAction(actorId, action, resource, metadata = {}, client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(
    'INSERT INTO audit_logs (actor_id, action, resource, log_metadata) VALUES ($1,$2,$3,$4)',
    [actorId, action, resource, JSON.stringify(metadata)]
  );
}

// Logs after the response succeeds (status < 400)
export const audit = (action, resource) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400 && req.user && !req.devAuthBypass) {
      recordAction(req.user.userId, action, resource, {
        method: req.method, path: req.originalUrl, ip: req.ip, params: req.params,
      }).catch((e) => console.error('audit failed', e.message));
    }
  });
  next();
};
