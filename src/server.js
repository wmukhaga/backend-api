// server.js - entry point: builds the Express app and starts listening
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import apiRoutes from './routes/index.js';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import { startHoldSweeper } from './jobs/releaseExpiredHolds.js';
import { limiter } from './middleware/rateLimit.js';


dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// global middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(morgan('dev'));                // request logging
app.use(express.json());               // parse JSON bodies -> req.body

// backend API routes 
app.use('/api', limiter);  
app.use('/api', apiRoutes);

// error handling middleware (must be last)
app.use('/api', notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`TikoSorted running on http://localhost:${PORT}`);
  startHoldSweeper();
});
