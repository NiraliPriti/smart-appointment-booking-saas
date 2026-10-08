import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';

export default function AuthPage({ mode }) {
  const { session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const signup = mode === 'signup';

  if (session) return <Navigate to="/dashboard" replace />;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    if (signup && !data.session) return setNotice('Check your inbox to confirm your email, then sign in.');
    nav('/dashboard');
  }

  return (
    <div className="public">
      <form className="card" onSubmit={submit}>
        <h1>{signup ? 'Create your account' : 'Sign in'}</h1>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} />
        {error && <p className="err" role="alert">{error}</p>}
        {notice && <p className="msg">{notice}</p>}
        <div className="row between" style={{ marginTop: '1rem' }}>
          <button className="btn" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
          <Link to={signup ? '/login' : '/signup'}>{signup ? 'I already have an account' : 'Create an account'}</Link>
        </div>
      </form>
    </div>
  );
}
