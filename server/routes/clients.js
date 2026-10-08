import { Router } from 'express';
import { z } from 'zod';
import { HttpError, ok, parse } from '../lib/http.js';
import { normEmail, normPhone } from '../lib/normalize.js';
import { tenant } from '../middleware/auth.js';

const r = Router();
r.use(tenant);
const uuid = z.string().uuid();

r.get('/', async (req, res) => {
  const q = parse(z.object({
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }), req.query);
  let query = req.db.from('client_stats').select('*', { count: 'exact' }).eq('business_id', req.businessId);
  const term = (q.q || '').replace(/[^\p{L}\p{N}@.+\- ]/gu, ''); // strip characters that could alter the filter syntax
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const offset = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query.order('name').range(offset, offset + q.pageSize - 1);
  if (error) throw error;
  ok(res, { items: data, total: count, page: q.page, pageSize: q.pageSize });
});

r.get('/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { data: client, error } = await req.db.from('client_stats').select('*').eq('id', id).eq('business_id', req.businessId).maybeSingle();
  if (error) throw error;
  if (!client) throw new HttpError(404, 'not_found', 'Client not found');
  const { data: bookings } = await req.db.from('bookings')
    .select('id,starts_at,status,price_cents, services(name), providers(name)')
    .eq('client_id', id).eq('business_id', req.businessId).order('starts_at', { ascending: false }).limit(100);
  ok(res, { ...client, bookings });
});

r.patch('/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: z.string().trim().regex(/^[\d\s()+-]{7,20}$/).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }), req.body);
  const patch = { ...body };
  if ('email' in body) patch.email = normEmail(body.email);
  if ('phone' in body) patch.phone = normPhone(body.phone);
  const { data, error } = await req.db.from('clients').update(patch).eq('id', id).eq('business_id', req.businessId).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'not_found', 'Client not found');
  ok(res, data);
});

export default r;
