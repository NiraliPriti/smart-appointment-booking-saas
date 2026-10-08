import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
import { useAuth } from '../auth';
import { ErrorBox, Loading, useLoad } from '../ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toRows = (list) => DAYS.map((_, i) => {
  const h = list.find((x) => x.day_of_week === i + 1);
  return { dayOfWeek: i + 1, enabled: h ? h.enabled : false, start: h ? h.start_time.slice(0, 5) : '09:00', end: h ? h.end_time.slice(0, 5) : '17:00' };
});

function useAction() {
  const [state, setState] = useState({ busy: false, err: '', ok: '' });
  const run = async (fn, okMsg = 'Saved') => {
    if (state.busy) return;
    setState({ busy: true, err: '', ok: '' });
    try { await fn(); setState({ busy: false, err: '', ok: okMsg }); } catch (e) { setState({ busy: false, err: e.message, ok: '' }); }
  };
  return [state, run];
}
const Feedback = ({ s }) => <>{s.err && <p className="err" role="alert">{s.err}</p>}{s.ok && <p className="msg">{s.ok}</p>}</>;

function Profile() {
  const { me, refresh } = useAuth();
  const b = me.business;
  const [f, setF] = useState({ name: b.name, slug: b.slug, description: b.description ?? '', phone: b.phone ?? '', email: b.email ?? '', timezone: b.timezone });
  const [s, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/business', { method: 'PATCH', body: f }); await refresh(); }); }}>
      <h2>Business profile</h2>
      <div className="grid">
        <div><label htmlFor="pn">Name</label><input id="pn" required value={f.name} onChange={set('name')} /></div>
        <div><label htmlFor="ps">Booking address</label><input id="ps" required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" value={f.slug} onChange={set('slug')} /></div>
        <div><label htmlFor="pt">Timezone</label><select id="pt" value={f.timezone} onChange={set('timezone')}>{Intl.supportedValuesOf('timeZone').map((z) => <option key={z}>{z}</option>)}</select></div>
        <div><label htmlFor="pp">Phone</label><input id="pp" value={f.phone} onChange={set('phone')} /></div>
        <div><label htmlFor="pe">Public email</label><input id="pe" type="email" value={f.email} onChange={set('email')} /></div>
      </div>
      <label htmlFor="pd">About</label><textarea id="pd" rows={2} maxLength={500} value={f.description} onChange={set('description')} />
      <Feedback s={s} />
      <button className="btn" style={{ marginTop: '.8rem' }} disabled={s.busy}>Save profile</button>
    </form>
  );
}

function Hours({ data, reload }) {
  const [target, setTarget] = useState('');
  const [rows, setRows] = useState([]);
  const [s, run] = useAction();
  const custom = target && data.providerHours.some((h) => h.provider_id === target);
  useEffect(() => {
    setRows(toRows(target ? (custom ? data.providerHours.filter((h) => h.provider_id === target) : data.businessHours) : data.businessHours));
  }, [target, data, custom]);
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="card">
      <h2>Working hours</h2>
      <label htmlFor="ht">Schedule for</label>
      <select id="ht" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Business default</option>
        {data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}{data.providerHours.some((h) => h.provider_id === p.id) ? ' (custom)' : ''}</option>)}
      </select>
      {target && !custom && <p className="muted small">This provider follows business hours. Saving creates a custom schedule.</p>}
      <div className="tablewrap"><table><tbody>
        {rows.map((r, i) => (
          <tr key={r.dayOfWeek}>
            <td><label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto', marginRight: '.5rem' }} checked={r.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} />{DAYS[i]}</label></td>
            <td><input type="time" aria-label={`${DAYS[i]} opens`} disabled={!r.enabled} value={r.start} onChange={(e) => upd(i, { start: e.target.value })} /></td>
            <td><input type="time" aria-label={`${DAYS[i]} closes`} disabled={!r.enabled} value={r.end} onChange={(e) => upd(i, { end: e.target.value })} /></td>
          </tr>
        ))}
      </tbody></table></div>
      <Feedback s={s} />
      <div className="row" style={{ marginTop: '.8rem' }}>
        <button className="btn" disabled={s.busy} onClick={() => run(async () => { await api('/schedule/hours', { method: 'PUT', body: { providerId: target || undefined, hours: rows } }); await reload(); })}>Save hours</button>
        {custom && <button className="btn ghost" disabled={s.busy} onClick={() => run(async () => { await api(`/schedule/hours/${target}`, { method: 'DELETE' }); await reload(); }, 'Now using business hours')}>Use business hours</button>}
      </div>
    </div>
  );
}

function Blocked({ data, reload, tz }) {
  const [f, setF] = useState({ start: '', end: '', reason: '', providerId: '' });
  const [s, run] = useAction();
  const iso = (v) => DateTime.fromISO(v, { zone: tz }).toUTC().toISO();
  return (
    <div className="card">
      <h2>Time off and blocked periods</h2>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/schedule/blocked', { method: 'POST', body: { startsAt: iso(f.start), endsAt: iso(f.end), reason: f.reason || undefined, providerId: f.providerId || undefined } }); setF({ start: '', end: '', reason: '', providerId: '' }); await reload(); }, 'Blocked'); }}>
        <div className="grid">
          <div><label htmlFor="bs">From ({tz})</label><input id="bs" type="datetime-local" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div><label htmlFor="be">Until</label><input id="be" type="datetime-local" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          <div><label htmlFor="bp">Applies to</label><select id="bp" value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}><option value="">Whole business</option>{data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label htmlFor="br">Reason</label><input id="br" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        <Feedback s={s} />
        <button className="btn" style={{ marginTop: '.8rem' }} disabled={s.busy}>Block time</button>
      </form>
      {data.blocked.length === 0 ? <p className="muted">Nothing blocked.</p> : data.blocked.map((b) => (
        <div key={b.id} className="row between small" style={{ marginTop: '.5rem' }}>
          <span>{fmt(b.starts_at, tz)} → {fmt(b.ends_at, tz)} {b.reason && `· ${b.reason}`}</span>
          <button className="btn ghost sm" onClick={() => api(`/schedule/blocked/${b.id}`, { method: 'DELETE' }).then(reload)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function Providers({ data, reload }) {
  const [name, setName] = useState('');
  const [s, run] = useAction();
  return (
    <div className="card">
      <h2>Providers</h2>
      <p className="muted small">Each provider has their own calendar. Clients can choose one or take the first available.</p>
      {data.providers.map((p) => (
        <div key={p.id} className="row between" style={{ marginTop: '.4rem' }}>
          <span>{p.name} {!p.active && <span className="muted">(inactive)</span>}</span>
          <button className="btn ghost sm" onClick={() => api(`/providers/${p.id}`, { method: 'PATCH', body: { active: !p.active } }).then(reload)}>{p.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      ))}
      <form className="row" style={{ marginTop: '.8rem' }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/providers', { method: 'POST', body: { name } }); setName(''); await reload(); }, 'Added'); }}>
        <input aria-label="New provider name" required maxLength={80} placeholder="Provider name" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={s.busy}>Add provider</button>
      </form>
      <Feedback s={s} />
    </div>
  );
}

export default function Settings() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api('/schedule'), []);
  return (
    <>
      <h1>Settings</h1>
      <Profile />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && <><Providers data={data} reload={reload} /><Hours data={data} reload={reload} /><Blocked data={data} reload={reload} tz={me.business.timezone} /></>}
    </>
  );
}
