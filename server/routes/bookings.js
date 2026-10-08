import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { admin } from '../lib/supabase.js';
import { HttpError, ok, parse } from '../lib/http.js';
import { tenant } from '../middleware/auth.js';
import { getAvailability } from '../services/availability.js';
import { slotTaken } from '../services/bookings.js';

const r = Router();
r.use(tenant);

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  cancelled: [], completed: [], no_show: [],
};
const COLS = 'id,starts_at,ends_at,status,price_cents,notes,service_id,provider_id,client_id,services(name,duration_minutes),providers(name),clients(id,name,email,phone)';

const event = (req, bookingId, type, metadata = {}) =>
  req.db.from('booking_events').insert({ booking_id: bookingId, business_id: req.businessId, event_type: type, actor_id: req.user.id, metadata });

r.get('/', async (req, res) => {
  const q = parse(z.object({
    from: iso.optional(), to: iso.optional(), status: z.enum(STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    order: z.enum(['asc', 'desc']).default('asc'),
  }), req.query);
  let query = req.db.from('bookings').select(COLS, { count: 'exact' }).eq('business_id', req.businessId);
  if (q.from) query = query.gte('starts_at', q.from);
  if (q.to) query = query.lt('starts_at', q.to);
  if (q.status) query = query.eq('status', q.status);
  const offset = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query.order('starts_at', { ascending: q.order === 'asc' }).range(offset, offset + q.pageSize - 1);
  if (error) throw error;
  ok(res, { items: data, total: count, page: q.page, pageSize: q.pageSize });
});

async function loadBooking(req) {
  const id = parse(uuid, req.params.id);
  const { data, error } = await req.db.from('bookings').select(COLS).eq('id', id).eq('business_id', req.businessId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'not_found', 'Booking not found');
  return data;
}

r.get('/:id', async (req, res) => {
  const booking = await loadBooking(req);
  const { data: events } = await req.db.from('booking_events').select('event_type,metadata,created_at').eq('booking_id', booking.id).order('created_at');
  ok(res, { ...booking, events });
});

r.patch('/:id', async (req, res) => {
  const { status, reason } = parse(z.object({ status: z.enum(STATUSES), reason: z.string().trim().max(200).optional() }), req.body);
  const b = await loadBooking(req);
  if (!TRANSITIONS[b.status].includes(status))
    throw new HttpError(409, 'invalid_transition', `A ${b.status.replace('_', ' ')} booking cannot become ${status.replace('_', ' ')}`);
  const { error } = await req.db.from('bookings').update({ status }).eq('id', b.id).eq('business_id', req.businessId);
  if (error) throw error;
  await event(req, b.id, status, { from: b.status, reason });
  if (status !== 'confirmed') await admin.from('reminders').update({ status: 'skipped' }).eq('booking_id', b.id).eq('status', 'pending');
  ok(res, await loadBooking(req));
});

// Slots for rescheduling: same engine as public booking, but ignoring this booking's own time.
r.get('/:id/slots', async (req, res) => {
  const b = await loadBooking(req);
  const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
  const av = await getAvailability({
    businessId: req.businessId, serviceId: b.service_id, providerId: b.provider_id, from: date, days: 1,
    excludeBookingId: b.id, requireActiveService: false,
  });
  ok(res, { timezone: av.timezone, slots: av.days[0].slots });
});

r.post('/:id/reschedule', async (req, res) => {
  const { startsAt } = parse(z.object({ startsAt: iso }), req.body);
  const b = await loadBooking(req);
  if (!['pending', 'confirmed'].includes(b.status)) throw new HttpError(409, 'invalid_transition', 'Only active bookings can be rescheduled');
  const startIso = new Date(startsAt).toISOString();
  const date = DateTime.fromISO(startIso).setZone(req.business.timezone).toISODate();
  const av = await getAvailability({
    businessId: req.businessId, serviceId: b.service_id, providerId: b.provider_id, from: date, days: 1,
    excludeBookingId: b.id, requireActiveService: false,
  });
  const slot = av.days[0].slots.find((s) => s.start === startIso);
  if (!slot) throw slotTaken();

  const { error } = await req.db.from('bookings').update({ starts_at: slot.start, ends_at: slot.end }).eq('id', b.id).eq('business_id', req.businessId);
  if (error) { if (error.code === '23P01') throw slotTaken(); throw error; }
  await event(req, b.id, 'rescheduled', { from: b.starts_at, to: slot.start });
  await admin.from('reminders').update({
    scheduled_for: new Date(Date.parse(slot.start) - 864e5).toISOString(), status: 'pending', attempts: 0, sent_at: null, last_error: null,
  }).eq('booking_id', b.id).neq('status', 'sending');
  ok(res, await loadBooking(req));
});

export default r;
