import { admin } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { notifyBooking } from '../services/notify.js';

/**
 * Idempotent 24h-reminder job.
 * claim_reminders() atomically flips due rows pending -> sending (FOR UPDATE SKIP LOCKED),
 * so overlapping/duplicate runs cannot process the same reminder. Max 3 attempts per reminder.
 */
export async function runReminders() {
  const { data: claimed, error } = await admin.rpc('claim_reminders', { p_limit: 50 });
  if (error) throw error;
  const stats = { claimed: claimed.length, sent: 0, skipped: 0, retry: 0, failed: 0 };

  for (const rem of claimed) {
    const { data: b } = await admin.from('bookings').select('status,starts_at').eq('id', rem.booking_id).single();
    if (!b || !['pending', 'confirmed'].includes(b.status) || Date.parse(b.starts_at) <= Date.now()) {
      await admin.from('reminders').update({ status: 'skipped' }).eq('id', rem.id);
      stats.skipped++;
      continue;
    }
    try {
      await notifyBooking(rem.booking_id, 'reminder_24h');
      await admin.from('reminders').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', rem.id);
      stats.sent++;
    } catch (e) {
      const final = rem.attempts >= 3;
      await admin.from('reminders').update({ status: final ? 'failed' : 'pending', last_error: String(e.message).slice(0, 300) }).eq('id', rem.id);
      final ? stats.failed++ : stats.retry++;
    }
  }
  log('info', 'reminder job finished', stats);
  return stats;
}
