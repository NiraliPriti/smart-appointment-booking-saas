// Needs a real Supabase project with the migration applied (see README). Skipped otherwise.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anon && svc);

describe.skipIf(!enabled)('integration: tenancy, booking race, reminders, webhook', () => {
  let server, base, admin, A, B, slot;
  const stamp = Date.now();
  const mk = async (label) => {
    const email = `${label}-${stamp}@example.test`, password = 'Passw0rd!test';
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const client = createClient(url, anon, { auth: { persistSession: false } });
    const { data: s } = await client.auth.signInWithPassword({ email, password });
    const { data: businessId, error } = await client.rpc('create_business', { p_name: `Biz ${label}`, p_slug: `biz-${label}-${stamp}`, p_timezone: 'UTC' });
    if (error) throw error;
    const { data: svcRow } = await client.from('services').insert({ business_id: businessId, name: 'Cut', duration_minutes: 30, price_cents: 2500 }).select().single();
    return { userId: data.user.id, token: s.session.access_token, client, businessId, slug: `biz-${label}-${stamp}`, serviceId: svcRow.id };
  };
  const api = (path, { token, method = 'GET', body, headers } = {}) =>
    fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
    process.env.CRON_SECRET = 'test-secret';
    admin = createClient(url, svc, { auth: { persistSession: false } });
    const { default: app } = await import('../server/app.js');
    server = app.listen(0);
    base = `http://localhost:${server.address().port}`;
    A = await mk('a'); B = await mk('b');
    const from = new Date().toISOString().slice(0, 10);
    const av = await api(`/public/businesses/${A.slug}/availability?serviceId=${A.serviceId}&from=${from}&days=14`);
    slot = av.body.data.days.flatMap((d) => d.slots)[0];
  }, 60000);

  afterAll(async () => {
    server?.close();
    for (const u of [A, B]) if (u) await admin.auth.admin.deleteUser(u.userId); // cascades to tenant data
  });

  it('rejects unauthenticated access to private routes', async () => {
    expect((await api('/bookings')).status).toBe(401);
    expect((await api('/clients', { token: 'garbage' })).status).toBe(401);
  });

  it('RLS: Business A cannot read or modify Business B rows via direct Supabase queries', async () => {
    const read = await A.client.from('services').select('*').eq('business_id', B.businessId);
    expect(read.data).toEqual([]);
    const upd = await A.client.from('services').update({ name: 'hacked' }).eq('id', B.serviceId).select();
    expect(upd.data).toEqual([]);
    const ins = await A.client.from('services').insert({ business_id: B.businessId, name: 'x', duration_minutes: 30, price_cents: 1 });
    expect(ins.error).toBeTruthy();
    const { data: still } = await admin.from('services').select('name').eq('id', B.serviceId).single();
    expect(still.name).toBe('Cut');
  });

  it('public profile exposes only public fields', async () => {
    const r = await api(`/public/businesses/${A.slug}`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['description', 'email', 'name', 'phone', 'slug', 'timezone']);
    expect((await api('/public/businesses/does-not-exist')).status).toBe(404);
  });

  it('two simultaneous bookings for the same slot: exactly one succeeds', async () => {
    const mkBody = (n) => ({ serviceId: A.serviceId, startsAt: slot.start, name: `Client ${n}`, email: `c${n}-${stamp}@example.test` });
    const results = await Promise.all([1, 2, 3, 4].map((n) => api(`/public/businesses/${A.slug}/bookings`, { method: 'POST', body: mkBody(n) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
  });

  it('booking appears for A, never for B; CRM is tenant-scoped', async () => {
    const mine = await api('/bookings', { token: A.token });
    expect(mine.body.data.total).toBe(1);
    expect((await api('/bookings', { token: B.token })).body.data.total).toBe(0);
    expect((await api('/clients', { token: B.token })).body.data.total).toBe(0);
    expect((await api('/clients', { token: A.token })).body.data.total).toBe(1);
  });

  it('cancelling frees the slot', async () => {
    const [bk] = (await api('/bookings', { token: A.token })).body.data.items;
    expect((await api(`/bookings/${bk.id}`, { token: A.token, method: 'PATCH', body: { status: 'cancelled' } })).status).toBe(200);
    const r = await api(`/public/businesses/${A.slug}/bookings`, { method: 'POST', body: { serviceId: A.serviceId, startsAt: slot.start, name: 'Again', email: `again-${stamp}@example.test` } });
    expect(r.status).toBe(201);
  });

  it('reminder job is idempotent: a second run sends nothing new', async () => {
    await admin.from('reminders').update({ scheduled_for: new Date(Date.now() - 1000).toISOString(), status: 'pending', attempts: 0 }).eq('business_id', A.businessId);
    const auth = { headers: { Authorization: 'Bearer test-secret' } };
    const first = await api('/cron/reminders', auth);
    const second = await api('/cron/reminders', auth);
    expect(first.body.data.sent).toBeGreaterThanOrEqual(1);
    expect(second.body.data.sent).toBe(0);
    expect((await api('/cron/reminders')).status).toBe(401);
  });

  it('webhook with an invalid signature is rejected', async () => {
    const r = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: '{}' });
    expect(r.status).toBe(400);
  });

  it('premium routes are denied once the subscription lapses', async () => {
    await admin.from('subscriptions').update({ status: 'cancelled' }).eq('business_id', A.businessId);
    expect((await api('/clients', { token: A.token })).status).toBe(402);
    expect((await api(`/public/businesses/${A.slug}/availability?serviceId=${A.serviceId}&from=${new Date().toISOString().slice(0, 10)}`)).status).toBe(403);
  });
});
