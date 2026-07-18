-- 0045_user_preferences.sql — per-user Settings preferences (Settings S1)
--
-- Additive: a single JSONB bag on profiles for user-controlled settings
-- (activity status now; notification/email prefs and profile visibility in
-- later phases). One column keeps new toggles migration-free and colocates the
-- prefs with the profile row that every gate already reads (loadProfileInto's
-- select('*'), notify-broker's profile fetch, broker_directory).
--
-- SECURITY / RLS: no policy change needed.
--   * Owner writes are allowed by the existing profiles_update_self policy
--     (0001: USING auth.uid() = id).
--   * The 0016 guard_profile_privileged_columns() trigger is a BLACKLIST — it
--     pins only named privileged columns (role, is_approved, subscription_*,
--     monthly_listing_quota, closed_deals_count) for non-admins and leaves every
--     other column (this one included) freely self-editable. So a broker can
--     write their own preferences but still cannot self-escalate.
--
-- Idempotent.

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- FUTURE (S3 — profile visibility): broker_directory must NEVER select the raw
-- `preferences` blob — that would expose every user's notification/email prefs to
-- all authenticated peers. When visibility lands, add ONLY a computed, single-key
-- column to the view, e.g.:
--     (preferences ->> 'profile_visibility')::boolean as profile_visible
-- and never the whole `preferences` object.
