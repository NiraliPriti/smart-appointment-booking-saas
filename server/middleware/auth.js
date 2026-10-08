import { admin, userClient } from '../lib/supabase.js';
import { fail } from '../lib/http.js';
import { hasAccess } from '../lib/billing.js';

/**
 * Authenticates the Supabase JWT and derives the tenant from the membership table.
 * The browser can NEVER choose a business_id: req.businessId comes from the verified identity.
 * req.db acts as the user, so Postgres RLS is a second line of defence on every query.
 */
export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!token) return fail(res, 401, 'unauthenticated', 'Sign in to continue');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return fail(res, 401, 'unauthenticated', 'Your session is invalid or expired');

  const db = userClient(token);
  const { data: m } = await db.from('business_members')
    .select('business_id, role, businesses(id,name,slug,description,timezone,phone,email,status)')
    .maybeSingle();
  req.user = data.user;
  req.db = db;
  req.businessId = m?.business_id ?? null;
  req.business = m?.businesses ?? null;
  req.role = m?.role ?? null;
  next();
}

export function requireTenant(req, res, next) {
  if (!req.businessId) return fail(res, 403, 'onboarding_required', 'Create your business first');
  next();
}

/** Premium gate based on server-side subscription state. */
export async function requireSubscription(req, res, next) {
  const { data } = await admin.from('subscriptions')
    .select('status,current_period_end,trial_ends_at').eq('business_id', req.businessId).maybeSingle();
  if (!hasAccess(data)) return fail(res, 402, 'subscription_required', 'An active subscription is required for this feature');
  next();
}

export const tenant = [requireAuth, requireTenant, requireSubscription];
export const tenantNoBilling = [requireAuth, requireTenant];
