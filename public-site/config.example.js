// Copy this file to `config.js` and fill in your Supabase project values.
// `config.js` is gitignored — never commit credentials.
//
// Same Supabase project as the broker/admin/marketing apps. The anon key is
// safe to expose to browsers — the public site can only read the
// `public_listings` view and insert `leads` rows (enforced by RLS in
// supabase/migrations/0029_marketing_public.sql).
//
// On Cloudflare Pages, generate this file from env vars in build.sh.

window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
