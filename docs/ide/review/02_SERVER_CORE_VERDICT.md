# 02 — `server.js` and `core/`: checked verdict

Claude checked OpenCode's `02_SERVER_CORE_FINDINGS.md` against the code on 16 Nov 2026. Nothing
is fixed yet. James decides what gets done and in what order.

## What was checked

| Claim | Result |
|---|---|
| Direct adapter throws a generic `Request failed with status code N` (`direct_v11.js:84`) | **Confirmed** |
| `/api/process/log`, `/api/servers`, `/api/forge` return 200 on failure (`server.js:1003`, `499`, `2757`) | **Confirmed** |
| Three TM1-writing routes use only `gateReadOnly` (`2738`, `2833`, `3637`) | **Confirmed** (41 `gateReadOnly`, 32 `gateWrite`, 2 `requireSession` in all) |
| 25 routes unreachable | **23.** `/api/lens/history` and `/api/lens/whoami` are called from `shared/lens-bridge.js:175,178` (OpenCode did not grep `shared/`). `DELETE /api/process/summary` is dead (the dialog uses POST and PUT). The other 22 have no caller in `client/src`, `shared/`, `lenses/`, `tools/`, `lens-server.js`. |
| `extractMembersFromExpression` in `server.js:1850` duplicates `TM1Client._extractMembersFromExpression` (`tm1_client.js:1262`) | **Confirmed, identical** |
| `stripComments` three times | **Two plus a variant**: `server.js:3822`, `core/cube_data_sources.js:17`, and `stripCommentsKeep` in `core/rule_lens.js:8` (different rule) |
| `core/git-release.js:288-320` uses `encodeURIComponent` for TM1 names, so a name with `'` breaks | **Confirmed** — a real bug, same class `odata-key.js` exists to prevent |
| `setDefaultView` uses its own quote escaping | **Confirmed but harmless**: it builds TI code (`CubeSetDefaultView('…')`) where `''` is the right escaping, not an OData key. Not a defect; could use a shared TI-quote helper for clarity. |
| `docs/auth/ADAPTER_INTERFACE.md:34-51` documents `authenticate/request/isAuthenticated`; adapters implement `get/post/patch/delete/put` | **Confirmed** |
| `core/` naming: 20 snake, 26 kebab, 6 single-word | Counts not re-verified; the mix is confirmed by listing |
| On-disk state table (4.3) | Spot-checked against `.gitignore` and listings; consistent with the front-door findings |

Not re-verified line by line: the full route table (Appendix A), the 21 untested-file list, the
`lens-server.js` duplication list. They are consistent with everything that was checked.

## Ranked recommendations

Order is by value to a forker divided by effort. Items 1–5 are the ones a copier would carry into
their own IDE without knowing.

1. **One error shape.** Normalise TM1 errors at the adapter / `TM1Client` boundary (real TM1
   message, status kept). One `fail(res, e)` helper in `server.js`. The three 200-on-failure
   routes return an error. Command-result routes (`period-builder/run`, `deploy/git/*`) stay as
   they are but are named as the documented exception. *Small to normalise, medium for the ~30
   routes.*
2. **Delete the dead code.** 23 routes (list in findings 1.2, minus `lens/history` and
   `lens/whoami`), `probeAttributeValueWrite` / `probeAttributeWrite` in `TM1Client`, the unused
   `execFileSync` import in `git-review.js`. Re-grep after. *Small.*
3. **OData keys through `odataKey` everywhere.** Fix `git-release.js` (real bug), `server.js:3658,
   3662`, the id paths in `tm1_client.js`. Add a grep check to CI so it stays fixed. Also route
   `/api/files/content` through `TM1Client` instead of its own PAW URL (`server.js:2449`), which is
   the one break of the "all TM1 calls through `TM1Client`" rule and means direct-v11 installs
   can't read files. *Small; small/medium for files.*
4. **Write gates and debug noise.** The three TM1-writing routes use `gateWrite`. One written
   sentence in `CLAUDE.md` on which gate a local-file write uses. Remove the `console.log` of cell
   writes, MDX and view internals (`server.js:2958`, `2963`, `1865`, `1399`, `1360`, `1120-1147`).
   *Small.*
5. **Hidden side effect.** `executeViewWithSuppression` (`tm1_client.js:1433`) PATCHes the saved
   view before reading it. Either rename so the write is obvious or read without writing. *Small.*
6. **Move logic out of `server.js` into `core/`**, worst first: Cube Map model (`3812-4076`),
   process run/debug (`779-969`, `1064-1151`), PAW books (`2022-2137`), view axes (`1858-1934`),
   SQL→TI (`2833-2901`), summaries prompt (`3676-3777`). Remove the three duplicated helpers at
   the same time. *Medium each; do one per commit.*
7. **Route layout — decided 16 Nov (James asked for best practice).** `server.js` becomes
   bootstrap only (config, middleware, mount, listen; ~150 lines). `routes/<noun>.js`, one file
   per noun (~25 files), each exporting `register(app, deps)`. Handlers are thin: read the
   request, call one `core/` function, send the result; thirty lines is the ceiling. `core/` never
   sees `req`/`res` or status codes. Gates become middleware on the route signature
   (`app.post(path, requireWrite, handler)`). One `fail(res, e)` error path. This is the same shape
   `tools/tm1mcp/tools/*.js` already uses. `CLAUDE.md`'s "all routes in `server.js`" rule changes
   to this. *Large, mechanical, after item 6; its own fix brief.*
8. **Rename `core/` to kebab-case** (20 files, list in findings 4.2) and fix `CLAUDE.md`'s adapter
   names in the same commit. *Medium, mechanical.*
9. **Adapter contract.** Rewrite `ADAPTER_INTERFACE.md` to the real five verbs plus
   `closeSession`; add a contract test that all three adapters expose them and encode spaces.
   *Small.*
10. **Tests for the five riskiest untested pieces:** `paw_connect` session/credentials,
    `git-readiness`, `git-secrets`, `TM1Client` cell writes, `direct_v11` request/settle/auth.
    *Small/medium.*
11. **`TM1Client` tidy:** the three `getElements*` reads, the three view entry points, the five
    `scan*Usage` methods each re-fetching every process. Design question, not a quick fix; park
    until the editors review (area 03) says what the client actually needs. *Medium.*

## Keep as the model (from the findings, agreed)

One TM1 client; shared `core/` used by all three programs; `%20` OData params done centrally
through `odata-params.js`; `odataKey` used 113 times; `login-rate-limit.js` shared rather than
copied; the safety test suite; `lens-server.js` calling `core/` directly rather than the IDE's
routes.
