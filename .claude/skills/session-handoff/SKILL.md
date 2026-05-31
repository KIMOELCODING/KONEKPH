---
name: session-handoff
description: Generate an end-of-session handoff summary so the next Konek.PH session can pick up cleanly. Use when the user says "let's continue tomorrow", "wrap up", "quick recap", "session summary", or at any natural end-of-day stopping point.
---

# Konek.PH session handoff

Generate a markdown summary the user (or future-Claude) can paste at the start of the next session.

## Steps

1. **Gather state** in parallel:
   - `git status` — uncommitted files
   - `git diff --stat` — what changed this session
   - `git log --oneline -5` — recent commits
   - Read `BACKEND_PLAN.md` Status markers if relevant work touched the backend

2. **Read the current conversation** for: what was completed, what's blocked or awaiting test, what was deferred.

3. **Write the summary** in this exact structure:

   ```markdown
   # Konek.PH Session Summary — YYYY-MM-DD

   ## ✅ Completed this session
   <bullet list. Include file paths in backticks. Group by phase/feature.>

   ## ⏳ Awaiting test / verification
   <what the user needs to manually verify, with URLs:
    - Function logs: https://supabase.com/dashboard/project/ffewjmucspcswdcxouvc/functions/<fn>/logs
    - Admin: http://127.0.0.1:3030/admin/
    - Broker: open index.html>

   ## 📋 Next up — Phase X
   <next concrete tasks from BACKEND_PLAN.md §12 build order or user's stated plan>

   ## 🧹 Carry-over TODOs
   <anything deferred, in priority order>

   ## 🔑 Key constraints to remember
   - index.html: never Read line 174 (4.8MB base64) or 182 (505KB JS) whole — use Grep anchors + Edit
   - Never edit Draft 19.html (archive)
   - No build step for broker frontend — stays static HTML
   - Supabase deploy: `& "C:\supabase\supabase.exe" functions deploy <fn>` (full path required)
   - Admin dev server: port 3030, NOT 5173/5180 (Windows Hyper-V blocks them)
   - "Today" inside the broker app is hardcoded to 2026-05-06
   ```

4. **Print the summary** as the final message. Don't save it to a file unless the user asks — they typically paste it into the next session's first prompt.

## Notes

- Keep the "Completed" section concrete: file paths, function names, what now works.
- The "Key constraints" section is mostly static — these are always-true gotchas. Always include them, even if redundant for the current session, because the next session starts cold.
- If `git status` shows uncommitted work, flag it explicitly so the next session knows to commit or stash.
