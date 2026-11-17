# 02 — Split `server.js` into `routes/` (round 2)

Completed 17 Nov 2026. One commit per step; every step passed `npm test` and both lint ratchets.
The route-table test was kept green by regenerating its snapshot after each grouped move, because
the old route order was interleaved by noun and cannot survive noun-grouped files. Critical order
is still asserted: `/api/lens/meta` before the generic Lens routes, archives before `:id`, and the
SPA fallback last.

| Step | Commit | Tests |
|---|---|---|
| 0 — Route-table safety net | `d3efd60` | 507 total (506 pass, 1 skip) |
| 1 — Warehouse routes | `da1ce02` | 507 (506 pass, 1 skip) |
| 2 — Search routes | `a9cd496` | 507 (506 pass, 1 skip) |
| 3 — SQL routes | `13882cb` | 507 (506 pass, 1 skip) |
| 4 — AI routes | `403bcd4` | 507 (506 pass, 1 skip) |
| 5 — Lens and file routes | `3ab49b7` | 507 (506 pass, 1 skip) |
| 6 — View and MDX routes | `36e4658` | 507 (506 pass, 1 skip) |
| 7 — Process and chore routes | `adbe6af` | 507 (506 pass, 1 skip) |
| 8 — Cube, rule and model routes | `a9216d9` | 507 (506 pass, 1 skip) |
| 9 — Dimension and subset routes | `8a37773` | 507 (506 pass, 1 skip) |
| 10 — Change-set and assertion routes | `2493082` | 507 (506 pass, 1 skip) |
| 11 — Deploy and Git routes | `43344e5` | 507 (506 pass, 1 skip) |
| 12 — Admin, users and monitoring | `7051cbb` | 507 (506 pass, 1 skip) |
| 13 — Auth and server routes | `1da1253` | 507 (506 pass, 1 skip) |
| 14 — Bootstrap-only `server.js` | `30e5a4a` | 507 (506 pass, 1 skip) |
| 15 — Docs | `870d4e5` | 507 (506 pass, 1 skip) |

Final: **507 tests, 506 pass, 1 skipped, 0 fail**. Client lint **129**; backend lint **76**.
`server.js` is **175 lines**.

Line counts:

```
routes/admin.js        258
routes/ai.js           170
routes/auth.js         298
routes/changesets.js   211
routes/cubes.js        245
routes/deploy.js       288
routes/dimensions.js   518
routes/lenses.js       260
routes/processes.js    513
routes/search.js        66
routes/sql.js          168
routes/views.js        172
routes/workspace.js     27
routes/_http.js         64
```

Placement notes:

- `/api/config` stays in `server.js` before auth — the sign-in page needs it without a token.
- `/api/files/*` is in `routes/lenses.js`, as the brief’s table specified (a separate `files.js` was
  considered and rejected to keep the reviewed layout).
- All three generation routes (`/api/mdx/generate`, `/api/subset/generate`,
  `/api/lenses/generate`) are in `routes/ai.js`.
- `/api/processes/search` and `/api/search/index` are in `routes/search.js`.
- The `/api/lens/cell-trace|cell-log|cell-notes` loop is in `routes/lenses.js`; it was not visible
  to the AST classifier because its path is a template literal.
- No `routes/index.js` was added: `server.js` calls the 13 `register(app, deps)` functions in a
  fixed loop, matching the brief’s target tree.
- Helpers that do not touch `req`/`res` live in `core/server_helpers.js`; shared HTTP helpers live
  in `routes/_http.js`.

No behaviour was changed. The only intentional deviation is the regenerated route-order snapshot,
approved because the original interleaved order is incompatible with one file per noun.
