# 08 — Admin: checked verdict

Claude checked OpenCode's `08_ADMIN_FINDINGS.md` against the code on 16 Nov 2026. Nothing fixed
yet. James decides. Security proper is his review; the items here are functional gaps in admin
surfaces that a forker would copy.

## What was checked

| Claim | Result |
|---|---|
| Session disconnect, thread cancel, job cancel, maintenance, configuration, users and catalog overrides have no admin check; only Simple mode and SaveDataAll check `isAdminGroups` | **Confirmed** — `server.js:2307-2327` (disconnect/cancel: no gate at all), `2418-2463` (users: `gateReadOnly` only) |
| New users default to the `ADMIN` group (`UserManagement.jsx:192`) | **Confirmed** — `useState(new Set(['ADMIN']))` |
| Server Admin kick uses `s.ID ?? s.SessionID ?? i`; sessions are keyed by `Name` (`ServerAdminPanel.jsx:310`) | **Confirmed** — SessionsMonitor uses `s.Name`; Server Admin sends an index |
| `/api/users/provision` calls `createClient` + `addClientToGroup`, not the tested `provisionUser` two-run workaround (`server.js:2418-2427`) | **Confirmed** — the test covers a method the UI never calls |

Not re-verified: 1.3 (one-click destructive actions), 2.2–2.3, 3.2–3.3, 4.3–4.5, 5.1–5.3.
Consistent with the code read.

## Ranked recommendations

1. **One admin rule.** `requireTm1Admin(req, server)` (the `isAdminGroups(ActiveUser.Groups)`
   check Simple mode already uses) on every admin mutation and sensitive read: session
   disconnect, thread cancel, job cancel, maintenance, configuration, metrics, all `/api/users/*`,
   catalog overrides. A shared `isAdmin` flag from the session info hides the buttons for
   non-admins. Route tests for non-admin 403. *Medium. Highest value in the area.*
2. **New users: no default group**, `ADMIN` an explicit choice shown in red. Test the default.
   *Small. Dangerous default.*
3. **Provision route calls `provisionUser`**; delete the duplicate `POST /api/users` create path
   or make it the same code; route-level test with the two-run fake. *Small. The UI path may
   create users with no usable password today.*
4. **One `sessionKey(s)` helper** (`Name ?? ID ?? SessionID`) used by both monitors; test against
   the v11 fixture. *Small. Kick is broken in Server Admin.*
5. **Confirm destructive actions** with one pattern: maintenance on (state the consequence),
   disconnect, cancel job, cancel thread. *Small.*
6. **Catalog overrides**: admin only, `gateReadOnly`, shape validation, and Validate runs against
   the effective rows not the base catalog (5.1); a failed overrides read is an error, not an
   empty catalog (5.2). *Small/medium. Finishes area 05's Catalog Admin work.*
7. **Small UI fixes**: password-reset pending state (4.3), case-insensitive `isSelf` (4.4), group
   load errors shown (4.5), Jobs status matching in one helper (3.3), keyed fragment (3.2),
   "This browser only" label on the Naming tab (5.3), V11 note where Status is hidden (2.3).
   *Small.*
8. **Docs**: `FEATURES.md` says who can open Admin and which actions need TM1 admin. *Small.*

## Keep as the model (agreed)

`core/save_data_all.js` and `/api/server/simple-mode`: the admin check done right, and the
precedent every other route should copy. `SessionsMonitor`'s v11 thread merge. Capability-based
hiding of Status/Jobs on servers that lack the endpoints.
