import { DateTime } from 'luxon';
import { admin } from '../lib/supabase.js';
import { HttpError } from '../lib/http.js';
import { computeSlots } from '../lib/slots.js';

export const MAX_ADVANCE_DAYS = 90;

/**
 * Authoritative availability for a date range (one DB round-trip per table for the whole range).
 * If providerId is omitted, slots from all active providers are merged ("any available").
 * A provider with ANY provider_hours rows uses only those (missing day = day off); otherwise business hours apply.
 */
export async function getAvailability({
  businessId, serviceId, providerId = null, from, days = 1,
  excludeBookingId = null, requireActiveService = true, now = Date.now(),
}) {
  const { data: biz } = await admin.from('businesses').select('id,timezone,status').eq('id', businessId).maybeSingle();
  if (!biz || biz.status !== 'active') throw new HttpError(404, 'not_found', 'Business not found');

  const { data: service } = await admin.from('services').select('*').eq('id', serviceId).eq('business_id', businessId).maybeSingle();
  if (!service || (requireActiveService && !service.active)) throw new HttpError(404, 'not_found', 'Service not found');

  let pq = admin.from('providers').select('id,name').eq('business_id', businessId).eq('active', true).order('created_at');
  if (providerId) pq = pq.eq('id', providerId);
  const { data: providers, error: pe } = await pq;
  if (pe) throw pe;
  if (!providers?.length) throw new HttpError(404, 'not_found', 'Provider not found');

  const tz = biz.timezone;
  const start = DateTime.fromISO(from, { zone: tz }).startOf('day');
  if (!start.isValid) throw new HttpError(400, 'validation_error', 'Invalid date');
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  if (start < today.minus({ days: 1 }) || start > today.plus({ days: MAX_ADVANCE_DAYS }))
    throw new HttpError(400, 'validation_error', `Date must be within the next ${MAX_ADVANCE_DAYS} days`);

  const end = start.plus({ days });
  const ids = providers.map((p) => p.id);
  const s = start.toUTC().toISO();
  const e = end.toUTC().toISO();

  let bq = admin.from('bookings').select('id,provider_id,starts_at,ends_at')
    .in('provider_id', ids).in('status', ['pending', 'confirmed']).lt('starts_at', e).gt('ends_at', s);
  if (excludeBookingId) bq = bq.neq('id', excludeBookingId);

  const [bh, ph, bl, bk] = await Promise.all([
    admin.from('business_hours').select('*').eq('business_id', businessId),
    admin.from('provider_hours').select('*').in('provider_id', ids),
    admin.from('blocked_periods').select('provider_id,starts_at,ends_at').eq('business_id', businessId).lt('starts_at', e).gt('ends_at', s),
    bq,
  ]);
  for (const r of [bh, ph, bl, bk]) if (r.error) throw r.error;

  const bizHours = Object.fromEntries(bh.data.map((h) => [h.day_of_week, h]));
  const provHours = {};
  for (const h of ph.data) (provHours[h.provider_id] ??= {})[h.day_of_week] = h;
  const ms = (x) => ({ start: Date.parse(x.starts_at), end: Date.parse(x.ends_at) });

  const result = [];
  for (let i = 0; i < days; i++) {
    const d = start.plus({ days: i });
    const merged = new Map();
    for (const p of providers) {
      const hours = provHours[p.id] ? provHours[p.id][d.weekday] : bizHours[d.weekday];
      const busy = [
        ...bl.data.filter((b) => !b.provider_id || b.provider_id === p.id),
        ...bk.data.filter((b) => b.provider_id === p.id),
      ].map(ms);
      const slots = computeSlots({ date: d.toISODate(), timezone: tz, durationMinutes: service.duration_minutes, hours, busy, now });
      for (const sl of slots) if (!merged.has(sl.start)) merged.set(sl.start, { ...sl, providerId: p.id });
    }
    result.push({ date: d.toISODate(), slots: [...merged.values()].sort((a, b) => (a.start < b.start ? -1 : 1)) });
  }
  return { timezone: tz, service, days: result };
}
