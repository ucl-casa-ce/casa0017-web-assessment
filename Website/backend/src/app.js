// app.js : controls http traffic and delegates to /routes

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import config from './config/env.js';
import requestLogger from './middleware/requestLogger.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import errorHandler from './middleware/errorHandler.js';

import outfallsRoutes from './routes/outfalls.routes.js';
import statusRoutes from './routes/status.routes.js';
import tideRoutes from './routes/tide.routes.js';
import thresholdsRoutes from './routes/thresholds.routes.js';
import eventsRoutes from './routes/events.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import riverRoutes from './routes/river.routes.js';

const app = express();

app.use(cors({ origin: config.cors.origin, credentials: true }));
app.set('trust proxy', 1); // real client IPs behind a proxy (per-IP limits on river sign-ups/sightings)
// keep the raw body too: the WhatsApp webhook signature is computed over Meta's exact bytes
app.use(express.json({ limit: '3mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/outfalls', outfallsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/tide', tideRoutes);
app.use('/api/thresholds', thresholdsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/river', riverRoutes);

app.use((req, res, next) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Server Error' });
});

// TODO: Add helmet security middleware
// TODO: Configure CORS
// TODO: Add request logging
// TODO: Add body parsing middleware
// TODO: Add compression middleware
// TODO: Add rate limiting to /api routes

// TODO: Add health check endpoint

// TODO: Mount API routes
// TODO: Add 404 handler
// TODO: Add global error handler

export default app;
