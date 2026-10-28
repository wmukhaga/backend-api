// server.js - entry point: builds the Express app and starts listening
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import apiRoutes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { startHoldSweeper } from './jobs/releaseExpiredHolds.js';

dotenv.config();

// ES modules don't have __dirname, so we rebuild it:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ---- global middleware ----
app.use(helmet({ contentSecurityPolicy: false })); // security headers
app.use(cors());
app.use(morgan('dev'));                // request logging
app.use(express.json());               // parse JSON bodies -> req.body

// ---- frontend: HTML pages from /public ----
// "/" -> public/index.html (reveller site), "/admin" -> public/admin/index.html
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- backend: JSON API ----
app.use('/api', apiRoutes);

// ---- errors (must be LAST) ----
app.use('/api', notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`TikoSorted running on http://localhost:${PORT}`);
  startHoldSweeper(); // frees tickets from unpaid checkouts
});
