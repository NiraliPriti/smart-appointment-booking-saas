import { DateTime } from 'luxon';

export const money = (cents) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: import.meta.env.VITE_CURRENCY || 'USD' }).format(cents / 100);
export const fmt = (iso, tz, f = 'ccc d LLL, HH:mm') => DateTime.fromISO(iso).setZone(tz).toFormat(f);
export const todayIn = (tz) => DateTime.now().setZone(tz).toISODate();
export const dayRange = (date, tz, days = 1) => {
  const s = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { from: s.toUTC().toISO(), to: s.plus({ days }).toUTC().toISO() };
};
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
