import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
  }
}

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

if (!url || !key || url.includes('YOUR-PROJECT')) {
  console.error('Konek admin: config.js is missing or has placeholder values.');
}

export const sb: SupabaseClient = createClient(url || 'https://invalid.supabase.co', key || 'invalid', {
  // Distinct storageKey from the broker app. Both portals share one origin
  // (konekph.pages.dev + /admin/), so the default key would make them overwrite
  // each other's session in localStorage — logging into admin would hijack the
  // broker tab (and vice versa). Isolating the keys keeps the logins independent.
  auth: { storageKey: 'konek-admin-auth', persistSession: true, autoRefreshToken: true },
});
