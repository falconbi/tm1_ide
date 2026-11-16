# 06 — Understanding the model: fixes done (round 1)

All nine steps are committed. No push, no server restart, no TM1 call. The Cube Map split
(item 10 in the verdict) is not in this round.

## Commits

| Step | Commit | What changed |
|---|---|---|
| 1 | `54ee6a2` | Model-scan cache keyed by `${server}::${hashed identity}`, capped at 50; invalidation clears every user's entry; two-user test added |
| 2 | `3703647` | Cube Map model moved to `core/cubemap.js`; route is now gate/client/build/send; shared comment/arg/name helpers; global `DB`/`DBS` rule scan; control processes excluded; `]]`/two-DB tests and `tests/cubemap.test.js` added |
| 3 | `e10e523` | Find & Replace checks every HTTP response, reports failures and keeps them in the preview, refuses dirty open tabs, refreshes clean Rules/process tabs after success |
| 4 | `ea48576` | Trace panel keyed by trace context (new cell resets, same cell restores); cross-cube label compares against the current stack entry |
| 5 | `b0fcaed` | Rule Lens understands `]]` element names and `''` escaped quotes; feeder targets are included in the missing-cube check and labelled |
| 6 | `18a6876` | Runbook and search-index failures surface errors instead of "No description"/"No matches"; `/api/cube/trace` uses `fail`; search log label fixed |
| 7 | `a7a64b7` | `gateReadOnly` on both summary writes; serialised read-modify-write queue; summary file read once per index/request |
| 8 | `88ec539` | Request counter ignores stale Cube Map responses; `showProcesses` restored from prefs; Runbook selection follows the chore name/reset |
| 9 | `8e2831b` | Kept two named search scopes (quick TI-only `/api/processes/search`, cross-object Find & Replace `/api/search/index`), documented both, bulk-loaded the index in two collection requests |

## Tests and lint

- Baseline before step 1: **438 tests** (437 pass, 1 skipped); lint **129 problems** (20 errors,
  109 warnings).
- After step 1: 439; step 2–4: 442; step 5–6: 444; step 7–9: **445 tests** (444 pass, 1 skipped,
  0 failed); lint stayed **129 problems** throughout.
- `cd client && npm run build` ran for every step that touched `client/src` or `shared/`
  (steps 2, 3, 4, 5, 6, 8); rebuilt `static/` was committed where the bundle changed. Steps 1,
  7 and 9 did not touch client/shared build output.
- Added tests: cache isolation, two-DB/DBS rule scan, Cube Map edges/control processes, Rule
  Lens brackets/escaped quotes, concurrent summary writes.

## Cache audit (step 1)

- `core/cube_data_sources.js` index cache — **per user** (hashed IDE token, falling back to the
  acting user name); capped at 50 entries; `invalidate(server)` clears all users for that server.
- `core/tm1_client.js` `_resolveAxisDimensions` local Map — **not user data** (per-call subset
  lookup).
- `core/adapters/direct_v11.js` `_agentCache` — **not user data** (TLS agents).
- `core/adapter_registry.js` `_urlCache` — **not user data** (resolved server URLs).
- `core/adapter_registry.js` `_oauth2Cache` — **not user data** (machine OAuth2 tokens per
  connection).
- `core/adapter_registry.js` `_serviceState` — **not user data** (service-login session state).
- `server.js` `lensUsageCache` — already **per user + server**.

## What is not done

- **`CubeMapEditor.jsx` split** was explicitly out of this round. It remains a 2,177-line
  component.
- **Cube Map and Data Sources process loops** now share the comment/argument/name helpers, rule
  scan and function lists, but the Cube Map still keeps its own ordered step/edge loop because
  it needs positions for playback. A single index module for both remains a later refactor.
- **Search was not unified**; the brief allowed two genuinely different scopes. The quick
  Explorer search stays TI-only and Find & Replace stays Rules + TI; both routes and scopes are
  now named in `FEATURES.md` and `CLAUDE.md`.
- Trace reset, Cube Map request races and the Runbook selection were verified by reading and
  build/lint, not browser automation (Playwright is not used). The manual checks are in the
  commit messages.
