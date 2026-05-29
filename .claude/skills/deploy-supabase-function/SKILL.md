---
name: deploy-supabase-function
description: Deploy a Supabase Edge Function from supabase/functions/<name>/. Use when the user says "deploy the function", "redeploy notify-broker", "push this edge function", or after editing any file under supabase/functions/.
---

# Deploy a Konek Supabase Edge Function

## Steps

1. **Confirm which function** — ask the user if ambiguous. Function name = directory name under `supabase/functions/`.

2. **Deploy** using the Supabase CLI binary (do NOT use `npx supabase` or `supabase` from PATH — see gotchas):

   PowerShell:
   ```powershell
   & "C:\supabase\supabase.exe" functions deploy <fn-name>
   ```

   Bash:
   ```bash
   /c/supabase/supabase.exe functions deploy <fn-name>
   ```

3. **If new secrets are needed**, set them first:
   ```
   & "C:\supabase\supabase.exe" secrets set KEY=value
   ```

4. **Report logs URL** so the user can verify:
   ```
   https://supabase.com/dashboard/project/ffewjmucspcswdcxouvc/functions/<fn-name>/logs
   ```

## Critical gotchas

- **The npm package `supabase` is broken on win32-x64.** Never `npm i -g supabase` or `npx supabase`. Always use the standalone binary at `C:\supabase\supabase.exe` (installed manually from the GitHub release).
- **Project ref is hardcoded**: `ffewjmucspcswdcxouvc`. Project is already linked — don't re-run `supabase link`.
- The CLI prints a Docker warning during deploy — **safe to ignore**, deploy still works (Supabase bundles via Deno, not Docker, for deploy).
- If the deploy fails with "not logged in", run `& "C:\supabase\supabase.exe" login` and retry.
- After deploy, the function is live immediately at `https://ffewjmucspcswdcxouvc.functions.supabase.co/<fn-name>`.

## Existing functions (as of 2026-05-24)

- `notify-broker` — sends approval/rejection/new-signup emails via Gmail SMTP. Env: `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_URL`.
