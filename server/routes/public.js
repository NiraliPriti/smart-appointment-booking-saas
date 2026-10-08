import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { admin } from '../lib/supabase.js';
import { HttpError, ok, parse } from '../lib/http.js';
import { hasAccess } from '../lib/billing.js';
import { getAvailability } from '../services/availability.js';
import { createPublicBooking } from '../services/bookings.js';

const r = Router();
r.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const bookingLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'invalid slug');

async function loadBusiness(slugRaw) {
  const slug = parse(slugSchema, slugRaw);
  const { data } = await admin.from('businesses').select('id,name,slug,description,timezone,phone,email,status').eq('slug', slug).maybeSingle();
  if (!data || data.status !== 'active') throw new HttpError(404, 'not_found', 'Business not found');
  return data;
}
async function assertBookable(businessId) {
  const { data } = await admin.from('subscriptions').select('status,current_period_end,trial_ends_at').eq('business_id', businessId).maybeSingle();
  if (!hasAccess(data)) throw new HttpError(403, 'business_unavailable', 'This business is not accepting online bookings right now');
}

// Only intentionally public fields leave the server: no ids of owners, no notes, no subscription data.
r.get('/businesses/:slug', async (req, res) => {
  const { id, status, ...pub } = await loadBusiness(req.params.slug);
  ok(res, pub);
});

r.get('/businesses/:slug/services', async (req, res) => {
  const b = await loadBusiness(req.params.slug);
  const [s, p] = await Promise.all([
    admin.from('services').select('id,name,description,duration_minutes,price_cents').eq('business_id', b.id).eq('active', true).order('name'),
    admin.from('providers').select('id,name').eq('business_id', b.id).eq('active', true).order('created_at'),
  ]);
  if (s.error) throw s.error;
  if (p.error) throw p.error;
  ok(res, { services: s.data, providers: p.data });
});

const availQuery = z.object({
  serviceId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(31).default(14),
});
r.get('/businesses/:slug/availability', async (req, res) => {
  const b = await loadBusiness(req.params.slug);
  await assertBookable(b.id);
  const q = parse(availQuery, req.query);
  const av = await getAvailability({ businessId: b.id, ...q });
  ok(res, { timezone: av.timezone, durationMinutes: av.service.duration_minutes, days: av.days });
});

const bookingSchema = z.object({
  serviceId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().regex(/^[\d\s()+-]{7,20}$/, 'invalid phone').optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional(),
});
r.post('/businesses/:slug/bookings', bookingLimiter, async (req, res) => {
  const b = await loadBusiness(req.params.slug);
  await assertBookable(b.id);
  const input = parse(bookingSchema, req.body);
  const { booking, service } = await createPublicBooking(b, input);
  ok(res, {
    id: booking.id, startsAt: booking.starts_at, endsAt: booking.ends_at, status: booking.status,
    service: { name: service.name, durationMinutes: service.duration_minutes, priceCents: service.price_cents },
    business: { name: b.name, timezone: b.timezone },
  }, 201);
});

export default r;
