# 08 — Admin: fixes done (round 1)

Completed 16 Nov 2026. One commit per step; every commit had all tests passing, a client build,
and client lint at 129 (20 errors, 109 warnings). No push, no server restart, no TM1 calls.

| Step | Commit | Tests before → after |
|---|---|---|
| 1 — One admin rule | `ce5938e` | 474 → 478 (1 skipped) |
| 2 — New users: no default group | `3164223` | 478 → 480 (1 skipped) |
| 3 — Provision route uses `provisionUser` | `f9d6b07` | 480 → 482 (1 skipped) |
| 4 — One session key | `594e41b` | 482 → 484 (1 skipped) |
| 5 — Confirm destructive actions | `df17bfa` | 484 → 484 (1 skipped) |
| 6 — Catalog Admin finish | `f3f061c` | 484 → 489 (1 skipped) |
| 7 — Small UI fixes | `96f8c99` | 489 → 489 (1 skipped) |

Final: **489 tests, 488 pass, 1 skipped, 0 fail**; client lint **129**.

- Step 1 added `core/admin_gate.js` (cached per token + server, 2 minutes), applied it to every
  admin mutation and sensitive read, carried `isAdmin` on `/api/auth/servers`, and hid the
  Sessions / Admin / Jobs controls and User Management icon for non-admins. `AdminOnly` keeps the
  admin hook inside the `QueryClientProvider` that `App` creates.
- Step 2 starts the New User form with no groups, lists `ADMIN` last with a red "Full
  administrator" label, and shows selected groups on the Create button.
- Step 3 routes New User through `provisionUser` (two TI runs), removes the duplicate
  `POST /api/users` create route, and tests the route with a fake client.
- Step 4 adds `client/src/lib/session-key.js` (`Name` → `ID` → `SessionID`) for Server Admin and
  Sessions Monitor, tested against the v11 session shape.
- Step 5 extracts `ConfirmButton` for maintenance, kick, cancel job, cancel thread — and the
  User Management delete button — removing the old inline confirmation blocks.
- Step 6 validates catalog overrides on the server (`core/catalog_overrides.js`), gates and
  versions GET/PUT, makes a failed client load blocking with Save disabled, validates the
  effective rows (additions in, deletions out, overridden fields), and labels the tabs
  "Server-wide" / "This browser only".
- Step 7 uses `resetPassword.isPending`, case-insensitive `isSelf`, shows `groupsError` and
  disables group editing until groups load, normalises job status once, keyes session rows with
  `Fragment`, shows `threads.isError`, and notes that Status/maintenance need TM1 12.6+.
- Not done: no live TM1 verification, by the review rules. The session/job list GET routes remain
  ungated (as the brief asked); the UI hides their entry points for non-admins.
