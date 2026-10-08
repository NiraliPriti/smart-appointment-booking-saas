import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { admin } from '../lib/supabase.js';
import { HttpError, fail, ok, parse } from '../lib/http.js';
import { hasAccess } from '../lib/billing.js';
import { log } from '../lib/logger.js';
import { tenantNoBilling } from '../middleware/auth.js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const mode = () => (process.env.BILLING_MODE === 'stripe' ? 'stripe' : 'simulate');
const THIRTY_DAYS = 30 * 864e5;

const r = Router();

r.get('/', tenantNoBilling, async (req, res) => {
  const { data } = await admin.from('subscriptions').select('status,plan,current_period_end,trial_ends_at').eq('business_id', req.businessId).single();
  ok(res, { mode: mode(), subscription: { ...data, hasAccess: hasAccess(data) } });
});

r.post('/checkout', tenantNoBilling, async (req, res) => {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  if (mode() === 'simulate') {
    await admin.from('subscriptions').update({ status: 'active', current_period_end: new Date(Date.now() + THIRTY_DAYS).toISOString() }).eq('business_id', req.businessId);
    return ok(res, { simulated: true });
  }
  if (!stripe || !process.env.STRIPE_PRICE_ID) throw new HttpError(503, 'billing_unconfigured', 'Billing is not configured');
  const { data: sub } = await admin.from('subscriptions').select('provider_customer_id').eq('business_id', req.businessId).single();
  let customer = sub.provider_customer_id;
  if (!customer) {
    customer = (await stripe.customers.create({ email: req.user.email, name: req.business.name, metadata: { business_id: req.businessId } })).id;
    await admin.from('subscriptions').update({ provider_customer_id: customer }).eq('business_id', req.businessId);
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, client_reference_id: req.businessId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: { metadata: { business_id: req.businessId } },
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
  });
  ok(res, { url: session.url });
});

// Demo-only: lets reviewers flip states to see gating. Disabled unless BILLING_MODE=simulate.
r.post('/simulate', tenantNoBilling, async (req, res) => {
  if (mode() !== 'simulate') throw new HttpError(404, 'not_found', 'Not found');
  const { status } = parse(z.object({ status: z.enum(['active', 'trialing', 'past_due', 'cancelled', 'incomplete']) }), req.body);
  const future = new Date(Date.now() + THIRTY_DAYS).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  await admin.from('subscriptions').update({
    status,
    current_period_end: status === 'past_due' ? past : future,
    trial_ends_at: status === 'trialing' ? future : null,
  }).eq('business_id', req.businessId);
  ok(res, { status });
});

const STRIPE_STATUS = { active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete: 'incomplete', incomplete_expired: 'cancelled' };

async function syncSubscription(sub) {
  let businessId = sub.metadata?.business_id;
  if (!businessId) {
    const { data } = await admin.from('subscriptions').select('business_id').eq('provider_customer_id', sub.customer).maybeSingle();
    businessId = data?.business_id;
  }
  if (!businessId) { log('error', 'webhook: unknown business', { subscription: sub.id }); return; }
  const ts = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  await admin.from('subscriptions').update({
    provider_customer_id: sub.customer, provider_subscription_id: sub.id,
    status: STRIPE_STATUS[sub.status] ?? 'incomplete',
    current_period_end: ts ? new Date(ts * 1000).toISOString() : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  }).eq('business_id', businessId);
}

/** Mounted in app.js BEFORE express.json() because signature verification needs the raw body. */
export async function webhookHandler(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return fail(res, 503, 'billing_unconfigured', 'Billing webhooks are not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); }
  catch { return fail(res, 400, 'invalid_signature', 'Invalid webhook signature'); }

  const { error } = await admin.from('webhook_events').insert({ id: event.id, type: event.type });
  if (error?.code === '23505') return ok(res, { duplicate: true }); // replayed event
  if (error) throw error;

  try {
    if (event.type.startsWith('customer.subscription.')) await syncSubscription(event.data.object);
    if (event.type === 'invoice.payment_failed') {
      await admin.from('subscriptions').update({ status: 'past_due' }).eq('provider_customer_id', event.data.object.customer);
    }
    log('info', 'webhook processed', { eventId: event.id, type: event.type });
  } catch (e) {
    await admin.from('webhook_events').delete().eq('id', event.id); // allow Stripe to retry
    throw e;
  }
  ok(res, { received: true });
}

export default r;
