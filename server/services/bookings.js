import { DateTime } from 'luxon';
import { admin } from '../lib/supabase.js';
import { HttpError } from '../lib/http.js';
import { log } from '../lib/logger.js';
import { normEmail, normPhone } from '../lib/normalize.js';
import { getAvailability } from './availability.js';
import { notifyBooking } from './notify.js';

const DAY_MS = 864e5;
export const slotTaken = () => new HttpError(409, 'slot_unavailable', 'That time is no longer available. Please pick another slot.');

/** Find-or-create a CRM client, deduplicating on normalized email, then phone. */
async function upsertClient(businessId, { name, email, phone }) {
  const e = normEmail(email), p = normPhone(phone);
  for (const [col, val] of [['email', e], ['phone', p]]) {
    if (!val) continue;
    const { data } = await admin.from('clients').select('*').eq('business_id', businessId).eq(col, val).maybeSingle();
    if (data) return data;
  }
  const { data, error } = await admin.from('clients').insert({ business_id: businessId, name, email: e, phone: p }).select().single();
  if (error?.code === '23505') { // lost a creation race: re-read
    const { data: again } = await admin.from('clients').select('*').eq('business_id', businessId).eq(e ? 'email' : 'phone', e || p).single();
    return again;
  }
  if (error) throw error;
  return data;
}

/**
 * Public booking: re-validates the slot on the server, then inserts.
 * The exclusion constraint on bookings is the final guard if two requests race past the check.
 */
export async function createPublicBooking(business, input) {
  const startIso = new Date(input.startsAt).toISOString();
  const date = DateTime.fromISO(startIso).setZone(business.timezone).toISODate();
  const av = await getAvailability({ businessId: business.id, serviceId: input.serviceId, providerId: input.providerId, from: date, days: 1 });
  const slot = av.days[0].slots.find((s) => s.start === startIso);
  if (!slot) throw slotTaken();

  const client = await upsertClient(business.id, input);
  const { data: booking, error } = await admin.from('bookings').insert({
    business_id: business.id, service_id: input.serviceId, provider_id: slot.providerId, client_id: client.id,
    starts_at: slot.start, ends_at: slot.end, status: 'confirmed',
    price_cents: av.service.price_cents, source: 'public', notes: input.notes || null,
  }).select().single();
  if (error) { if (error.code === '23P01') throw slotTaken(); throw error; }

  await admin.from('booking_events').insert({ booking_id: booking.id, business_id: business.id, event_type: 'created', metadata: { source: 'public' } });
  await admin.from('reminders').insert({
    booking_id: booking.id, business_id: business.id,
    scheduled_for: new Date(Date.parse(slot.start) - DAY_MS).toISOString(),
  });
  try { await notifyBooking(booking.id, 'booking_confirmation'); }
  catch (e) { log('error', 'confirmation notification failed', { bookingId: booking.id }); } // never fail the booking

  return { booking, service: av.service, providerId: slot.providerId };
}
