# 02 — `server.js` and `core/`: fixes done

Completed 16 Nov 2026. No push, no server restart, no TM1 writes. Client was not rebuilt
because no file under `client/src` changed.

| step | commit | result | tests | lint |
|---|---|---|---|---|
| 1 — One error shape | `da56ba2` | `core/tm1-error.js`; all three adapters normalise; `fail(res,e)` in `server.js`; 200-on-failure fixed for process/log, servers, forge; process/run wrapped + name validated; CLAUDE.md rule; new test | 374 (373 pass, 1 skip), from 370 | 133 (24 errors, 109 warnings) |
| 2 — Delete dead code | `ef31158` | 23 routes, 7 TM1Client methods, unused `execFileSync`; kept `/api/lens/history` and `/api/lens/whoami`; Notes/annotations docs removed | 374 (373 pass, 1 skip) | 133 (24 errors, 109 warnings) |
| 3 — OData keys (bug) | `34a46d5` | `encodeURIComponent` → `odataKey` in git-release, temporary deletes, IDs and MCP tools; `tests/odata-key-usage.test.js`; `TM1Client.downloadFile` + adapter `binary`; files/content no longer PAW-only; download test | 376 (375 pass, 1 skip) | 133 (24 errors, 109 warnings) |
| 4 — Gates and debug noise | `27b0907` | `gateWrite` on sql/post-to-ti, period-builder/run, admin/validate-ti-functions; listed console.logs removed; CLAUDE.md gate rule | 376 (375 pass, 1 skip) | 133 (24 errors, 109 warnings) |
| 5 — Hidden side effect (bug) | `317c3f7` | Only caller of `executeViewWithSuppression` was the unreachable `/api/view/execute-suppressed`; Step 2 removed both, so no PATCH remains. Recorded in BUG_FIXES.md; no code change in this step | 376 (375 pass, 1 skip) | 133 (24 errors, 109 warnings) |

## Notes / not done

- `GET /api/process/log` was fixed in Step 1 and then deleted in Step 2, as the brief ordered.
- `core/git-review.js` is now unreferenced (its only route was `/api/deploy/git/review`, deleted
  in Step 2). It was not named by the brief, so it was left in place; decide whether to delete it
  or keep it for a future review UI.
- The `GitPlans('…')/tm1.Execute` IDs in `server.js` still use `encodeURIComponent`; they are
  GUIDs, not TM1 names, and were not in the Step 3 list.
- The new `odata-key-usage` test exempts `server.js:2084` (PAW Assets path) with the required
  comment, and `core/tm1_client.js`'s TI statement strings no longer false-positive because the
  regex requires a non-identifier boundary before the key collection.
- Lint stayed at the agreed baseline: 133 problems (24 errors, 109 warnings), no increase.
- `docs/ide/review/` is untracked; none of these commits include the review documents.
