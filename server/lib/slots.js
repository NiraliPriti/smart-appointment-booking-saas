import { DateTime } from 'luxon';

const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Overlap rule from the spec: a.start < b.end AND a.end > b.start (so back-to-back is fine). */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/**
 * Pure slot generator for ONE provider on ONE local calendar date.
 * - hours: { enabled, start_time:'HH:MM[:SS]', end_time } in the business timezone, or undefined
 * - busy:  [{ start, end }] epoch-millis (blocked periods + active bookings of this provider)
 * All comparisons use absolute epoch millis, so DST transitions are handled by luxon's zone math.
 */
export function computeSlots({
  date, timezone, durationMinutes, hours, busy,
  now = Date.now(), intervalMinutes = 30, minNoticeMinutes = 60,
}) {
  if (!hours || !hours.enabled) return [];
  const day = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!day.isValid) return [];
  const at = (t) => { const m = toMinutes(t); return day.set({ hour: Math.floor(m / 60), minute: m % 60 }).toMillis(); };
  const open = at(hours.start_time);
  const close = at(hours.end_time);
  const dur = durationMinutes * 60000;
  const step = intervalMinutes * 60000;
  const earliest = now + minNoticeMinutes * 60000;
  const out = [];
  for (let s = open; s + dur <= close; s += step) {
    if (s < earliest) continue;
    const e = s + dur;
    if (busy.some((b) => overlaps(s, e, b.start, b.end))) continue;
    out.push({
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      label: DateTime.fromMillis(s, { zone: timezone }).toFormat('HH:mm'),
    });
  }
  return out;
}
