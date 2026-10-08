import { describe, it, expect } from 'vitest';
import { computeSlots, overlaps } from '../server/lib/slots.js';
import { hasAccess } from '../server/lib/billing.js';
import { normPhone, normEmail } from '../server/lib/normalize.js';

const hours = { enabled: true, start_time: '09:00:00', end_time: '12:00:00' };
const base = { date: '2026-10-12', timezone: 'UTC', durationMinutes: 30, hours, busy: [], now: 0, minNoticeMinutes: 0 };
const t = (iso) => Date.parse(iso);

describe('overlap rule', () => {
  it('back-to-back appointments do not overlap', () => {
    expect(overlaps(t('2026-10-12T09:00Z'), t('2026-10-12T10:00Z'), t('2026-10-12T10:00Z'), t('2026-10-12T11:00Z'))).toBe(false);
  });
  it('partial overlap is detected', () => {
    expect(overlaps(t('2026-10-12T09:30Z'), t('2026-10-12T10:30Z'), t('2026-10-12T10:00Z'), t('2026-10-12T11:00Z'))).toBe(true);
  });
});

describe('computeSlots', () => {
  it('generates 30-minute steps inside working hours', () => {
    const s = computeSlots(base);
    expect(s[0].label).toBe('09:00');
    expect(s.at(-1).label).toBe('11:30');
    expect(s).toHaveLength(6);
  });
  it('a 90-minute service cannot start inside the last 90 minutes', () => {
    const s = computeSlots({ ...base, durationMinutes: 90 });
    expect(s.at(-1).label).toBe('10:30');
  });
  it('an existing booking removes every overlapping candidate, but not the one starting at its end', () => {
    const s = computeSlots({ ...base, busy: [{ start: t('2026-10-12T10:00Z'), end: t('2026-10-12T10:30Z') }] });
    const labels = s.map((x) => x.label);
    expect(labels).not.toContain('10:00');
    expect(labels).toContain('09:30');
    expect(labels).toContain('10:30');
  });
  it('a blocked period rejects overlapping candidates but allows ones that end/start exactly at its edges', () => {
    const s = computeSlots({ ...base, durationMinutes: 60, busy: [{ start: t('2026-10-12T10:30Z'), end: t('2026-10-12T11:00Z') }] });
    expect(s.map((x) => x.label)).toEqual(['09:00', '09:30', '11:00']);
  });
  it('disabled day returns nothing', () => {
    expect(computeSlots({ ...base, hours: { ...hours, enabled: false } })).toEqual([]);
  });
  it('respects minimum notice', () => {
    const s = computeSlots({ ...base, now: t('2026-10-12T09:00Z'), minNoticeMinutes: 60 });
    expect(s[0].label).toBe('10:00');
  });
  it('uses the business timezone (Asia/Kolkata 09:00 = 03:30Z)', () => {
    const s = computeSlots({ ...base, timezone: 'Asia/Kolkata' });
    expect(s[0].start).toBe('2026-10-12T03:30:00.000Z');
  });
  it('handles the US spring-forward day (only 11 real hours between 00:00 and 12:00)', () => {
    const s = computeSlots({ ...base, date: '2026-03-08', timezone: 'America/New_York', hours: { enabled: true, start_time: '00:00', end_time: '12:00' } });
    expect(s).toHaveLength(22);
  });
});

describe('subscription gate', () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  it('active and live trials have access', () => {
    expect(hasAccess({ status: 'active' })).toBe(true);
    expect(hasAccess({ status: 'trialing', trial_ends_at: future })).toBe(true);
  });
  it('expired trial, cancelled and incomplete are denied', () => {
    expect(hasAccess({ status: 'trialing', trial_ends_at: past })).toBe(false);
    expect(hasAccess({ status: 'cancelled' })).toBe(false);
    expect(hasAccess({ status: 'incomplete' })).toBe(false);
    expect(hasAccess(null)).toBe(false);
  });
  it('past_due gets a 3-day grace period', () => {
    expect(hasAccess({ status: 'past_due', current_period_end: past })).toBe(true);
    expect(hasAccess({ status: 'past_due', current_period_end: new Date(Date.now() - 5 * 864e5).toISOString() })).toBe(false);
  });
});

describe('normalization', () => {
  it('dedupes phone formats and email case', () => {
    expect(normPhone('+91 98765-43210')).toBe('+919876543210');
    expect(normPhone('(555) 123-4567')).toBe('5551234567');
    expect(normPhone('12')).toBeNull();
    expect(normEmail(' Jane@Example.COM ')).toBe('jane@example.com');
  });
});
