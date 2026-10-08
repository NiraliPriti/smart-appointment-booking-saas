import { useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';
import { slugify } from '../lib/format';
import { Loading } from '../ui';

function Onboarding({ onDone }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    // Security-definer RPC creates tenant + membership atomically; the browser never sets a business_id.
    const { error } = await supabase.rpc('create_business', { p_name: name, p_slug: slug || slugify(name), p_timezone: tz });
    setBusy(false);
    if (error) return setError(error.code === '23505' ? 'That booking address is taken. Try another.' : error.message);
    onDone();
  }
  return (
    <div className="public">
      <form className="card" onSubmit={submit}>
        <h1>Set up your business</h1>
        <label htmlFor="n">Business name</label>
        <input id="n" required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} />
        <label htmlFor="s">Booking address</label>
        <input id="s" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        <p className="muted small">Clients book at {location.origin}/booking/{slug || 'your-name'}</p>
        <label htmlFor="tz">Timezone</label>
        <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {Intl.supportedValuesOf('timeZone').map((z) => <option key={z}>{z}</option>)}
        </select>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn" style={{ marginTop: '1rem' }} disabled={busy}>{busy ? 'Creating…' : 'Create business'}</button>
      </form>
    </div>
  );
}

const links = [['', 'Overview'], ['calendar', 'Calendar'], ['bookings', 'Bookings'], ['clients', 'Clients'], ['services', 'Services'], ['settings', 'Settings'], ['billing', 'Billing']];

export default function Layout() {
  const { session, me, refresh, signOut } = useAuth();
  if (session === undefined || (session && me === undefined)) return <div className="main"><Loading /></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!me?.business) return <Onboarding onDone={refresh} />;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">SlotWise</div>
        {links.map(([to, label]) => (
          <NavLink key={to} to={`/dashboard/${to}`} end={to === ''} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
        <button className="btn ghost sm" style={{ marginTop: 'auto' }} onClick={signOut}>Sign out</button>
      </nav>
      <main className="main stack">
        {me.subscription && !me.subscription.hasAccess && (
          <div className="banner">Your subscription is not active, so most features are locked. Open Billing to subscribe.</div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
