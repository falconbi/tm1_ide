# Multi-User Login — TODO

## Why

The IDE currently authenticates to PAW as a **single shared service account**
configured in `.env` (`PAW_USERNAME` / `PAW_PASSWORD`). Every person using
the IDE is the same user to TM1.

This causes problems:

- **Change sets are per-server, not per-person.** If two people work on the
  same server, their changes merge into one change set. There's no audit trail
  of who changed what.

- **No user isolation.** TM1's own security (element security, process security,
  cube security) doesn't apply per-person — everyone operates as the PAW
  service account.

- **SessionControl.jsx** hardcodes `user: 'jdlove'` because there's no real
  user identity to use. This works for a single developer but breaks in any
  shared deployment.

## Use Case

A team of TM1 developers shares one IDE instance (running on a dev server or
localhost). Each developer:

1. Opens the IDE in their browser
2. Logs in with **their own PAW credentials** (same account they use in PAW)
3. Sees only **their own active change set**
4. All TM1 operations (rules saves, dimension edits, etc.) run through
   **their personal PAW session**
5. TM1 access controls apply correctly per person
6. The change set log shows who made each change

PAW / TM1 accounts already exist — no new user provisioning is needed. The
IDE just needs to let people authenticate with their existing credentials.

---

## Phase 2: Conflict Notification (depends on Phase 1)

Once multi-user login works, editors can detect when another user has
changed an object during your editing session:

- **On open** — query `getObjectHistory(server, objectType, objectName)`.
  If the latest entry is from a different user's active session and is newer
  than your session start time, show a banner:

  > *John edited this rule in change set "Budget Fixes" 12 min ago*

- **On save** — same check. If someone saved during your editing session,
  warn before overwriting:

  > *This was just changed by John. Open diff to see what changed?*

Both checks use the existing `getObjectHistory` API — no new backend needed.
Implementation is frontend-only in editor components (ProcessEditor,
DimensionEditor, ViewEditor, HierarchyGrid for rules, etc.).

## What Needs Doing

### Backend

1. **`paw_connect.js` — per-user session cache**
   - Replace the single `_session` singleton with a `Map<token, { session, expiry }>`
   - `getPawSession(token)` logs in on first use, caches per token
   - Token is generated server-side on login, returned to the client

2. **`server.js` — login route**
   - `POST /api/auth/login` — accepts `{ username, password }`, calls PAW login,
     creates a session token, returns it
   - `POST /api/auth/logout` — invalidates the token
   - Every TM1 route reads the user's token from a header / cookie and
     looks up their PAW session

3. **`server.js` — propagate user to change set**
   - `GET /api/sessions/active` — filter by `user` so each person gets their
     own active session
   - `POST /api/sessions/start` — use the authenticated user's identity

### Frontend

4. **Login page** — simple form (username + password), POSTs to `/api/auth/login`,
   stores the returned token (localStorage or cookie)

5. **`SessionControl.jsx`** — remove hardcoded `user: 'jdlove'`, use the
   authenticated user from the login session

6. **Session token on every API call** — the `get`/`post` helpers in `useApi.js`
   need to attach the auth token to every request (custom header)

### PAW Session Lifetime

PAW sessions have an idle timeout (typically 10 min). The backend needs to:

- Detect 401 from PAW (session expired)
- Automatically re-auth with the stored credentials for that user
- Or return a 401 to the frontend so the user re-logs in

The cached session approach in `paw_connect.js` already handles this for the
single-user case — it just needs to apply per token instead of globally.

---

## Phase 3: Deploy Pipeline — Baseline Prod + Drift Re-Check

### Corrected Deploy Flow

The baseline and diff steps currently snapshot and compare against Dev only.
Prod is never involved until the deploy step applies the package, meaning
Prod's state is never verified before overwriting.

**Corrected flow:**

1. Seed baseline from **Prod** — snapshot all objects from the target server
   (not Dev). This is the reference point for everything that follows.
2. Align Dev to match Prod — run `provision-tm1-server.ps1` or equivalent
3. Work in Dev — IDE tracks changes via the active change set
4. Build package — diff Dev's current state against the **Prod baseline**.
   Objects match baseline → UNCHANGED. Objects changed in Dev → MATCH/DRIFT.
5. **Drift re-check (new)** — before deploying, re-fetch each object in the
   package from **Prod's current state** and compare against the baseline.
   If any differ, Prod has drifted since seeding. Flag these as deployment
   blockers — the developer must re-seed baseline and re-align Dev.
6. Risk check — dependency and compatibility analysis
7. Deploy — apply to Prod

### What Needs Changing

1. **Seed baseline from target, not source**
   - The UI currently passes the Dev server to `/api/deploy/seed`. The deploy
     panel should prompt for the Prod/Target server and seed from there.
   - Or auto-seed from Prod when creating a change set (needs Prod connectivity)

2. **Drift re-check in deploy step**
   - After packaging, before applying: for each object in the manifest,
     fetch its current state from the Target server and compare against
     the baseline snapshot.
   - If any object differs → mark as `TARGET_DRIFT`, block deployment,
     show which objects changed and when.

3. **Re-seed trigger**
   - When drift blocks deployment, the UI should offer "Re-seed baseline
     from Target + re-align Dev" as a fix.

## Out of Scope (for now)

- OAuth / SSO integration
- User registration or password management
- Role-based access control within the IDE
- Multiple PAW host support per IDE instance
