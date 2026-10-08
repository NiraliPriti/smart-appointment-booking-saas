import { Router } from 'express';
import { admin } from '../lib/supabase.js';
import { ok } from '../lib/http.js';
import { hasAccess } from '../lib/billing.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();
r.get('/me', requireAuth, async (req, res) => {
  let subscription = null;
  if (req.businessId) {
    const { data } = await admin.from('subscriptions').select('status,current_period_end,trial_ends_at').eq('business_id', req.businessId).maybeSingle();
    subscription = data && { ...data, hasAccess: hasAccess(data) };
  }
  ok(res, { user: { id: req.user.id, email: req.user.email }, business: req.business, subscription });
});
export default r;
