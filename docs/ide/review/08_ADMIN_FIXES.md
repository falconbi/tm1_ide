# 08 — Admin: fix brief (round 1)

Build brief for OpenCode. Source: `08_ADMIN_VERDICT.md`, agreed by James 16 Nov 2026. Read
`08_ADMIN_FINDINGS.md` for line numbers. Run **after** `09_MCP_FIXES.md`.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` (every step touches
  `client/src`; commit `static/`), `cd client && npx eslint src` (129 or fewer).
- Do not push. Do not restart any server. Do not touch TM1; tests use stubbed clients.
- Questions go in `docs/ide/review/08_ADMIN_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2, 3 and 4.

## Step 1 — One admin rule

- `server.js`: `async function requireTm1Admin(req, res, server)` built on the existing
  `isAdminGroups(ActiveUser.Groups)` check used by `/api/server/simple-mode` and
  `core/save_data_all.js`. Cache the answer per IDE token + server for a few minutes.
- Apply it (after `gateReadOnly` where that already exists) to: `DELETE /api/session`,
  `POST /api/thread/cancel`, `POST /api/job/cancel`, `/api/admin/maintenance/*`,
  `/api/admin/configuration` (GET and any PUT), `/api/admin/metrics`, every `/api/users/*` and
  `/api/users` route, `GET`/`PUT /api/admin/catalog-overrides`. 403 body:
  `{ error: 'TM1 Admin group required' }`.
- Expose `isAdmin` in the per-server session info the client already reads (`/api/servers` or
  the login response — whichever carries the username). `StatusBar.jsx` and `App.jsx` hide
  Sessions / Admin / Jobs controls and the User Management icon when `isAdmin` is false; the
  monitors still open read-only for non-admins if the list routes are allowed (keep the GET
  lists ungated; gate only mutations and metrics/configuration).
- Tests: non-admin 403 on each mutation route with a stubbed `ActiveUser`; admin passes.
- `docs/ide/FEATURES.md`: one paragraph on who can open Admin and which actions need TM1 Admin.

## Step 2 — New users: no default group (bug)

`UserManagement.jsx:192`: `new Set()`; the ADMIN checkbox is listed last with a red label
"Full administrator"; the Create button shows the chosen groups in its label
("Create user (ADMIN)"). Test the default is empty.

## Step 3 — Provision route uses `provisionUser` (bug)

`server.js` `/api/users/provision` (~2418-2427) calls `cl.provisionUser(name, password, groups,
friendlyName)` (the two-run method `tests/provision-user.test.js` covers). Delete the duplicate
`POST /api/users` create route if the UI does not call it (grep); if it does, point it at the
same method. Route-level test with the fake client recording two runs.

## Step 4 — One session key (bug)

`client/src/lib/session-key.js`: `sessionKey(s) = s.Name ?? s.ID ?? s.SessionID`. Used by
`ServerAdminPanel.jsx:310` and `SessionsMonitor.jsx:136`. Test against the v11 fixture in
`tests/get-sessions-v11.test.js`.

## Step 5 — Confirm destructive actions

One `ConfirmButton` (or the existing inline-confirm pattern from the Server Admin sessions tab,
extracted) used for: maintenance on/off (text: "All non-admin sessions will be blocked"), kick
session, cancel job, cancel thread. Remove the other two ad-hoc confirm styles.

## Step 6 — Catalog Admin finish

- `/api/admin/catalog-overrides` PUT: `gateReadOnly`, admin (step 1), and shape validation
  (areas `rules`/`ti` only; `additions`/`overrides` are objects of catalog-shaped entries;
  `deletions` an array of strings; reject prototype keys). GET returns `{ overrides, version }`.
- `CatalogAdmin.jsx:225-233`: a failed load is a blocking error, Save disabled until a load
  succeeded; never substitute `{}`.
- `CatalogAdmin.jsx` Validate (~323-387): build the test list from the **effective** rows for
  the tab (additions in, deletions out, overridden params/isStatement respected); rows skipped
  show "not tested".
- Naming tab header: "This browser only". Function tabs header: "Server-wide".

## Step 7 — Small UI fixes

`UserManagement.jsx`: password button uses `resetPassword.isPending` (4.3); `isSelf`
case-insensitive (4.4); `groupsError` shown and group editing disabled until loaded (4.5).
`JobsMonitor.jsx`: one `isRunning`/`normaliseStatus` helper and case-insensitive colours (3.3).
`SessionsMonitor.jsx`: `<Fragment key={u.name}>` (3.2); `threads.isError` shown (3.1).
`ServerAdminPanel.jsx`: a one-line note where Status is hidden on V11 (2.3).

## When finished

`docs/ide/review/08_ADMIN_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, lint, anything not done and why.
