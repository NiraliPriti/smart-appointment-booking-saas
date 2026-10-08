import { useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../lib/api';
import { fmt, money, todayIn } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Modal, Status, useLoad } from '../ui';

const ACTIONS = {
  pending: [['confirmed', 'Confirm'], ['cancelled', 'Cancel booking']],
  confirmed: [['completed', 'Mark completed'], ['no_show', 'Mark no-show'], ['cancelled', 'Cancel booking']],
};

function Reschedule({ id, tz, onDone }) {
  const [date, setDate] = useState(todayIn(tz));
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data, error, loading } = useLoad(() => api(`/bookings/${id}/slots?date=${date}`), [id, date]);

  async function go() {
    if (!slot || busy) return;
    setBusy(true); setErr('');
    try { await api(`/bookings/${id}/reschedule`, { method: 'POST', body: { startsAt: slot } }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <label htmlFor="rd">New date ({tz})</label>
      <input id="rd" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
      <ErrorBox error={error} />
      {loading ? <p className="muted">Loading times…</p> : data?.slots.length === 0 ? <p className="muted">No free times on this day.</p> : (
        <div className="chips">{data?.slots.map((s) => <button key={s.start} className="chip" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)}>{s.label}</button>)}</div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" disabled={!slot || busy} onClick={go}>{busy ? 'Moving…' : 'Reschedule'}</button>
    </div>
  );
}

export default function BookingModal({ id, onClose, onChanged }) {
  const { me } = useAuth();
  const tz = me.business.timezone;
  const { data: b, error, reload } = useLoad(() => api(`/bookings/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resched, setResched] = useState(false);

  async function act(status) {
    if (busy) return;
    if (status === 'cancelled' && !confirm('Cancel this booking?')) return;
    setBusy(true); setErr('');
    try { await api(`/bookings/${id}`, { method: 'PATCH', body: { status } }); await reload(); onChanged(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Booking details" onClose={onClose}>
      <ErrorBox error={error} />
      {b && (
        <div className="stack">
          <div className="row between"><strong>{b.services.name}</strong><Status s={b.status} /></div>
          <div>{fmt(b.starts_at, tz, 'cccc d LLLL yyyy, HH:mm')}–{fmt(b.ends_at, tz, 'HH:mm')} <span className="muted small">({tz})</span></div>
          <div className="muted">With {b.providers.name} · {money(b.price_cents)}</div>
          <div><strong>{b.clients.name}</strong><div className="muted small">{[b.clients.email, b.clients.phone].filter(Boolean).join(' · ')}</div></div>
          {b.notes && <div className="card small">Client note: {b.notes}</div>}
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row">
            {(ACTIONS[b.status] || []).map(([s, label]) => (
              <button key={s} className={`btn sm ${s === 'cancelled' ? 'danger' : ''}`} disabled={busy} onClick={() => act(s)}>{label}</button>
            ))}
            {['pending', 'confirmed'].includes(b.status) && <button className="btn ghost sm" onClick={() => setResched((v) => !v)}>Reschedule</button>}
          </div>
          {resched && <Reschedule id={id} tz={tz} onDone={() => { setResched(false); reload(); onChanged(); }} />}
          <div>
            <h3>History</h3>
            {b.events.map((e, i) => <div key={i} className="muted small">{fmt(e.created_at, tz, 'd LLL HH:mm')} – {e.event_type.replace('_', ' ')}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
