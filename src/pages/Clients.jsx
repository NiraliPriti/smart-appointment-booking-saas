import { useState } from 'react';
import { api } from '../lib/api';
import { fmt, money } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, Modal, Status, useLoad } from '../ui';

function Profile({ id, tz, onClose, onSaved }) {
  const { data: c, error } = useLoad(() => api(`/clients/${id}`), [id]);
  const [notes, setNotes] = useState(null);
  const [state, setState] = useState('');
  async function save() {
    setState('saving');
    try { await api(`/clients/${id}`, { method: 'PATCH', body: { notes } }); setState('saved'); onSaved(); }
    catch (e) { setState(e.message); }
  }
  return (
    <Modal title={c?.name ?? 'Client'} onClose={onClose}>
      <ErrorBox error={error} />
      {c && (
        <div className="stack">
          <div className="muted">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
          <div className="grid">
            <div><div className="muted small">Lifetime value</div><strong>{money(c.lifetime_value_cents)}</strong></div>
            <div><div className="muted small">Last appointment</div>{c.last_appointment ? fmt(c.last_appointment, tz, 'd LLL yyyy') : '—'}</div>
            <div><div className="muted small">Next appointment</div>{c.next_appointment ? fmt(c.next_appointment, tz) : '—'}</div>
          </div>
          <div>
            <label htmlFor="notes">Private notes (never shown to the client)</label>
            <textarea id="notes" rows={3} maxLength={2000} value={notes ?? c.notes ?? ''} onChange={(e) => { setNotes(e.target.value); setState(''); }} />
            <div className="row" style={{ marginTop: '.5rem' }}>
              <button className="btn sm" disabled={notes === null || state === 'saving'} onClick={save}>Save notes</button>
              {state === 'saved' && <span className="msg">Saved</span>}
              {state && !['saved', 'saving'].includes(state) && <span className="err">{state}</span>}
            </div>
          </div>
          <h3>Booking history</h3>
          {c.bookings.length === 0 ? <p className="muted">No bookings.</p> : c.bookings.map((b) => (
            <div key={b.id} className="row between small"><span>{fmt(b.starts_at, tz)} · {b.services.name}</span><span>{money(b.price_cents)} <Status s={b.status} /></span></div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Clients() {
  const { me } = useAuth();
  const tz = me.business.timezone;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api(`/clients?page=${page}&pageSize=25&q=${encodeURIComponent(q)}`), [q, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <h1>Clients</h1>
      <input type="search" aria-label="Search clients" placeholder="Search by name, email or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data?.items.length === 0 ? (
        <div className="card muted">{q ? 'No clients match that search.' : 'Clients appear here automatically after their first booking.'}</div>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th>Bookings</th><th>Lifetime value</th><th>Next</th></tr></thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                  <td>{c.name}</td><td className="small">{c.email || c.phone || '—'}</td><td>{c.total_bookings}</td>
                  <td>{money(c.lifetime_value_cents)}</td><td>{c.next_appointment ? fmt(c.next_appointment, tz) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row between">
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted small">Page {page} of {pages}</span>
        <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {open && <Profile id={open} tz={tz} onClose={() => setOpen(null)} onSaved={reload} />}
    </>
  );
}
