# 11 — Build, tests, lint, CI, docs: fix brief (round 1)

Build brief for OpenCode. Source: `11_BUILD_VERDICT.md`. Read `11_BUILD_FINDINGS.md` for line
numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build`, commit `static/` if it
  changed, client lint 129 or fewer.
- Do not push. Do not restart any server. Do not touch TM1.
- CI changes can't be run locally. Write them carefully and say in the DONE file that they need a
  first push to prove.
- Questions go in `docs/ide/review/11_BUILD_FIXES_QUESTIONS.md`, never into guesses.

## Step 1 — CI proves `static/` is current

`.github/workflows/ci.yml`: install → **build client** → **`git diff --exit-code -- static`**
(the failure message is "static/ is out of date — run `cd client && npm run build` and commit
static/") → test → lint. Tests then run against the bundle the source just produced.

## Step 2 — One lint baseline

- `client/lint-baseline.json` `{ "problems": 129 }`. The CI step reads it with `node -e`. Delete
  `LINT_BASELINE` from the workflow.
- `docs/ide/LINT.md`: the baseline section says "the number lives in `client/lint-baseline.json`",
  and the current counts come from one fresh `npm run lint:count` run. Remove stale per-rule claims
  you can't re-measure in one command.

## Step 3 — No false green

`tests/format-sweep.test.mjs`: when `.tm1baseline/TM1_Test_DEV.json` is absent, `test(..., { skip:
'needs .tm1baseline/TM1_Test_DEV.json (private, git-ignored)' })`. When present, assert
`formats.length > 0`. A parse error fails the test instead of being swallowed.

## Step 4 — Playwright out; Node 20 tested

- `npm uninstall --save-dev playwright` (lockfile regenerated). Remove
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` from CI. Grep for any other mention and remove it.
- Root `package.json`: `"engines": { "node": ">=20" }`. Add `.nvmrc` with `20`.
- CI: `strategy.matrix.node: [20, 22]`. The `static/` diff check and lint run on 20 only (one
  build is enough).
- README and `SETUP.md` say "Node 20 or later (CI tests 20 and 22)".
- This replaces the Playwright and Node items in `01_FRONT_DOOR_FINDINGS.md` brief step 5. Leave
  the rest of that step (description, author, keywords, version) for the 01 run.

## Step 5 — Lint the backend

- Root `eslint.config.js` (flat): `server.js`, `lens-server.js`, `core/**`, `tools/**` as CommonJS
  (Node globals); `shared/**` as ESM. `@eslint/js` recommended only, plus `no-unused-vars` as a
  warning. No style rules.
- Root scripts: `lint`, `lint:count` (same JSON-count shape as the client's).
- Record the count in `lint-baseline.json` at the root and add a CI ratchet step like the
  client's. Do **not** fix the findings in this step. Fixing them is a later round, except plain
  errors that are real bugs (undefined variables), which go in `BUG_FIXES.md`.
- `docs/ide/LINT.md`: a short "Backend" section.

## Step 6 — Behaviour, not text

Replace the source-text checks in `tests/admin-gate.test.js:62-83`,
`tests/catalog-overrides.test.js:35-38` and `tests/safety-session-start.test.js:31-34` with
behaviour tests:
- Admin: call `createAdminGate` with a fake `makeClient` (non-admin and admin) and assert 403 /
  pass. Pick one representative mutation route and pull its handler into a factory the way
  `core/user_admin.js` does, then test it with fake `req`/`res`.
- Catalog: test `normalizeOverrides` plus a factory for the GET/PUT pair (move them into
  `core/catalog_overrides.js`).
- Session start: the same factory pattern for its gate.
- Keep one small text test that only checks the wiring line exists, if nothing else can.
- Do not start the general route split. That is its own brief.

## Step 7 — `CONTRIBUTING.md`

At the root, one page, linked from README and `docs/README.md`: Node version; install both
lockfiles; `npm test`; `cd client && npm run build` writes `static/`, so commit it (never copy
`client/dist`); lint ratchets (client and backend) and how to lower them; tests never touch a live
TM1 server; how to add a route, a TM1 call, a hook and an MCP tool (link to the existing CLAUDE.md
sections, don't copy them); what CI enforces. Add `LINT.md`, `ARCHITECTURE.md` and
`MCP_SERVER.md` to the docs index.

## When finished

`docs/ide/review/11_BUILD_FIXES_DONE.md`: one line per step, commit hash, tests before and after,
client and backend lint counts, anything not done and why.
