# 06 — Understanding the model: fix brief (round 1)

Build brief for OpenCode. Source: `06_MODEL_VERDICT.md` items 1–9, agreed 16 Nov 2026. Item 10
(splitting `CubeMapEditor.jsx`) is not in this round. Read `06_MODEL_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` when `client/src` or
  `shared/` changed (commit `static/` with it), `cd client && npx eslint src` (129 or fewer).
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/06_MODEL_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2 (first-DB-only), 3, 4, 5 and 6.
- `shared/` is ESM, `core/` is CommonJS; follow the convention recorded in
  `05_VALIDATORS_FIXES_DONE.md` (ESM in `shared/` for the client, CommonJS copy in `core/` tested
  against the same table) until a single convention is decided.

## Step 1 — Cache per identity (security)

`core/cube_data_sources.js:15`, `304-307`, `366-367`: key the cache by `${server}::${user}`
where `user` is the resolved TM1 user name for the request (whatever `makeClient`/the session
knows; if only the IDE token is available, use a stable hash of it and say so). Cap the map at
50 entries, oldest out. `invalidate(server)` removes every entry for that server across users.
Check every other module-level cache that holds model data read under a user's login
(`grep -rn "new Map()" core/ server.js | grep -i cache`) and apply the same rule; list each in
the commit message with "per user" or "not user data" next to it. Test: two users, one
`getCubeDataSources` each with different stub clients, each sees only its own index.

## Step 2 — One scanner: Cube Map model moves to `core/` (bug + area 02 item 6)

- Create `core/cubemap.js`. Move the Cube Map model code out of `server.js` (the block from
  `stripComments` at ~3506 through the graph/edge/step building, ending before the route sends
  its response) into it as `buildCubeMapModel(client, opts)`. The route becomes: gate, make
  client, call, send.
- Inside `core/cubemap.js`, use `cube_data_sources.js`'s `stripComments`, `splitArgs`,
  `resolveName` (export them from there) instead of the copies; delete the copies.
- Settle the differences the findings list, one rule each, in `cube_data_sources.js`:
  `DB` regex is global and matches `DB(` and `DBS(` (fixes 3.1); control processes (`}` prefix)
  are excluded from both scans unless the caller passes `includeControl: true`; `ViewZeroOut`
  / `CubeClearData` handled in one place. Update `CubeDataSources.jsx:9-10`'s comment to be
  true.
- Tests: extend `tests/cube-data-sources.test.js` with a two-`DB()` line (both cubes found) and
  a `DBS(` line; add `tests/cubemap.test.js` that builds a small model from stubbed rules and
  processes and asserts the edges (rule read, feeder, TI write, TI read, process call, dim
  change) — this is the test a forker reads to learn the Cube Map's data model.

## Step 3 — Find & Replace checks every save (bug)

`client/src/components/FindReplace.jsx:169-199`: per object, check `r.ok` and the JSON `error`;
collect successes and failures; toast "Replaced in N objects" or "Replaced in N, failed in M"
with the failed names; keep failed objects in the preview; only reset the search when all
succeeded. Then (5.5): before replacing, check the store for an open **dirty** tab on any
target object and refuse those with a message naming them; after a successful replace, if the
object is open clean, tell the editor to reload (there is an existing version-bump pattern:
`rulesVersions` / `subsetVersions` in the store — use it).

## Step 4 — Trace panel resets on a new cell (bug)

`client/src/components/ViewEditor.jsx` render at ~2786-2794: give `<TraceSidePanel>` a `key`
derived from `traceCtx` (cube + coordinates). Keep the `traceRef` restore for the same cell.
Fix 4.2: the cross-cube label compares against the current stack entry's cube, not the
original. Test is not practical without a renderer; describe the manual check in the commit
message.

## Step 5 — Rule Lens parser (bug)

`core/rule_lens.js:8-56`: replace the `'` toggle with a scanner that treats `''` as an escaped
quote inside a string, and `bracketedElements` with the `]]`-aware pattern (same as
`shared/pivot/cellset.js` after area 04; CommonJS copy in `core/` per the convention). Add the
two findings examples (`['Net Sales]]YTD']`, `['O''Brien']`) to `tests/rule-lens.test.js`.
Also 3.6: Rule Lens lists feeder target cubes as well as calc-section `DB` sources, labelled.

## Step 6 — Error surfaces

- `RunbookDialog.jsx:95-104`: check `r.ok`; show the error in the dialog instead of
  "No description".
- Search index (5.2): a failed index build shows the error, not "No matches".
- `/api/cube/trace` (4.3): `fail(res, e)` like every other route.
- 5.6: the search-index route logs under its own name.

## Step 7 — Local-file gate and write safety

`POST` and `PUT /api/process/summary` (`server.js` ~3410-3459): `gateReadOnly(res, server)`
before writing, per the `CLAUDE.md` rule. 3.7: serialise writes to
`data/process-summaries.json` (one in-process promise chain is enough). 3.4: read and parse
the file once per request, not once per process.

## Step 8 — Cube Map state and races

1.3: ignore a model response that arrives after a newer request was sent (request counter).
1.4: restore `showProcesses` from the persisted state. 2.2: reset the selected chore index when
the chore list changes.

## Step 9 — Search: one surface, one route

5.3 and 5.4: decide whether the Explorer's search and Find & Replace share one route; if they
do, keep one, document its scope in `FEATURES.md`, and make the index fetch rules and processes
in bulk (`$select` on the collection) rather than one request per object. If they genuinely
differ in scope, write the difference in `FEATURES.md` and name the routes so the difference is
obvious. Say which in the commit message.

## When finished

`docs/ide/review/06_MODEL_FIXES_DONE.md`: one line per step, commit hash, tests before and after,
lint, the list of caches from step 1, anything not done and why.
