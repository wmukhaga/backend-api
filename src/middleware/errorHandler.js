export const notFound = (req, res) =>
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });

// Throw { status: 409, message: '...' } anywhere and this formats it.
export const errorHandler = (err, req, res, next) => {
  console.error(err);
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid ID or value format' });
  res.status(err.status || 500).json({
    error: err.status ? err.message : 'Internal server error',
  });
};
export const httpError = (status, message) => Object.assign(new Error(message), { status });
// Wraps async handlers so thrown errors reach errorHandler
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
