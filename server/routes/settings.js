import { Router } from 'express';
import { z } from 'zod';
import { HttpError, ok, parse } from '../lib/http.js';
import { tenant } from '../middleware/auth.js';

const r = Router();
const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const iso = z.string().datetime({ offset: true });

r.get('/schedule', tenant, async (req, res) => {
  const b = req.businessId, db = req.db;
  const [providers, bh, ph, bl] = await Promise.all([
    db.from('providers').select('id,name,active').eq('business_id', b).order('created_at'),
    db.from('business_hours').select('day_of_week,start_time,end_time,enabled').eq('business_id', b).order('day_of_week'),
    db.from('provider_hours').select('provider_id,day_of_week,start_time,end_time,enabled').eq('business_id', b),
    db.from('blocked_periods').select('id,provider_id,starts_at,ends_at,reason').eq('business_id', b).gte('ends_at', new Date().toISOString()).order('starts_at'),
  ]);
  for (const x of [providers, bh, ph, bl]) if (x.error) throw x.error;
  ok(res, { timezone: req.business.timezone, providers: providers.data, businessHours: bh.data, providerHours: ph.data, blocked: bl.data });
});

r.put('/schedule/hours', tenant, async (req, res) => {
  const body = parse(z.object({
    providerId: uuid.optional(),
    hours: z.array(z.object({ dayOfWeek: z.number().int().min(1).max(7), start: hhmm, end: hhmm, enabled: z.boolean() })
      .refine((h) => h.end > h.start, 'end must be after start')).min(1).max(7),
  }), req.body);
  const rows = body.hours.map((h) => ({
    business_id: req.businessId, ...(body.providerId && { provider_id: body.providerId }),
    day_of_week: h.dayOfWeek, start_time: h.start, end_time: h.end, enabled: h.enabled,
  }));
  const table = body.providerId ? 'provider_hours' : 'business_hours';
  const { error } = await req.db.from(table).upsert(rows, { onConflict: body.providerId ? 'provider_id,day_of_week' : 'business_id,day_of_week' });
  if (error) throw error;
  ok(res, { saved: rows.length });
});

r.delete('/schedule/hours/:providerId', tenant, async (req, res) => {
  const pid = parse(uuid, req.params.providerId);
  const { error } = await req.db.from('provider_hours').delete().eq('provider_id', pid).eq('business_id', req.businessId);
  if (error) throw error;
  ok(res, { deleted: true });
});

r.post('/schedule/blocked', tenant, async (req, res) => {
  const body = parse(z.object({
    startsAt: iso, endsAt: iso, reason: z.string().trim().max(200).optional(), providerId: uuid.optional(),
  }).refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), 'endsAt must be after startsAt'), req.body);
  const { data, error } = await req.db.from('blocked_periods').insert({
    business_id: req.businessId, provider_id: body.providerId ?? null,
    starts_at: body.startsAt, ends_at: body.endsAt, reason: body.reason || null,
  }).select().single();
  if (error) throw error;
  ok(res, data, 201);
});

r.delete('/schedule/blocked/:id', tenant, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { error } = await req.db.from('blocked_periods').delete().eq('id', id).eq('business_id', req.businessId);
  if (error) throw error;
  ok(res, { deleted: true });
});

r.post('/providers', tenant, async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
  const { data, error } = await req.db.from('providers').insert({ business_id: req.businessId, name }).select().single();
  if (error) throw error;
  ok(res, data, 201);
});

r.patch('/providers/:id', tenant, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }), req.body);
  const { data, error } = await req.db.from('providers').update(body).eq('id', id).eq('business_id', req.businessId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'not_found', 'Provider not found');
  ok(res, data);
});

r.patch('/business', tenant, async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'use 3-40 lowercase letters, numbers or hyphens').optional(),
    description: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'unknown timezone').optional(),
  }), req.body);
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
  const { data, error } = await req.db.from('businesses').update(patch).eq('id', req.businessId).select().single();
  if (error) throw error;
  ok(res, data);
});

r.get('/dashboard', tenant, async (req, res) => {
  const { DateTime } = await import('luxon');
  const day = DateTime.now().setZone(req.business.timezone).startOf('day');
  const { data, error } = await req.db.rpc('dashboard_stats', { p_day_start: day.toUTC().toISO(), p_day_end: day.plus({ days: 1 }).toUTC().toISO() });
  if (error) throw error;
  const done = data.completed + data.no_show;
  ok(res, { ...data, no_show_rate: done ? data.no_show / done : 0 }); // no-show rate = no_show / (completed + no_show)
});

export default r;
