import { useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../lib/api';
import { dayRange, fmt, todayIn } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, useLoad } from '../ui';
import BookingModal from './BookingModal';

export default function Calendar() {
  const { me } = useAuth();
  const tz = me.business.timezone;
  const [view, setView] = useState('week');
  const [date, setDate] = useState(todayIn(tz));
  const [open, setOpen] = useState(null);

  const d = DateTime.fromISO(date, { zone: tz });
  const start = view === 'week' ? d.startOf('week') : view === 'month' ? d.startOf('month') : d.startOf('day');
  const count = view === 'month' ? start.daysInMonth : view === 'week' ? 7 : 1;
  const { from, to } = dayRange(start.toISODate(), tz, count);
  const { data, error, loading, reload } = useLoad(() => api(`/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=200`), [from, to]);

  const byDay = {};
  for (const b of data?.items ?? []) (byDay[fmt(b.starts_at, tz, 'yyyy-MM-dd')] ??= []).push(b);
  const move = (dir) => setDate(d.plus({ [view === 'month' ? 'months' : view === 'week' ? 'weeks' : 'days']: dir }).toISODate());

  const Appt = ({ b }) => (
    <button className={`appt s-${b.status}`} onClick={() => setOpen(b.id)}>
      <span><strong>{fmt(b.starts_at, tz, 'HH:mm')}</strong> {b.clients.name}</span>
      <div className="small">{b.services.name} · {b.providers.name}</div>
    </button>
  );
  const days = Array.from({ length: count }, (_, i) => start.plus({ days: i }));

  return (
    <>
      <div className="row between">
        <h1>Calendar</h1>
        <div className="row">
          {['day', 'week', 'month'].map((v) => <button key={v} className="chip" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </div>
      </div>
      <div className="row">
        <button className="btn ghost sm" onClick={() => move(-1)} aria-label="Previous">‹</button>
        <button className="btn ghost sm" onClick={() => setDate(todayIn(tz))}>Today</button>
        <button className="btn ghost sm" onClick={() => move(1)} aria-label="Next">›</button>
        <strong>{view === 'month' ? start.toFormat('LLLL yyyy') : view === 'week' ? `${start.toFormat('d LLL')} – ${start.plus({ days: 6 }).toFormat('d LLL yyyy')}` : start.toFormat('cccc d LLLL yyyy')}</strong>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : view === 'month' ? (
        <div className="cal-month">
          {Array.from({ length: start.weekday - 1 }, (_, i) => <div key={`e${i}`} className="cal-cell empty" />)}
          {days.map((day) => {
            const list = byDay[day.toISODate()] ?? [];
            return (
              <button key={day.toISODate()} className="cal-cell" onClick={() => { setDate(day.toISODate()); setView('day'); }}>
                <strong>{day.day}</strong>
                {list.length > 0 && <div className="small muted">{list.length} booking{list.length > 1 ? 's' : ''}</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={view === 'week' ? 'cal-week' : 'stack'}>
          {days.map((day) => {
            const list = byDay[day.toISODate()] ?? [];
            return (
              <div key={day.toISODate()} className="card">
                <strong>{day.toFormat('ccc d LLL')}</strong>
                {list.length === 0 ? <div className="muted small">Nothing booked</div> : list.map((b) => <Appt key={b.id} b={b} />)}
              </div>
            );
          })}
        </div>
      )}
      {open && <BookingModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
