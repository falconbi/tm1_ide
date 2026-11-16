# 10 — Lenses: fixes done (round 1)

Completed 16 Nov 2026. One commit per step; every commit had all tests passing and client lint at
129 (20 errors, 109 warnings). No push, no server restart, no TM1 calls.

| Step | Commit | Tests before → after |
|---|---|---|
| 1 — One publish gate | `f064483` | 489 → 491 (1 skipped) |
| 2 — Name the Lens on every bridge call | `1db7da5` | 491 → 492 (1 skipped) |
| 3 — Follow the saved Lens name | `d9833f1` | 492 → 495 (1 skipped) |
| 4 — Lists survive one bad document | `8335ffd` | 495 → 497 (1 skipped) |
| 5 — Require a real Lens app config | `56d9be6` | 497 → 499 (1 skipped) |
| 6 — Keep the Lens status on save | `e17f440` | 499 → 501 (1 skipped) |
| 7 — Read bracketed names in `Lens.rows` | `ba6543f` | 501 → 502 (1 skipped) |
| 8 — Check the theme file | `a262f73` | 502 → 505 (1 skipped) |
| 9 — Document the worked example | `eac4846` | 505 → 505 (1 skipped) |

Final: **505 tests, 504 pass, 1 skipped, 0 fail**; client lint **129**; client and lens-kit builds
succeed.

- Step 1 put publish + group access into `visibleTo` and used it on every list, page, frame and API
  route; direct draft/restricted opens now 404.
- Step 2 sends the opened Lens on every bridge call and checks visibility (60-second per
  session+Lens cache) on every read route. The IDE's unsaved preview is documented as outside this
  gate.
- Step 3 added `client/src/lib/lens-save-state.js`; a first save or rename moves both the saved
  name and the tab label.
- Step 4 returns readable Lenses with an `errors` array for unreadable documents, wraps
  `/api/lenses` in JSON 500 handling, shows the warning on the home page, and gives the editor a
  Retry state instead of an empty list.
- Step 5 makes a missing `lens-app.json` fail with the create-file message; the example is used
  only with `--demo` / `LENS_DEMO=1`, and logs that it is demo data.
- Step 6: `Save` keeps status, `Publish` publishes, `Unpublish` asks first via `ConfirmButton`;
  new Lenses still start as drafts. The IDE route and MCP `save_lens` pass `publish` through
  instead of coercing it.
- Step 7 imports `dimOf` from `shared/pivot/cellset.js`; a dimension named with `]` keeps its name.
- Step 8 validates every theme's label and the light/dark keys `themeCss` reads, at startup and in
  the test.
- Step 9 documents the Workforce worked example, `save.js`, and the toolkit bundle contents/size.

Not done: no live TM1 verification, by the review rules. The Workforce page *content* is still
not part of this round (the status table records it separately).
