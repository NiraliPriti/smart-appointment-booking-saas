import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { admin } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

/** Provider adapter. Resend if EMAIL_PROVIDER_API_KEY is set, otherwise a console mock. */
export async function sendEmail({ to, subject, text }) {
  const key = process.env.EMAIL_PROVIDER_API_KEY;
  if (!key) {
    log('info', 'mock email sent', { subject });
    return { id: `mock-${randomUUID()}` };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`email provider responded ${r.status}`);
  return { id: (await r.json()).id };
}

/** Builds + sends a booking email and records the attempt in notification_logs. Throws on failure. */
export async function notifyBooking(bookingId, template) {
  const { data: b, error } = await admin.from('bookings')
    .select('id,business_id,starts_at, services(name), providers(name), clients(name,email), businesses(name,timezone)')
    .eq('id', bookingId).single();
  if (error) throw error;
  if (!b.clients?.email) return { skipped: true };

  const when = DateTime.fromISO(b.starts_at).setZone(b.businesses.timezone).toFormat("cccc, d LLLL yyyy 'at' HH:mm (ZZZZ)");
  const reminder = template === 'reminder_24h';
  const subject = reminder ? `Reminder: ${b.services.name} is coming up` : `Booking confirmed: ${b.services.name}`;
  const text = [
    `Hi ${b.clients.name},`, '',
    reminder ? 'This is a reminder about your appointment.' : 'Your appointment is confirmed.', '',
    `Service: ${b.services.name}`, `When: ${when}`, `With: ${b.providers.name}`, `Where: ${b.businesses.name}`,
  ].join('\n');

  let status = 'sent', providerMessageId = null, errMsg = null;
  try { providerMessageId = (await sendEmail({ to: b.clients.email, subject, text })).id; }
  catch (e) { status = 'failed'; errMsg = e.message; }

  await admin.from('notification_logs').insert({
    business_id: b.business_id, booking_id: b.id, channel: 'email', template,
    status, provider_message_id: providerMessageId, error: errMsg,
  });
  if (status === 'failed') throw new Error(errMsg);
  return { sent: true };
}
