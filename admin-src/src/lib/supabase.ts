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

export const sb: SupabaseClient = createClient(url || 'https://invalid.supabase.co', key || 'invalid');
