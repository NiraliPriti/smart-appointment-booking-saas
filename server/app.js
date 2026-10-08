import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { HttpError, fail, ok } from './lib/http.js';
import { log } from './lib/logger.js';
import publicRoutes from './routes/public.js';
import bookingRoutes from './routes/bookings.js';
import clientRoutes from './routes/clients.js';
import serviceRoutes from './routes/services.js';
import settingsRoutes from './routes/settings.js';
import meRoutes from './routes/me.js';
import billingRoutes, { webhookHandler } from './routes/billing.js';
import cronRoutes from './routes/cron.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: [process.env.APP_URL, 'http://localhost:5173'].filter(Boolean) })); // explicit allow-list
app.use((req, res, next) => { req.id = randomUUID(); res.setHeader('X-Request-Id', req.id); next(); });

// Stripe needs the untouched raw body to verify its signature, so this precedes express.json().
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), webhookHandler);
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => ok(res, { status: 'ok' }));
app.use('/api/public', publicRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api', meRoutes);
app.use('/api', settingsRoutes);

app.use('/api', (req, res) => fail(res, 404, 'not_found', 'Route not found'));

// Central error handler: map known DB errors, never leak stack traces.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'invalid_json', 'Request body is not valid JSON');
  if (err.code === '23P01') return fail(res, 409, 'slot_unavailable', 'That time is no longer available.');
  if (err.code === '23505') return fail(res, 409, 'conflict', 'That value is already in use.');
  if (err.code === '23503') return fail(res, 400, 'invalid_reference', 'Referenced record does not exist.');
  if (err.code === '23514') return fail(res, 400, 'validation_error', 'A value is outside the allowed range.');
  log('error', 'unhandled error', { requestId: req.id, path: req.path, code: err.code, message: err.message });
  fail(res, 500, 'internal_error', `Something went wrong. Reference: ${req.id}`);
});

export default app;
