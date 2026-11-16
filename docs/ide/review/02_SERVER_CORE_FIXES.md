# 02 — `server.js` and `core/`: fix brief (round 1)

Build brief for OpenCode. Source: `02_SERVER_CORE_VERDICT.md` items 1–5, agreed by James
16 Nov 2026. Read `02_SERVER_CORE_FINDINGS.md` sections 1.1, 1.2, 3.2, 3.3 for the detail and
line numbers.

## Rules

- One commit per numbered step below, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` (if any client file
  changed), `cd client && npx eslint src` (warnings must stay at 133 or fewer).
- Do not push. Do not restart any server. Do not touch TM1.
- Change only what the step names. If a step needs something outside its list, stop and write the
  question in `docs/ide/review/02_SERVER_CORE_FIXES_QUESTIONS.md` instead of guessing.
- Every deleted route or method: grep the whole repo (`client/src shared lenses tools lens-server.js
  tests docs`) for its path or name first and paste the empty grep result in the commit message.
- Add a line per step to `docs/ide/BUG_FIXES.md` under today's date for anything that is a bug
  (steps 3 and 5 are bugs; the rest are clean-ups).

## Step 1 — One error shape

1. In `core/adapters/direct_v11.js` `_settle` (line ~84), and in `paw_native.js` and
   `paw_oauth2.js` where axios errors pass through, normalise the thrown error: `e.message` is
   TM1's own message when present (`response.data.error.message`), otherwise
   `HTTP <status> <statusText>`; keep `e.status`, `e.response`, and add `e.tm1 = true`. Put the
   shared logic in one new file `core/tm1-error.js` and require it from all three adapters.
2. Add one helper in `server.js` next to `gateWrite`:
   `fail(res, e)` → 400 if `e.status === 400`, 401/403 if 401/403, 404 if 404, 409 if `e.code`
   is `READ_ONLY` or `LOCKED`, else 500; body `{ error: e.message }`. Use it in the routes listed
   in findings 1.1 that read `e.response.data…` or `JSON.stringify(e.response.data)`. Do not
   change the ~200 routes that already do `res.status(500).json({ error: e.message })` — they now
   get the right message for free.
3. `GET /api/process/log` (`server.js:1003`), `GET /api/servers` (`499`), `GET /api/forge`
   (`2757`): on error return `fail(res, e)`, not 200 with an empty value. Check the client
   callers of each (`grep -rn "api/servers\|api/forge\|api/process/log" client/src shared`)
   and make sure they handle a non-200 (most already do through TanStack Query).
4. `POST /api/process/run` (`1064`): wrap the body in the standard try/catch; validate
   `req.query.name` before using it.
5. Add to `CLAUDE.md` under Architecture Constraints, two sentences: routes report failure with
   `fail(res, e)`; the only routes that return a result object containing `error` with 200 are the
   command-result routes `/api/period-builder/run` and `/api/deploy/git/prepare|execute|review`.
6. Test: `tests/server-tm1-error.test.js` — a fake adapter response with a TM1 error body yields
   `e.message` equal to TM1's text and `e.status` set; a response without a body yields
   `HTTP 500 …`.

## Step 2 — Delete dead code

Delete these 23 routes from `server.js` (lines from findings 1.2; re-find by path):
`GET /api/log/recent`, `GET /api/process/log`, `POST /api/view/execute`,
`GET /api/elements/attributes`, `POST /api/view/execute-suppressed`, `GET /api/model/dimensions`,
`POST /api/chore/execute`, `POST /api/chore/activate`, `POST /api/chore/deactivate`,
`GET /api/process/errorlogs`, `POST /api/cube/feeders`, `POST /api/cube/breakdown`,
`POST /api/cube/leaves`, `GET /api/cube/annotations`, `POST /api/cube/annotations`,
`DELETE /api/cube/annotations/:id`, `GET /api/whoami`, `POST /api/deploy/git/review`,
`POST /api/git/governance/mirror`, `POST /api/git/governance/apply`, `GET /api/deploy/baselines`,
`POST /api/deploy/baseline/head`, `DELETE /api/process/summary`.

**Do not delete** `/api/lens/history` or `/api/lens/whoami` (called from `shared/lens-bridge.js`).

Before deleting `GET /api/process/log` confirm `/api/process/errorlog/content` is what the UI uses.
Before deleting the chore routes confirm how `ChoreEditor.jsx` runs, activates and deactivates a
chore and that those routes stay. Before deleting the annotation routes confirm
`CellContextMenu.jsx` has no Notes tab (CLAUDE.md still describes one — if the UI still has it,
keep the routes and write that down in the questions file).

Also delete: `TM1Client.probeAttributeValueWrite` and `probeAttributeWrite`
(`core/tm1_client.js:408`, `440`); the unused `execFileSync` import in `core/git-review.js:10`.
Then delete any `TM1Client` method that only those routes used (grep each method name).

Update `docs/ide/FEATURES.md` and `CLAUDE.md` where they mention a removed feature (Notes tab,
Fire Feeders is already gone).

## Step 3 — OData keys through `odataKey` everywhere (bug)

- `core/git-release.js:288, 292, 303, 317-320`: replace `encodeURIComponent(name)` inside
  `Cubes('…')`, `Dimensions('…')`, `Hierarchies('…')`, `Subsets('…')`, `Views('…')`,
  `Chores('…')`, `Processes('…')` with `odataKey(name)` from `core/odata-key.js`.
- `server.js:3658, 3662` (temporary process deletes): same.
- `core/tm1_client.js:1535, 1553, 1875, 1886` (annotation, job, session, thread ids): same, for
  one rule everywhere.
- Add `tests/odata-key-usage.test.js`: reads `server.js`, `core/**/*.js`, `tools/tm1mcp/**/*.js`
  and fails if any line matches `(Cubes|Dimensions|Hierarchies|Subsets|Views|Chores|Processes|
  Elements)\('\$\{` without `odataKey(` on the same line. Allow a `// odata-key: ok` comment to
  exempt a line, and exempt `server.js:2084` (PAW Assets path, different API) with that comment
  plus a one-line reason.
- `GET /api/files/content` (`server.js:2449-2458`): add `TM1Client.downloadFile(pathParts, name)`
  using the existing `_fileContentUrl`, with a `binary: true` option on the adapter `get` (all
  three adapters). Route calls that and removes its own PAW session/CSRF code. Test on the v11
  path shape only (unit, stubbed adapter).

## Step 4 — Write gates and debug noise

- `/api/sql/post-to-ti` (`2833`), `/api/period-builder/run` (`2738`),
  `/api/admin/validate-ti-functions` (`3637`): `gateReadOnly` → `gateWrite`.
- Remove these `console.log` calls: `server.js:2958`, `2963` (cell write body and response),
  `1865` (view axes), `1399` (element tree sample), `1360` (MDX on view save), and the step
  logging in `1120-1147` (process run). Keep `console.error` in catch blocks.
- `CLAUDE.md`, Architecture Constraints: one sentence — "Routes that write to TM1 use `gateWrite`;
  routes that write only local files (`forge.json`, SQL connections, catalog overrides, process
  summaries) use `gateReadOnly`."

## Step 5 — Hidden side effect (bug)

`TM1Client.executeViewWithSuppression` (`core/tm1_client.js:1433`) PATCHes `SuppressEmptyRows` /
`SuppressEmptyColumns` on the saved view before executing it. Find its callers. If suppression
can be applied on the read (execute with `$filter`/MDX `NON EMPTY`, or client-side as the grid
already does through `cellsetToHierarchyData`), remove the PATCH. If a caller truly needs the
saved view changed, split into `setViewSuppression(cube, view, rows, cols)` and a plain
`executeView`, and make the caller call both so the write is visible. Say which you did in the
commit message and `BUG_FIXES.md`.

## When finished

Write a short `docs/ide/review/02_SERVER_CORE_FIXES_DONE.md`: one line per step, the commit hash,
test count before and after, lint count, and anything you could not do and why.
