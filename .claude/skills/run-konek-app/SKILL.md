---
name: run-konek-app
description: Launch the Konek.PH broker frontend (Draft 28.html) and the admin React app locally. Use when the user says "run my web app", "run the app", "run the admin", "start the dev server", or any variant of launching Konek locally.
---

# Run Konek.PH locally

Two things to launch: the static broker frontend (open in browser) and the admin Vite dev server.

## Steps

1. **Verify admin config exists** — if `admin-src/public/config.js` is missing, the admin app shows "configuration missing". Check with Glob and stop to ask the user for keys if absent.

2. **Start the admin dev server in the background** using PowerShell:
   ```
   npm --prefix admin-src run dev -- --port 3030 --host 127.0.0.1
   ```
   Pass `run_in_background: true` to the Bash/PowerShell tool. Then tell the user the URL: `http://127.0.0.1:3030/admin/`.

3. **Open the broker frontend** in the default browser:
   ```powershell
   start "Draft 28.html"
   ```

4. Report back: broker file opened + admin URL + admin login (`konekph2026@gmail.com`).

## Critical gotchas

- **Do NOT use Vite's default port 5173 or 5180** — both are in the Windows Hyper-V reserved range and fail with EACCES. Always pass `--port 3030 --host 127.0.0.1`.
- **Never `cd` into `admin-src`** — use `npm --prefix admin-src` so the working directory stays at repo root.
- Broker frontend is a static file — no build, no server needed. Just open it.
- If the user reports the admin page is blank, check browser console for a missing `config.js` 404 first.
