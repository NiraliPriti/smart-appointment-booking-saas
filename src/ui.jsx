import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Tiny data hook: { data, error, loading, reload }. */
export function useLoad(fn, deps) {
  const [s, set] = useState({ loading: true });
  const run = useCallback(() => {
    set((x) => ({ ...x, loading: true, error: undefined }));
    return fn().then((data) => set({ data, loading: false }), (error) => set({ error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...s, reload: run };
}

export function ErrorBox({ error }) {
  if (!error) return null;
  if (error.status === 402)
    return <div className="banner">Your subscription has lapsed. <Link to="/dashboard/billing">Open billing</Link> to restore access.</div>;
  return <div className="err" role="alert">{error.message}</div>;
}

export const Loading = () => <div className="stack" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></div>;

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export const Status = ({ s }) => <span className={`badge s-${s}`}>{s.replace('_', ' ')}</span>;
