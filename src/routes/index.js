// Mounts every router under /api
import { Router } from 'express';
import auth from './authRoutes.js';
import events from './eventRoutes.js';
import bookings from './bookingRoutes.js';
import payments from './paymentRoutes.js';
import artists from './artistRoutes.js';
import checkin from './checkinRoutes.js';
import tasks from './todoRoutes.js';
import admin from './adminRoutes.js';

const r = Router();
r.get('/health', (req, res) => res.json({ status: 'ok', app: 'TikoSorted' }));
r.use('/auth', auth);
r.use('/events', events);
r.use('/bookings', bookings);
r.use('/payments', payments);
r.use('/artists', artists);
r.use('/checkin', checkin);
r.use('/tasks', tasks);
r.use('/admin', admin);
export default r;
