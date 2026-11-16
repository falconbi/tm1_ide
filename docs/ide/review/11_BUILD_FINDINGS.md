# 11 — Build, tests, lint, CI, docs

Read-only review. No code changes, no server restart, no TM1 calls. Checked the root and client
manifests, `.github/workflows/ci.yml`, ESLint config, the test suite, the Vite build, and the
build/test/lint documentation.

Observed locally on Node `20.20.2`: `npm test` → **489 tests, 488 pass, 1 skipped, 0 fail**;
`cd client && npm run lint:count` → **129 problems (20 errors, 109 warnings)**;
`cd client && npm run build` succeeds and writes `../static`.

## 1. CI tests the committed Lens bundle, not the source, and never checks `static/` is current

**What:** CI runs `npm test` before `npm run build`. Several jsdom tests load
`static/lens-kit/lens-kit.js`, the committed build output. A change to `shared/lens-kit` or the
pivot that is not rebuilt is still tested against the previous bundle; the build afterwards only
proves the new source compiles, and CI accepts the dirty `static/` it produces. The same applies
to `static/assets` after any client change.

**Where:** `.github/workflows/ci.yml:32-37`; `client/vite.config.js:18-22`;
`tests/lens-stack.test.js:8`, `tests/shared-pivot-grid.test.js:11`,
`tests/lens-examples-boards.test.js:15`.

**Why it matters to a forker:** The tests claim to run the REAL toolkit and the real grid, but they
run the last committed build. A forker can merge a broken source change with a green CI and ship a
stale `static/` — exactly the failure the “always rebuild static” house rule is meant to prevent.
It also makes the test result depend on whether someone remembered to build before committing.

**Suggested fix:** Build the lens kit (or the whole client) before the tests, and add a
`git diff --exit-code -- static` check after `npm run build`. The alternative is to make those
tests import the source modules and reserve the bundle tests for an explicit post-build job.

**Effort:** Small.

## 2. The lint ratchet and its documentation still enforce 133, while the code is at 129

**What:** The actual lint count is 129 (20 errors, 109 warnings). CI still uses
`LINT_BASELINE: 133`; `docs/ide/LINT.md` still records 133 / 30 / 103 as the current baseline and
133 in its CI section. The phase-2 counts are stale too (for example exhaustive-deps 57 vs 56,
set-state-in-effect 52 vs 47, refs 9 vs 20). The doc also says `react-hooks/static-components` was
cleared, but one remains.

**Where:** `.github/workflows/ci.yml:39-52`; `docs/ide/LINT.md:15-18,35-46,53-55`.

**Why it matters to a forker:** The ratchet no longer does what it says: four new lint problems can
land without failing CI. The doc presents measured numbers as truth even though they no longer
match the code, so a contributor cannot tell what the current bar is.

**Suggested fix:** Lower both places to 129 and refresh the counts from one run of
`npm run lint:count` / the ESLint JSON. Prefer generating the number (or reading one baseline file)
so the workflow and the doc cannot drift apart again.

**Effort:** Small.

## 3. Only the client is linted; the backend, shared modules and tools are not

**What:** The only ESLint config is `client/eslint.config.js`; the only lint script is in
`client/package.json`. `server.js`, `core/`, `shared/`, `tools/tm1mcp/` and `tools/tm1deploy/`
are not linted in CI or locally. There is no root lint script and no syntax check in CI beyond
running the tests.

**Where:** `client/package.json:9-10`; `client/eslint.config.js:1-25`;
`.github/workflows/ci.yml:39-52`; no root ESLint config.

**Why it matters to a forker:** Most of the reference codebase — the Express routes, TM1 client,
change log and MCP tools — has no static quality gate. A typo not covered by a test, an unused
server variable or a CommonJS/ESM mistake reaches main unseen. The client-only lint also teaches
the wrong project shape: lint is a client concern rather than a repository convention.

**Suggested fix:** Add a root ESLint flat config for the CommonJS server/core/tools and ESM
shared/client libs, start with a recorded baseline, and run it in CI. If a full config is too much
for now, at minimum run `node --check` over the server/core/tools entry points and add a root
`lint` script so contributors have one command.

**Effort:** Medium.

## 4. The supported Node version is inconsistent and CI never tests the minimum

**What:** README advertises Node 20+, `SETUP.md` requires Node 20+, but CI uses Node 22 only.
Neither `package.json` declares `engines`, and there is no `.nvmrc` / `.node-version`. The local
machine here runs Node 20.20.2 and passes, but no automation proves that the documented minimum
still works.

**Where:** `README.md:8`; `docs/ide/SETUP.md:13`; `.github/workflows/ci.yml:16-19`;
`package.json:1-36` (no `engines`).

**Why it matters to a forker:** A contributor on the documented Node 20 can hit a failure CI will
never see; a maintainer on Node 22 cannot tell when a dependency or language feature silently
raises the real minimum. The old Playwright skip environment in CI also suggests a toolchain the
project no longer uses.

**Suggested fix:** Choose the minimum deliberately, add `"engines": { "node": ">=20" }` and a
version file, and run CI on 20 and 22 (or at least the minimum). Align the README and setup text
with the matrix.

**Effort:** Small to medium.

## 5. The format-sweep test silently passes with zero private fixtures

**What:** `tests/format-sweep.test.mjs` reads the git-ignored
`.tm1baseline/TM1_Test_DEV.json`; any read/parse failure is swallowed and `formats` stays empty.
The test still passes, with a name that says “over 0 format strings”. The checked-in test therefore
does nothing in a fresh clone or CI, while looking like broad coverage of real TM1 formats.

**Where:** `tests/format-sweep.test.mjs:16-27,31`.

**Why it matters to a forker:** This is a false green: the test's whole value is the baseline scan,
and the failure mode is indistinguishable from success. It also hides a missing fixture instead of
telling the contributor what to provide.

**Suggested fix:** Use `{ skip: 'needs .tm1baseline/TM1_Test_DEV.json' }` when the file is absent,
or commit a small representative fixture. When the baseline is present, assert `formats.length > 0`
and print the count so a silent empty scan is visible.

**Effort:** Small.

## 6. Several important tests assert source text rather than behaviour

**What:** Admin route authorization, catalog route shape and session-start gating are tested by
reading `server.js`/JSX and matching strings. For example, `admin-gate.test.js` slices each route
by text and looks for `requireTm1Admin`; `safety-session-start.test.js` slices the route and looks
for `gateReadOnly`; `catalog-overrides.test.js` searches the GET route for `overrides: raw,
version`. These pass when the route is wired by text but can miss a broken handler or a changed
middleware order.

**Where:** `tests/admin-gate.test.js:62-83`; `tests/catalog-overrides.test.js:35-38`;
`tests/safety-session-start.test.js:31-34`.

**Why it matters to a forker:** The suite teaches “copy the source and regex it” rather than “extract
the handler and call it with fakes”. The project already has the better pattern
(`core/user_admin.js` and `core/save_data_all.js` route factories), so the reference value is split
between two test styles.

**Suggested fix:** Move route bodies into factories and test the factory with fake `req`/`res` and a
fake TM1 client. Keep source checks only for the thin wiring that cannot be exercised without
starting Express. Add one behavioural 403 test for a representative admin route, not just a text
match.

**Effort:** Medium.

## 7. Playwright is still installed even though the project decided not to use it

**What:** Root `devDependencies` still includes `playwright`, and `package-lock.json` still carries
`playwright` / `playwright-core`. No test imports it. CI still sets
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`. The review decision was that Playwright is not used and is to
be removed.

**Where:** `package.json:33-36`; `package-lock.json` (`node_modules/playwright`,
`node_modules/playwright-core`); `.github/workflows/ci.yml:11-12`.

**Why it matters to a forker:** It adds a large, unused install surface and its browser download
environment, and contradicts the repository's own tooling decision. A reader reasonably assumes
there are browser tests somewhere.

**Suggested fix:** Remove `playwright` with `npm uninstall --save-dev playwright`, regenerate the
lockfile, and delete the `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env from CI. Keep `jsdom`, which the
current tests actually use.

**Effort:** Small.

## 8. There is no contributor guide, and the build/test/lint rules are scattered

**What:** README and `SETUP.md` cover install and run. The test command exists only in
`package.json`; the “build into static and commit it” rule is in `CLAUDE.md`; the lint ratchet is in
`docs/ide/LINT.md`, which is not linked from `docs/README.md`; there is no `CONTRIBUTING.md` and no
single page that says how to run the suite, build the client, check lint and what CI will enforce.
`docs/README.md` points to `SETUP.md` / `FEATURES.md` only for the IDE folder, although it describes
the folder as including lint.

**Where:** `README.md:84-108`; `docs/ide/SETUP.md:125-150`; `docs/README.md:19-26`;
`docs/ide/LINT.md:1-60`; no `CONTRIBUTING.md`.

**Why it matters to a forker:** A reference codebase is read and copied. The first thing a new
contributor needs — “how do I run and validate this before opening a PR?” — is spread across a
private assistant file and an unlinked lint document, so the default path is to guess or skip the
checks.

**Suggested fix:** Add `CONTRIBUTING.md` (or `docs/ide/DEVELOPMENT.md`) linked from README and
docs/README, covering: Node version, install both lockfiles, `npm test`, client build into
`static/`, lint baseline, no live TM1 in tests, and the static-freshness requirement. List
`LINT.md` and the architecture/MCP docs in the docs index.

**Effort:** Small.

## Checked and found nothing

- `npm test` on Node 20.20.2 runs 102 test files and passes (488 pass, 1 explicit skip).
- `npm run build` succeeds; Vite writes both the app and `static/lens-kit` directly into `static/`.
- The test glob deliberately lists `*.test.js` and `*.test.mjs`; `_mcp-harness.js` is correctly not
  treated as a test file.
- The `never-deploy` skip is explicit and explains that `packages/` is git-ignored; it is not a
  silent false green.
- `jsdom` is used by the grid/Lens tests; unlike Playwright, it is not dead weight.
