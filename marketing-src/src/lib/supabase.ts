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
  console.error('ProList marketing: config.js is missing or has placeholder values.');
}

export const sb: SupabaseClient = createClient(url || 'https://invalid.supabase.co', key || 'invalid', {
  // Distinct storageKey from the broker app AND the admin app. All three portals
  // may share one origin (path-based: /admin/, /marketing/), so the default key
  // would let them overwrite each other's session in localStorage. Isolating the
  // keys keeps the three logins independent.
  auth: { storageKey: 'prolist-marketing-auth', persistSession: true, autoRefreshToken: true },
});
