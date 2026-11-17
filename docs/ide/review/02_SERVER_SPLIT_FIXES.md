# 02 — Split `server.js` into `routes/` (round 2)

Build brief for OpenCode. The layout was agreed by James in area 02 (best practice). Run after
`10_LENSES_PATTERNS_FIXES.md`.

**This round moves code. It does not change behaviour.** No handler logic is rewritten, no route
path, method, gate or response changes. Thin handlers (moving logic into `core/`) is a later round.

## The target layout

```
server.js                 bootstrap only: env, express, middleware, build deps, register routes
                          in order, SPA fallback, listen. Target: under 200 lines.
routes/
  _http.js                the HTTP helpers every route uses: fail, gateWrite, gateReadOnly,
                          requireSession, requireTm1Admin, userServer, scanIdentity, mayManageSession
  auth.js                 /api/auth/*, /api/servers, /api/server/*, /api/paw/*, /api/session, /api/tm1-sessions
  dimensions.js           dimension(s), hierarchy/hierarchies, element(s), edges, subset(s)
  cubes.js                cube(s), rules, cells, lineage, cubemap, model, model-health, control
  views.js                view(s), mdx
  processes.js            process(es), chore(s), period-builder
  changesets.js           sessions, log, assertions
  deploy.js               deploy, git, git-readiness
  admin.js                admin, users, groups, threads, thread, jobs, job, transactions, config
  sql.js                  sql
  lenses.js               lens, lenses, lens-patterns, files
  search.js               search
  workspace.js            forge
  ai.js                   the AI routes
```

Each route file exports `register(app, deps)` and nothing else, the same shape as
`tools/tm1mcp/tools/*.js`. `deps` is one object built once in `server.js` (clients, stores, config
constants, the `_http.js` helpers). Route files never `require` each other. If the table above
doesn't fit a route, put it where its noun belongs and record the choice in the DONE file.

Helpers that sit in `server.js` today (`parseDbRefs`, `extractMembersFromExpression`,
`joinContinuations`, `summaryPrompt`, `processCode`, `logAttributeValue`, `closeServerSession`,
`setupBlankAdmin`, …): no `req`/`res` → move to `core/` next to the code that uses them (tests
for them move along). Touches `req`/`res` → `routes/_http.js` if shared, else the one route file
that uses it.

## Rules

- One commit per step. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), the route-table test (step 0) unchanged, root lint
  at or below baseline (lower the baseline if it drops), client untouched.
- Do not push. Do not restart any server. Do not touch TM1. Do not start `server.js` to test it;
  the route-table test loads `app` without listening.
- Copy code exactly. Don't reformat or "improve" a handler while moving it.
- Questions go in `docs/ide/review/02_SERVER_SPLIT_QUESTIONS.md`, never into guesses.

## Step 0 — A safety net first

- `server.js`: build the app in a function and export it; call `app.listen` (and the HTTPS
  listener) only when `require.main === module`. `npm start` must behave exactly as before.
- `tests/server-route-table.test.js`: load the app with stubbed env, read the Express router
  stack, and compare **method + path, in registration order** against a committed snapshot
  `tests/fixtures/route-table.json` (generate it once in this step from the unsplit server).
  Registration order matters: `/api/lens/meta` must stay before `/api/lens/:name`, and the SPA
  fallback stays last.
- Every later step must leave this test green with the same snapshot.

## Steps 1–13 — One route file per commit

In this order, smallest risk first: `workspace`, `search`, `sql`, `ai`, `lenses`, `views`,
`processes`, `cubes`, `dimensions`, `changesets`, `deploy`, `admin`, `auth`. Each step: create
the file, move the routes and their private helpers, register it in `server.js` at the same point
in the order, run tests. `routes/_http.js` is created in the first step that needs a shared helper.

## Step 14 — `server.js` is bootstrap only

What's left: requires, env and constants, `express.json`, auth middleware, building `deps`, the
`register` calls in order, static and SPA fallback, listen. Under 200 lines. Delete unused
requires.

## Step 15 — Docs

- `CLAUDE.md` "Architecture Constraints": replace "All API routes are in `server.js` — no router
  files" with the new rule: routes live in `routes/<noun>.js`, each exports `register(app, deps)`,
  shared HTTP helpers in `routes/_http.js`, `core/` never sees `req`/`res`. Update the Key Files
  tree and the "Adding a New Editor Type" step 4.
- `docs/ide/ARCHITECTURE.md` and `CONTRIBUTING.md` "how to add a route": the same.

## When finished

`docs/ide/review/02_SERVER_SPLIT_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, root lint, the final `server.js` line count, line counts per route file, every route placed
somewhere other than the table above and why, anything not done and why.
