import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;

/** Service-role client: bypasses RLS. Server only. Use for public endpoints, jobs and webhooks. */
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Per-request client that acts AS the signed-in user, so Postgres RLS applies to every query. */
export const userClient = (token) =>
  createClient(url, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
