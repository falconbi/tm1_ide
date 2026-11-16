# 11 — Build, tests, lint, CI, docs: fixes done (round 1)

Completed 16 Nov 2026. One commit per step. The CI file could not be run locally; its first push
is the proof of the matrix, `static/` check and both ratchets.

| Step | Commit | Tests before → after |
|---|---|---|
| 1 — CI proves `static/` is current | `4ac8a0c` | 505 → 505 (1 skipped) |
| 2 — One lint baseline | `afeaab0` | 505 → 505 (1 skipped) |
| 3 — No false green | `7671f8f` | 505 → 505 (1 skipped) |
| 4 — Playwright out; Node 20 tested | `707ebbe` | 505 → 505 (1 skipped) |
| 5 — Lint the backend | `991e81c` | 505 → 505 (1 skipped) |
| 6 — Behaviour, not text | `c902a68` | 505 → 506 (1 skipped) |
| 7 — `CONTRIBUTING.md` | `6a8ff33` | 506 → 506 (1 skipped) |

Final: **506 tests, 505 pass, 1 skipped, 0 fail**. Client lint **129** (20 errors, 109 warnings);
backend lint **87** (56 errors, 31 warnings), both recorded as ratchets.

- Step 1 now builds before testing and fails when `git status --porcelain -- static` is non-empty.
- Step 2 moved the client baseline to `client/lint-baseline.json` (129); CI reads it with `node -e`.
  `LINT.md` now points at that file and gives the one measured current count.
- Step 3 skips `format-sweep` with the missing-fixture reason, fails on a parse error, and requires a
  non-empty format list when the baseline is present.
- Step 4 removed Playwright and its CI env, regenerated the lockfile, added `engines.node >=20` and
  `.nvmrc` 20, and made CI test Node 20 and 22. The `static/` check and both ratchets run on Node 20.
- Step 5 added the root flat ESLint config and scripts, plus `eslint`, `@eslint/js` and `globals` as
  root devDependencies. Backend findings are recorded, not fixed. No `no-undef`/real undefined
  variable errors were found, so there was no `BUG_FIXES.md` entry to make.
- Step 6 replaced the route source-slice tests with factories: `core/admin_routes.js`
  (`cancelJob`), `core/session_routes.js` (`start`) and the catalog GET/PUT pair in
  `core/catalog_overrides.js`, tested with fake `req`/`res` and fake clients. One small wiring test
  remains for the UI/`isAdmin` text, where no browser test exists.
- Step 7 added `CONTRIBUTING.md`, linked it from README and the docs index, and added
  `ARCHITECTURE.md`, `LINT.md` and `MCP_SERVER.md` to the docs index.

Not done: the backend lint findings themselves (deliberately, per the brief — a later round). CI
changes need the first push to prove.
