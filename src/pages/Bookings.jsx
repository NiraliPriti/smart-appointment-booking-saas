import { useState } from 'react';
import { api } from '../lib/api';
import { fmt, money } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, Status, useLoad } from '../ui';
import BookingModal from './BookingModal';

export default function Bookings() {
  const { me } = useAuth();
  const tz = me.business.timezone;
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api(`/bookings?order=desc&page=${page}&pageSize=20${status ? `&status=${status}` : ''}`), [status, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="row between">
        <h1>Bookings</h1>
        <select aria-label="Filter by status" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data?.items.length === 0 ? (
        <div className="card muted">No bookings yet. Share your booking link to get your first one.</div>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>When</th><th>Client</th><th>Service</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>
              {data?.items.map((b) => (
                <tr key={b.id} className="click" onClick={() => setOpen(b.id)}>
                  <td>{fmt(b.starts_at, tz)}</td><td>{b.clients.name}</td><td>{b.services.name}</td><td>{money(b.price_cents)}</td><td><Status s={b.status} /></td>
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
      {open && <BookingModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
