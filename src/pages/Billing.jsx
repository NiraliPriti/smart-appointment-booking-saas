import { useState } from 'react';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, useLoad } from '../ui';

export default function Billing() {
  const { me, refresh } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api('/billing'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const after = async () => { await reload(); await refresh(); };

  async function subscribe() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/billing/checkout', { method: 'POST' });
      if (r.url) { window.location.href = r.url; return; }
      await after();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const simulate = (status) => api('/billing/simulate', { method: 'POST', body: { status } }).then(after).catch((e) => setErr(e.message));
  const sub = data?.subscription;
  const tz = me.business.timezone;

  return (
    <>
      <h1>Billing</h1>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : sub && (
        <div className="card stack">
          <div className="row between"><strong>Pro plan · monthly</strong><span className={`badge ${sub.hasAccess ? 's-completed' : 's-no_show'}`}>{sub.status.replace('_', ' ')}</span></div>
          <div className="muted">{sub.hasAccess ? 'Full dashboard access and online bookings are enabled.' : 'Dashboard features and online booking are locked until you subscribe.'}</div>
          {sub.status === 'trialing' && sub.trial_ends_at && <div>Trial ends {fmt(sub.trial_ends_at, tz, 'd LLL yyyy')}</div>}
          {sub.status === 'active' && sub.current_period_end && <div>Renews {fmt(sub.current_period_end, tz, 'd LLL yyyy')}</div>}
          {err && <p className="err" role="alert">{err}</p>}
          {sub.status !== 'active' && <button className="btn" onClick={subscribe} disabled={busy}>{busy ? 'Please wait…' : 'Subscribe'}</button>}
          {data.mode === 'simulate' && (
            <div className="card small">
              <strong>Demo mode</strong> – billing is simulated. Switch state to see feature gating:
              <div className="row" style={{ marginTop: '.5rem' }}>
                {['active', 'trialing', 'past_due', 'cancelled'].map((s) => <button key={s} className="btn ghost sm" onClick={() => simulate(s)}>{s.replace('_', ' ')}</button>)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
