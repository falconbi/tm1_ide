# 06 — Understanding the model: checked verdict

Claude checked OpenCode's `06_MODEL_FINDINGS.md` against the code on 16 Nov 2026. Nothing fixed
yet. James decides.

## What was checked

| Claim | Result |
|---|---|
| Data Sources cache keyed by server only (`core/cube_data_sources.js:15`, `304-307`), served across users | **Confirmed** — `cache = new Map() // server -> { at, index }`; the route makes a per-user client but the index is shared. In a multi-user install this leaks object names and code evidence across TM1 security boundaries. |
| Cube Map scanner duplicated in `server.js:3506-3564` and `core/cube_data_sources.js:17-70`, already divergent | **Confirmed** — both still present after area 02 round 1; the `DB` regexes differ (`DB(` vs `DB[S]?`), control-process filtering differs. Area 02 item 6 ("move the Cube Map model to `core/`") is the fix. |
| `scanRules` records only the first `DB()` per line (`cube_data_sources.js:116-127`) | **Confirmed** — non-global regex with `line.match()` |
| Find & Replace reports success when saves fail (`FindReplace.jsx:169-199`) | **Confirmed** — `Promise.all` over raw `fetch` calls, no `r.ok`, success toast on resolve |
| Rule Lens misreads `]]` and `''` in names (`core/rule_lens.js:8-56`) | **Confirmed** — simple `'` toggle, no doubled-quote handling; `]]`-aware parser exists elsewhere (`shared/pivot/cellset.js`, after area 04) |
| Trace panel keeps the previous cell's stack (`ViewEditor.jsx:1110-1116`, render `:2786-2794`) | **Confirmed** — `useState(() => initialStack …)` only; no `key`, no effect on `ctx` |
| Runbook swallows summary-load errors (`RunbookDialog.jsx:95-104`) | **Confirmed** — status unchecked, `.catch(() => {})` |

Not re-verified: 1.3 (slow load overwrites newer), 1.4 (`showProcesses` not restored),
3.3 (summary writes ungated — consistent with the `CLAUDE.md` rule written in area 02),
3.4–3.7, 4.2–4.3, 5.2–5.6. All consistent with the code shape seen.

## Ranked recommendations

1. **Cache keyed by identity.** `cube_data_sources.js` cache key becomes `server + user` (the
   resolved TM1 user from the session, not the token), with a small entry cap; `invalidate`
   clears per server across users. Same check for any other server-side cache
   (`process_summaries`, Cube Map). Test: two users, one scan each, no cross-read. *Small.
   Security.*
2. **One scanner.** Move the Cube Map model out of `server.js` (3506-3760) into
   `core/cubemap.js` built on `cube_data_sources.js`'s helpers, delete the duplicates, make the
   `DB` regex global (fixes 3.1 at the same time) and settle the control-process rule in one
   place. This is area 02 item 6, first block; do it here. *Medium.*
3. **Find & Replace checks every save.** Use `r.ok` + `d.error` per object; report "Replaced in
   N, failed in M: …" and leave the failed objects in the preview. Then hook it into the
   change-set / dirty-tab flow (5.5): refuse to replace into an object that is open dirty.
   *Small, then medium.*
4. **Trace panel resets on a new cell.** Give `<TraceSidePanel>` a `key` from `traceCtx`
   (simplest), or an effect on `ctx`. Fix 4.2 (cross-cube label compares against the original
   cube) in the same commit. *Small.*
5. **Rule Lens parser.** Reuse the `]]`-aware element parser and a doubled-quote-aware string
   scanner; add the two examples from the findings as tests. *Medium.*
6. **Error surfaces.** Runbook (2.1), search index (5.2), `/api/cube/trace` (4.3): check
   `r.ok`, use `fail(res, e)` server-side, show the error. *Small.*
7. **Local-file gate.** `POST`/`PUT /api/process/summary` call `gateReadOnly` per the
   `CLAUDE.md` rule (3.3); serialise summary writes (3.7). *Small.*
8. **Cube Map state and races.** Last-write-wins guard on the model load (1.3); restore
   `showProcesses` (1.4); reset the chore index when the list changes (2.2). *Small.*
9. **Search: one surface, one route, documented scope** (5.3), and an index that fetches in
   bulk rather than per object (5.4). *Medium; after 2.*
10. **`CubeMapEditor.jsx` split** (1.5) goes with the editors split brief, not here.

## Keep as the model (agreed)

`core/cube_data_sources.js`'s evidence model (cube → processes → the exact lines), the
process-summary cache and hash, Rule Lens as a reading aid with its limits stated in the UI,
the trace's cross-cube drill, and the tests that exist for `cube_data_sources` and `rule_lens`.
