---
name: ship-konek-change
description: Make a change to index.html, the admin app, or Supabase RLS/functions AND verify it actually works in a real browser before declaring done. Use whenever the user asks for a frontend bug fix, routing change, auth-flow fix, RLS update, or any change whose correctness depends on browser-rendered behavior (not just "the Edit returned ok"). Triggers: "fix the signup flow", "make sure pending-approval routes correctly", "the reapply overlay isn't showing", "the email isn't sending", "deploy and test notify-broker".
---

# Ship a Konek.PH change (generate + verify)

A Konek change is not "done" when the Edit tool returns ok. The minified `index.html` blob, the §7.3 injector wrapping order, Supabase RLS on `anon` vs `authenticated`, and browser caches all silently swallow changes. You must verify in a real browser before reporting back.

## Examples of when to use this

- *"The pending-approval page isn't showing for new signups — fix it."*
- *"When I click create account it logs me in as the wrong user."*
- *"Reject button in admin throws a 403 — fix the RLS."*
- *"Deploy notify-broker and confirm the email actually goes out."*
- *"The reapply overlay isn't appearing on second login."*

## Procedure

### Phase 1 — Generate the change

1. Use string-anchor Grep to locate the relevant code (never Read line 174 or 182 whole).
2. Edit with unique surrounding context.
3. If touching Supabase: deploy via `& "C:\supabase\supabase.exe" functions deploy <fn>` or apply the migration.

### Phase 2 — Verify (MANDATORY — do not skip)

Pick the verification strategy that matches the change:

**Frontend changes to `index.html`:**
1. Confirm the change is actually in the file: Grep for a unique string from the new code and confirm it appears.
2. Launch the app via the `run-konek-app` skill (admin on port 3030, broker HTML in browser).
3. **If a Playwright MCP is configured:** drive a real browser session reproducing the user's flow — sign up / log in / click the button that was broken. Capture `console` and `pageerror` events. Assert the right page is `.active` (e.g. `document.querySelector('#app-shell .page.active')?.id === 'page-pending-approval'`).
4. **If no browser MCP:** explicitly tell the user "I cannot drive a browser from here. The change is in the file at `index.html`. Please hard-refresh (Ctrl+Shift+R) and confirm <specific assertion>." Do NOT claim the fix works.

**Supabase RLS / schema changes:**
1. Run a probe query as the target role to confirm the policy permits/denies what's intended. Use the Supabase SQL editor URL or — if a Supabase MCP is configured — run `select` directly with the role JWT.
2. For RLS: test BOTH the positive case (target role can do the thing) and the negative case (other roles cannot).
3. Probe URL: `https://supabase.com/dashboard/project/ffewjmucspcswdcxouvc/sql/new`

**Edge Function changes:**
1. After deploy, `curl` the function endpoint to confirm it responds (not a 5xx from a syntax error in the bundle):
   ```bash
   curl -i -X POST https://ffewjmucspcswdcxouvc.functions.supabase.co/<fn> \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"action":"<test-action>"}'
   ```
2. Open the logs URL and confirm the latest invocation logged what you expected — not a stack trace:
   `https://supabase.com/dashboard/project/ffewjmucspcswdcxouvc/functions/<fn>/logs`
3. If the function sends email: tell the user to check `konekph2026@gmail.com` AND check the function logs for "Message sent" vs an SMTP error.

### Phase 3 — Report

Use this exact format:

```
Change: <one line>
Verified by: <browser flow / curl probe / SQL probe / "user must verify in browser">
Result: <what you observed, or what the user needs to check>
```

If verification was not possible from here, say so explicitly. Do not say "done" or "fixed".

## Critical gotchas to check for

- **Minified-blob anchor mismatches:** Edit succeeds on a substring that doesn't exist in line 182's runtime code path (you matched a fallback constant, not the live `window.*` reassignment). Always Grep for the new string after editing to confirm.
- **§7.3 wrapping order:** `window.doLogin` is wrapped by the `k-net-new-ui-js` block. Re-wrapping or re-reading `__currentUser` synchronously after `doLogin` can race the routing. Test with both fresh-signup and existing-user-login paths.
- **`anon` vs `authenticated` RLS:** A policy that works in the SQL editor (running as `service_role`) will 403 from the browser (`anon` or `authenticated`). Probe as the actual role.
- **Browser cache:** Always tell the user to hard-refresh (Ctrl+Shift+R) — the §7.3 injected script blocks are cached aggressively.
- **`window.__currentUser` DevTools override:** If you (or the user) overrode it in DevTools earlier in the session, a "fix" can look like it works when it's actually the override talking. Open a fresh incognito window to truly verify.
