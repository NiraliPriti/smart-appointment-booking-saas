import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { api } from './lib/api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [me, setMe] = useState(undefined);           // undefined = loading, null = none

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!session) { setMe(session === undefined ? undefined : null); return; }
    try { setMe(await api('/me')); } catch { setMe(null); }
  }, [session]);
  useEffect(() => { refresh(); }, [refresh]);

  return <Ctx.Provider value={{ session, me, refresh, signOut: () => supabase.auth.signOut() }}>{children}</Ctx.Provider>;
}
