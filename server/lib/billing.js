const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // past_due keeps access for 3 days after the period end

/** Server-side subscription gate. Never trust a client-supplied status. */
export function hasAccess(sub, now = Date.now()) {
  if (!sub) return false;
  const end = sub.current_period_end ? Date.parse(sub.current_period_end) : 0;
  switch (sub.status) {
    case 'active': return true;
    case 'trialing': return (sub.trial_ends_at ? Date.parse(sub.trial_ends_at) : end) > now;
    case 'past_due': return end + GRACE_MS > now;
    default: return false; // cancelled, incomplete
  }
}
