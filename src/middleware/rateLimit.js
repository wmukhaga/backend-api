import {rateLimit} from 'express-rate-limit';
import {httpError} from './errorHandler.js';

// limit the no of requests from an IP to 60 / 15min
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  limit: 60,
  message: httpError(429, 'Too many requests, please try again later.'),
  standardHeaders: true,
  legacyHeaders: false,
});

export default limiter;