import { useState } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, useLoad } from '../ui';

export default function Overview() {
  const { me } = useAuth();
  const { data, error, loading } = useLoad(() => api('/dashboard'), []);
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/booking/${me.business.slug}`;

  return (
    <>
      <h1>{me.business.name}</h1>
      <div className="card row between">
        <div><strong>Your booking page</strong><div className="muted small">{url}</div></div>
        <div className="row">
          <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">Open</a>
          <button className="btn sm" onClick={() => navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="grid">
          <div className="card"><div className="muted small">Today's appointments</div><div className="stat">{data.today}</div></div>
          <div className="card"><div className="muted small">Next 7 days</div><div className="stat">{data.upcoming}</div></div>
          <div className="card"><div className="muted small">Booking value (confirmed + completed)</div><div className="stat">{money(data.revenue_cents)}</div></div>
          <div className="card"><div className="muted small">Clients</div><div className="stat">{data.clients}</div></div>
          <div className="card"><div className="muted small">No-show rate (no-shows ÷ completed + no-shows)</div><div className="stat">{Math.round(data.no_show_rate * 100)}%</div></div>
        </div>
      )}
    </>
  );
}
