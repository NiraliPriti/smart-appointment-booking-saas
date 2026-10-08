import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api } from '../lib/api';
import { fmt, money, todayIn } from '../lib/format';
import { ErrorBox, useLoad } from '../ui';

export default function PublicBooking() {
  const { slug } = useParams();
  const { data: biz, error: bizErr, loading } = useLoad(async () => ({
    profile: await api(`/public/businesses/${slug}`),
    ...(await api(`/public/businesses/${slug}/services`)),
  }), [slug]);

  const [service, setService] = useState(null);
  const [provider, setProvider] = useState('');
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [av, setAv] = useState({ loading: false });

  const tz = biz?.profile.timezone;
  async function loadAvail() {
    if (!service) return;
    setAv((a) => ({ ...a, loading: true, error: null }));
    try {
      const q = new URLSearchParams({ serviceId: service.id, from: todayIn(tz), days: '21', ...(provider && { providerId: provider }) });
      setAv({ loading: false, data: await api(`/public/businesses/${slug}/availability?${q}`) });
    } catch (e) { setAv({ loading: false, error: e }); }
  }
  useEffect(() => { setDate(null); setSlot(null); loadAvail(); /* eslint-disable-next-line */ }, [service, provider]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return; // prevents duplicate submits
    setBusy(true); setErr('');
    try {
      setDone(await api(`/public/businesses/${slug}/bookings`, {
        method: 'POST',
        body: { serviceId: service.id, providerId: provider || undefined, startsAt: slot.start, name: form.name, email: form.email, phone: form.phone || undefined, notes: form.notes || undefined },
      }));
    } catch (e2) {
      setErr(e2.message);
      if (e2.code === 'slot_unavailable') { setSlot(null); loadAvail(); }
    } finally { setBusy(false); }
  }

  if (loading) return <div className="public" aria-busy="true"><div className="skeleton" /></div>;
  if (bizErr) return <div className="public"><h1>Booking page not found</h1><p className="muted">Check the link you were given.</p></div>;

  const { profile, services, providers } = biz;
  if (done) return (
    <div className="public stack">
      <div className="card stack">
        <h1>You're booked</h1>
        <div><strong>{done.service.name}</strong> at {done.business.name}</div>
        <div>{fmt(done.startsAt, done.business.timezone, 'cccc d LLLL yyyy, HH:mm')} <span className="muted small">({done.business.timezone})</span></div>
        <div className="muted small">A confirmation has been sent to {form.email}.</div>
      </div>
    </div>
  );

  const days = av.data?.days ?? [];
  const chosen = days.find((d) => d.date === date);

  return (
    <div className="public stack">
      <header>
        <h1>{profile.name}</h1>
        {profile.description && <p className="muted">{profile.description}</p>}
        {profile.phone && <p className="muted small">{profile.phone}</p>}
      </header>

      <section aria-labelledby="h-svc">
        <h2 id="h-svc">1. Choose a service</h2>
        {services.length === 0 && <p className="muted">This business has not published any services yet.</p>}
        {services.map((s) => (
          <button key={s.id} className="svc" aria-pressed={service?.id === s.id} onClick={() => { setService(s); setErr(''); }}>
            <div className="row between"><strong>{s.name}</strong><span>{money(s.price_cents)}</span></div>
            <div className="muted small">{s.duration_minutes} min{s.description ? ` · ${s.description}` : ''}</div>
          </button>
        ))}
      </section>

      {service && (
        <section aria-labelledby="h-time">
          <h2 id="h-time">2. Pick a time</h2>
          <p className="muted small">Times are shown in {tz}.</p>
          {providers.length > 1 && (
            <>
              <label htmlFor="prov">With</label>
              <select id="prov" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">Anyone available</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
          <ErrorBox error={av.error} />
          {err && !slot && <p className="err" role="alert">{err}</p>}
          {av.loading && !av.data ? <div className="skeleton" style={{ marginTop: '.8rem' }} /> : (
            <>
              <div className="chips" style={{ marginTop: '.8rem' }} role="group" aria-label="Dates">
                {days.map((d) => (
                  <button key={d.date} className="chip" disabled={d.slots.length === 0} aria-pressed={date === d.date} onClick={() => { setDate(d.date); setSlot(null); }}>
                    {DateTime.fromISO(d.date).toFormat('ccc d LLL')}
                  </button>
                ))}
              </div>
              {days.length > 0 && days.every((d) => d.slots.length === 0) && <p className="muted">No times are open in the next three weeks. Please contact the business directly.</p>}
              {chosen && (
                <div className="chips" style={{ marginTop: '.8rem' }} role="group" aria-label="Times">
                  {chosen.slots.map((s) => <button key={s.start} className="chip" aria-pressed={slot?.start === s.start} onClick={() => setSlot(s)}>{s.label}</button>)}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {slot && (
        <form className="card" onSubmit={submit}>
          <h2>3. Your details</h2>
          <label htmlFor="cn">Name</label><input id="cn" required minLength={2} maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label htmlFor="ce">Email</label><input id="ce" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label htmlFor="cp">Phone (optional)</label><input id="cp" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label htmlFor="cx">Notes (optional)</label><textarea id="cx" rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn" style={{ marginTop: '1rem', width: '100%' }} disabled={busy}>
            {busy ? 'Booking…' : `Book ${service.name} at ${slot.label}`}
          </button>
        </form>
      )}
    </div>
  );
}
