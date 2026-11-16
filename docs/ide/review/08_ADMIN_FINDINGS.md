# 08 — Admin: monitoring, server admin, users, catalog admin

Read-only review. No code changes, no server restart, no TM1 calls.

Scope: `JobsMonitor`, `SessionsMonitor`, `ServerAdminPanel`, `UserManagement`, `CatalogAdmin`,
the admin/monitoring/user routes in `server.js`, and the related hooks. Security is reviewed
separately, but these are admin surfaces, so missing admin checks and dangerous defaults are
included as functional/consistency findings.

## Summary

The Admin area has the right pieces, but it does not yet have one authorization rule. Some
routes explicitly check TM1 admin groups (Simple mode, SaveDataAll), while user management,
session/thread/job control, maintenance mode and catalog overrides rely on whatever TM1 happens
to enforce — and the UI shows every Admin control to every signed-in user. The most dangerous
default is User Management creating each new user in `ADMIN`, and the Server Admin session list
disconnects using a property that TM1 sessions do not have.

This review did not test a live TM1 server. The findings below are from code and the existing
stubbed tests.

---

## 1. Authorization and exposure of admin actions

### 1.1 Admin controls are visible to every user; most mutation routes never check for an admin

**What:** The StatusBar always shows Sessions, Admin and Jobs, and the top bar always shows the
User Management icon. Their routes are not admin-gated: `/api/session` (disconnect),
`/api/thread/cancel`, `/api/job/cancel`, `/api/admin/maintenance/*`,
`/api/admin/configuration`, all `/api/users/*` and `/api/admin/catalog-overrides` accept any
caller with an IDE token. Only `/api/server/simple-mode` and SaveDataAll check
`isAdminGroups(ActiveUser.Groups)`.

**Where:** `client/src/components/StatusBar.jsx:89-132`; `client/src/App.jsx:317-325`;
`server.js:2133-2149` (jobs), `2296-2327` (sessions/threads), `2330-2412`
(metrics/configuration/maintenance), `2414-2518` (users/groups), `3145-3156` (catalog
overrides); the admin check precedent is `server.js:2368-2382` and
`core/save_data_all.js:5-20`.

**Why it matters to a forker:** The UI and API disagree about who is an admin. A non-admin sees
Kick/Disconnect, Cancel job, user creation/password reset, maintenance mode and the catalog
editor; whether they succeed depends on undocumented TM1 permissions. A forker cannot tell which
gate to copy, and the visible controls promise powers the server may or may not grant.

**Suggested fix:** Define one `requireTm1Admin(req, server)` helper and use it on every admin
mutation and sensitive read (metrics/configuration, sessions, user lists, catalog overrides,
maintenance, job/session/thread cancel). Hide the corresponding buttons when the current user is
not an admin, using a shared admin flag from `/api/servers`/session info. Add route tests for
non-admin 403.

**Effort:** Medium.

### 1.2 Catalog overrides can be changed by anyone and are not validated

**What:** `GET/PUT /api/admin/catalog-overrides` has no admin check, no `gateReadOnly`/`gateWrite`,
and no schema validation. The PUT writes whatever JSON the client sends to
`config/function-catalog-overrides.json`, which drives autocomplete, hover, validation and the
`naming` override path after reload.

**Where:** `server.js:3145-3156`; `client/src/components/CatalogAdmin.jsx:225-233, 305-320`;
`client/src/lib/catalog-runtime.js`.

**Why it matters to a forker:** Any user can corrupt the function catalog for everyone, and a
malformed override can break completion/validation until the file is fixed by hand. The route is
also the only admin-local-file write that does not follow the `gateReadOnly` house rule.

**Suggested fix:** Require admin for both methods, gate the write like other local-file writes,
and validate the override shape (known areas, object maps, arrays, no prototype keys) before
writing. Return the written file/version so the UI can confirm.

**Effort:** Small to medium.

### 1.3 Destructive admin actions are one click

**What:** Enabling maintenance mode, cancelling a job, disconnecting a session and cancelling a
thread all act immediately. Only the Server Admin sessions tab has an inline confirm.

**Where:** `client/src/components/ServerAdminPanel.jsx:146-159, 245`;
`client/src/components/JobsMonitor.jsx:28-36`; `client/src/components/SessionsMonitor.jsx:55-70,
133-143, 171-183`.

**Why it matters to a forker:** Maintenance mode can block all non-admin access; disconnect can
log out another person mid-work. The other destructive buttons are small and easy to hit. This is
the kind of action a reference UI should confirm or state the consequence of.

**Suggested fix:** Confirm maintenance mode (especially enabling) with the consequence text;
confirm Job cancel / session disconnect / thread cancel, or make the action reversible and
undoable. Use one confirm pattern rather than three.

**Effort:** Small.

---

## 2. Server Admin

### 2.1 The Sessions tab disconnects with an id TM1 sessions do not have

**What:** `ServerAdminPanel` uses `s.ID ?? s.SessionID ?? index` as the disconnect id. TM1
sessions returned by `getSessions()` use `Name` (the existing v11 test fixture is
`{ Name: 'session-1', ... }`), and `SessionsMonitor` correctly disconnects with `s.Name`. On a
normal v11 session the Server Admin button therefore sends a numeric index or `undefined` to
`DELETE /api/session`, not the session name.

**Where:** `client/src/components/ServerAdminPanel.jsx:310-311`; `core/tm1_client.js:1749-1775`;
`tests/get-sessions-v11.test.js`; `client/src/components/SessionsMonitor.jsx:136`.

**Why it matters to a forker:** "Kick" in Server Admin either fails or disconnects the wrong
session while the Sessions monitor works. This is a clear copy-paste/model mismatch in an admin
action.

**Suggested fix:** Use `s.Name ?? s.ID ?? s.SessionID` consistently, centralise `sessionKey(s)`,
and test the Server Admin row id against the v11 fixture.

**Effort:** Small.

### 2.2 Maintenance mode has no confirmation and no server-side admin check

**What:** The Status tab toggles maintenance with one button. The route only checks
`gateReadOnly`; it does not verify the caller is a TM1 admin. The UI copy says "Only admins can
connect" but does not confirm the state change.

**Where:** `client/src/components/ServerAdminPanel.jsx:133-159, 239-253`;
`server.js:2400-2411`.

**Why it matters to a forker:** A single click can block every non-admin user, and the API allows
a direct caller to do it without the documented admin gate. It is the highest-impact admin action
in the panel.

**Suggested fix:** Require the same admin check as Simple mode, confirm with the exact consequence
("all non-admin sessions will be blocked"), and show the resulting state only after the server
confirms it.

**Effort:** Small.

### 2.3 The Status tab is V12-only, but the error/availability story is incomplete

**What:** `ServerAdminPanel` hides Status when `caps.metrics` is false, which is documented as a
V12 feature. The maintenance route on older servers returns a 404 message, but the panel only
exposes it through the Status tab. The panel's status metrics fields also probe several alternate
names (`MemoryUsed`/`ServerRAMUsed`, etc.) without documenting which version uses which.

**Where:** `client/src/components/ServerAdminPanel.jsx:123-137, 230-283`;
`server.js:2393-2411`.

**Why it matters to a forker:** A V11 user sees no explanation for the missing Status tab, and a
V12 user cannot tell whether a blank metric means "not available" or "zero". The branching field
names are a compatibility layer with no source-of-truth map.

**Suggested fix:** Show a small "Status and maintenance need TM1 12.6+" note in the tab bar or
IDE tab for V11, and map the metric field names in one documented adapter rather than inline
fallbacks in the component.

**Effort:** Small.

---

## 3. Monitoring: Jobs and Sessions

### 3.1 Job and session controls are exposed without admin checks or confirmations

**What:** Jobs Monitor's Cancel and Sessions Monitor's Disconnect/Thread Cancel call mutating
routes that do not check admin, and the buttons are visible to every user. The actions have no
confirmation. Threads query errors are ignored (`useThreads` returns no error UI), so the
monitor can show "no active threads" when the query failed.

**Where:** `client/src/components/JobsMonitor.jsx:20-36, 130-145`;
`client/src/components/SessionsMonitor.jsx:14-18, 55-70, 125-183`;
`server.js:2144-2149, 2307-2327`.

**Why it matters to a forker:** These are cross-user operational controls. The monitor should
make clear who may cancel/kick, and a failed thread fetch should not look like an idle server.

**Suggested fix:** Apply the admin gate/visibility rule above; confirm destructive actions; show
`threads.isError` instead of an empty thread list. Add a stub test for non-admin cancel/disconnect.

**Effort:** Small to medium.

### 3.2 Sessions Monitor has no stable key for a user group row

**What:** The outer user row is rendered in a bare `<>` fragment inside a `map` without a key
(the inner `<tr>` has a key; the fragment does not). React will warn and reconciliation can
behave unexpectedly when the grouped list changes.

**Where:** `client/src/components/SessionsMonitor.jsx:113-145` (the `<>` in the `users.map`).

**Why it matters to a forker:** It is a small but visible React hygiene bug in a monitor that
refreshes every 30 seconds; a forker copying the pattern inherits the warning.

**Suggested fix:** Use `<Fragment key={u.name}>` (or a keyed `<tbody>` row) and keep the inner
session rows keyed.

**Effort:** Small.

### 3.3 Jobs Monitor status matching is inconsistent

**What:** The header's `running` count compares `Status === 'Running'` / `StatusMessage ===
'Running'`, while the row uses a case-insensitive `isRunning`. A lowercase/alternate status can
be counted in the table but not in the badge (or vice versa), and `STATUS_COLOR` is also
case-sensitive.

**Where:** `client/src/components/JobsMonitor.jsx:25-40, 48-52, 96-110`.

**Why it matters to a forker:** The monitor can show "0 running" while a row is visibly running,
or colour a running job as neutral. It is a small correctness/readability issue in a status
display.

**Suggested fix:** Use one `normaliseStatus`/`isRunning` helper and a case-insensitive colour
lookup for both the header and rows.

**Effort:** Small.

---

## 4. User Management

### 4.1 The create-user route bypasses the tested `provisionUser` workaround

**What:** `POST /api/users/provision` calls `cl.createClient(name, password, friendlyName)` and
then adds groups. It does not call `TM1Client.provisionUser()`, the method that exists precisely
because TM1 commits a new client at the end of the procedure that added it, so a password set in
the same run does not apply. The test `tests/provision-user.test.js` proves the method works but
does not exercise the route the UI uses.

**Where:** `server.js:2418-2427`; `core/tm1_client.js:1886-1899`;
`tests/provision-user.test.js`; `client/src/hooks/useApi.js:705`.

**Why it matters to a forker:** The UI's New User path may create users with no usable password,
while the test suite is green because it tests a different implementation. That is a false
confidence trap and a real onboarding failure.

**Suggested fix:** Make the provision route call `provisionUser` (or make `createClient` perform
the same two-run sequence), then add a route-level test with a fake client that records the two
runs. Reconcile the duplicate `/api/users` create route so there is one creation path.

**Effort:** Small.

### 4.2 New users default to the `ADMIN` group

**What:** `CreateUserForm` initialises `selGroups` to `new Set(['ADMIN'])`. The form's default
state therefore grants the highest group unless the creator notices and unchecks it.

**Where:** `client/src/components/UserManagement.jsx:192`.

**Why it matters to a forker:** A routine "create user" action silently creates another admin.
This is the most dangerous default in the admin UI and is exactly the kind of thing a reference
codebase should not teach.

**Suggested fix:** Default to no groups (or a documented non-admin group), show the selected
groups prominently, and require an explicit admin choice for ADMIN. Add a test for the default.

**Effort:** Small.

### 4.3 Password reset uses the wrong pending state

**What:** The Set button is disabled and shows a spinner from `updateClient.isPending`, not the
`resetPassword` mutation it actually calls. The button can look busy for an unrelated
enable/disable operation or remain enabled while a password reset is in flight.

**Where:** `client/src/components/UserManagement.jsx:37-53, 105-116`.

**Why it matters to a forker:** It is a small state bug in a security-sensitive action, and it
makes the UI report the wrong operation.

**Suggested fix:** Use `resetPassword.isPending` for the password button and spinner; keep
`updateClient.isPending` for enable/disable.

**Effort:** Small.

### 4.4 `isSelf` is case-sensitive, so self-protection can be bypassed by casing

**What:** `isSelf` compares `client.Name === username`. TM1 user names are matched
case-insensitively elsewhere (`LOWER(user)` in change-log ownership), so a signed-in `admin` can
be shown as not-self for a client named `Admin` and try to disable/delete the account.

**Where:** `client/src/components/UserManagement.jsx:33-44, 85, 146, 160`.

**Why it matters to a forker:** The UI's protection against self-disable/delete is weaker than
the identity model the rest of the app uses. The server may reject it, but the UI should not
offer it.

**Suggested fix:** Compare case-insensitively (or use the server's canonical name) and disable
self-destructive actions consistently.

**Effort:** Small.

### 4.5 Group-load errors look like "no groups"

**What:** `useGroups` is destructured only as `data = []`; an error is ignored. A signed-in user
who cannot read groups sees an empty group list, not an error, and group membership cannot be
managed safely.

**Where:** `client/src/components/UserManagement.jsx:289-293`; `hooks/useApi.js:738`.

**Why it matters to a forker:** It hides a permissions/server failure behind a valid-looking empty
state. This is the same "silent empty" problem the app avoids elsewhere.

**Suggested fix:** Read and display `groupsError`; disable group editing until it is resolved.

**Effort:** Small.

---

## 5. Catalog Admin

### 5.1 Validation validates the base catalogs, not the rows the admin is looking at

**What:** The Validate button maps `Object.entries(TI_CATALOG|RULES_CATALOG)` (the shipped base
catalog), not the effective rows built from overrides. Added functions are not tested; functions
the admin deleted are still tested and can be listed for suppression. The result map is then
shown against the override rows.

**Where:** `client/src/components/CatalogAdmin.jsx:235-241, 323-352, 354-387`;
`core/git` not involved; `client/src/lib/catalog-runtime.js` for the effective catalog.

**Why it matters to a forker:** The admin can believe a custom function was validated when the
request never included it, or suppress a deleted function based on a test of the base entry. The
test and the displayed table disagree.

**Suggested fix:** Build the validation list from the effective rows for the current tab
(including additions, excluding deletions) and make the test-call builder receive the row's
overridden `isStatement`/`returnType`/params. Show "not tested" for rows that were skipped.

**Effort:** Medium.

### 5.2 A failed overrides read is silently treated as empty overrides

**What:** `fetch('/api/admin/catalog-overrides').then(r => r.json()).then(setOverrides)` does not
check `r.ok`; a 500 body becomes `overrides = { error: ... }`, `rows` becomes empty, and the
admin sees an empty catalog rather than an error. Only network failures hit the `.catch` fallback.

**Where:** `client/src/components/CatalogAdmin.jsx:225-233`.

**Why it matters to a forker:** It makes a broken server look like an empty catalog, and a save
could then overwrite the real overrides with an empty object if the user edits from that state.

**Suggested fix:** Check `r.ok` and `d.error`, keep the previous overrides (or show a blocking
error) instead of substituting an empty catalog. Do not allow Save until the load succeeded.

**Effort:** Small.

### 5.3 The Naming tab is local-only, but the catalog panel looks server-wide

**What:** The Catalog Admin contains a `NamingDictionaryPanel` that edits `localStorage` via
`naming.js`; function overrides are server files. The panel does not say which changes affect
everyone and which only this browser.

**Where:** `client/src/components/CatalogAdmin.jsx:399-452`;
`client/src/components/NamingDictionary.jsx:1-60`; `client/src/lib/formatters/naming.js`.

**Why it matters to a forker:** An admin can edit a "Function Catalog" tab and assume the whole
team sees the naming change, or vice versa. This is an architecture/documentation mismatch inside
one panel.

**Suggested fix:** Label the Naming tab "This browser only" and the function tabs "Server-wide";
or move naming into Editor Preferences where other per-user formatting lives.

**Effort:** Small.

---

## 6. Tests and docs

The area has only partial test coverage:

- `tests/provision-user.test.js` tests `TM1Client.provisionUser`, but not the route the UI uses
  (which does not call it). That is worse than no test because it suggests the route is covered.
- `tests/get-sessions-v11.test.js` proves sessions use `Name`, but there is no Server Admin test
  for the disconnect id (the `s.ID ?? index` bug).
- `tests/save-data-all.test.js` and `tests/safety-session-start.test.js` cover the admin checks
  that do exist; no tests cover the missing admin checks on users, sessions, jobs, maintenance or
  catalog overrides.
- No test covers the UserManagement ADMIN default, password-reset pending state, Catalog Admin
  effective-catalog validation, or the empty-overrides error path.
- The docs describe "Admin" as an admin area, but `FEATURES.md` does not say who can open it or
  which actions require TM1 admin rights.

**Suggested fix:** Add route/module tests for non-admin 403s and the provision two-run path; test
the session id helper against the v11 fixture; test catalog validation includes an override; and
document the admin visibility/permission rule in `FEATURES.md`/`SETUP.md`.

---

## Checked and found nothing (worth calling out)

- `core/save_data_all.js` and `/api/server/simple-mode` do enforce TM1 `Admin` membership; those
  are the correct precedent for the missing checks.
- `ServerAdminPanel`'s sessions tab already confirms a disconnect before calling it; the issue is
  the id, not the confirmation.
- `SessionsMonitor` correctly uses `s.Name` and merges v11 `Session.Threads`, so the monitoring
  path itself is sound.
- The Admin panel correctly hides Status/maintenance on V11 through `serverCapabilities`, and
  the Jobs tab is hidden when the endpoint is unavailable.
- No live TM1 server or REST call was used in this review.
