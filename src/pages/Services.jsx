import { useState } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { ErrorBox, Loading, useLoad } from '../ui';

const empty = { name: '', description: '', duration: 30, price: 0 };

export default function Services() {
  const { data, error, loading, reload } = useLoad(() => api('/services'), []);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    const body = { name: form.name, description: form.description, durationMinutes: Number(form.duration), priceCents: Math.round(Number(form.price) * 100) };
    try {
      await api(editing ? `/services/${editing}` : '/services', { method: editing ? 'PATCH' : 'POST', body });
      setForm(empty); setEditing(null); reload();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  const toggle = (s) => api(`/services/${s.id}`, { method: 'PATCH', body: { active: !s.active } }).then(reload).catch((e) => setErr(e.message));
  const edit = (s) => { setEditing(s.id); setForm({ name: s.name, description: s.description ?? '', duration: s.duration_minutes, price: s.price_cents / 100 }); };

  return (
    <>
      <h1>Services</h1>
      <ErrorBox error={error} />
      <form className="card" onSubmit={submit}>
        <h2>{editing ? 'Edit service' : 'Add a service'}</h2>
        <div className="grid">
          <div><label htmlFor="sn">Name</label><input id="sn" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label htmlFor="sd">Duration (minutes)</label><input id="sd" type="number" min={5} max={480} step={5} required value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></div>
          <div><label htmlFor="sp">Price</label><input id="sp" type="number" min={0} step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        </div>
        <label htmlFor="sx">Description (optional)</label>
        <input id="sx" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row" style={{ marginTop: '.8rem' }}>
          <button className="btn" disabled={busy}>{editing ? 'Save changes' : 'Add service'}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
        </div>
      </form>
      {loading && !data ? <Loading /> : data?.length === 0 ? <div className="card muted">Add your first service so clients can book it.</div> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Service</th><th>Duration</th><th>Price</th><th>Visible</th><th /></tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}<div className="muted small">{s.description}</div></td><td>{s.duration_minutes} min</td><td>{money(s.price_cents)}</td>
                  <td>{s.active ? 'Yes' : 'Hidden'}</td>
                  <td className="row"><button className="btn ghost sm" onClick={() => edit(s)}>Edit</button><button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Hide' : 'Show'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
