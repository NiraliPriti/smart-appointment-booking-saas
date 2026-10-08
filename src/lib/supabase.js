import { createClient } from '@supabase/supabase-js';

// The anon key is safe in the browser: RLS decides what each signed-in user can touch.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
