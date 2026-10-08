import { Router } from 'express';
import { z } from 'zod';
import { HttpError, ok, parse } from '../lib/http.js';
import { tenant } from '../middleware/auth.js';

const r = Router();
r.use(tenant);

const base = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0).max(10_000_000),
  active: z.boolean().optional(),
});
const toRow = (b) => ({
  ...(b.name !== undefined && { name: b.name }),
  ...(b.description !== undefined && { description: b.description || null }),
  ...(b.durationMinutes !== undefined && { duration_minutes: b.durationMinutes }),
  ...(b.priceCents !== undefined && { price_cents: b.priceCents }),
  ...(b.active !== undefined && { active: b.active }),
});

r.get('/', async (req, res) => {
  const { data, error } = await req.db.from('services').select('*').eq('business_id', req.businessId).order('created_at');
  if (error) throw error;
  ok(res, data);
});

r.post('/', async (req, res) => {
  const body = parse(base, req.body);
  const { data, error } = await req.db.from('services').insert({ ...toRow(body), business_id: req.businessId }).select().single();
  if (error) throw error;
  ok(res, data, 201);
});

r.patch('/:id', async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const body = parse(base.partial(), req.body);
  const { data, error } = await req.db.from('services').update(toRow(body)).eq('id', id).eq('business_id', req.businessId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'not_found', 'Service not found');
  ok(res, data);
});

export default r;
