# 01 — Front door: findings and fix brief

Reviewed by Claude, 16 Nov 2026. Read: `README.md`, `CLAUDE.md`, `.gitignore`, `package.json`,
`.env.example`, `docs/ide/ARCHITECTURE.md`, `docs/ide/SETUP.md`, the `docs/ide` index, the
`config/`, `tests/`, `tools/` listings, CI. James agreed the recommendations the same day.

## What's good — keep as the model for everything else

- `README.md` is honest: pre-release warning, status section, what is untested, links to the
  articles that explain the why. Quick start is five lines and the front end is pre-built.
- `docs/ide/SETUP.md` "Installing at a client" and the Windows table say plainly what has not been
  tried. That is the standard.

## Findings, worst first

### 1. The best map of the codebase is hidden
`CLAUDE.md` (431 lines: constraints, conventions, how to add an editor, the function-catalog story,
the bugs and their causes) is in `.gitignore`. Forkers never see it. The public map,
`docs/ide/ARCHITECTURE.md`, is 77 lines and stale:
- lists `tm1-functions.js` as holding `TM1_FUNCTIONS` (gone since the catalog rebuild)
- says the `tools/tm1deploy` CLI "does the same as the UI pipeline" (the pipeline moved to TM1 Git)
- names adapters `paw_native.js` / `paw_oauth2.js`; `CLAUDE.md` says `paw-native.js` — one is wrong
  (the files are snake_case, so `CLAUDE.md` is wrong)
- points at `docs/CONNECTION_ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/ADAPTER_INTERFACE.md`;
  they live in `docs/auth/` and `docs/deploy/`
- omits `shared/`, `tools/tm1mcp/`, `lenses/`, `lens-server.js`, `core-ti/`, `scripts/`
- says direct-v11 is recommended; `CLAUDE.md` says "No direct TM1 connections — everything proxies
  through PAW". The two maps contradict each other.

### 2. Three programs, one explained
The repo runs the IDE (`server.js`), the Lens app (`lens-server.js`) and the MCP server
(`tools/tm1mcp/server.js`). The README's prose knows this; no diagram or folder map shows what the
three share (`core/`, `shared/`) and what each owns.

### 3. Root and `config/` carry runtime state and leftovers
Root: `Bedrock/`, `venv/`, `tmp/`, `tm1_deploy/`, `data/`, `packages/`, `change_log.db`,
`server.log`, `push.sh`. `config/`: live secrets (`servers.json`) next to committed examples next
to runtime state (`archives/`, `git-deploy-state.json`, `model-migration.json`,
`servers.json.bak-tls`) and a leftover `frames/` folder (the Lens feature's old name — check it is
empty and untracked, then delete). `packages/` at the root holds deploy packages; in Node that name
means monorepo workspaces.

### 4. Docs that overlap or have drifted
- `docs/ide/FEATURES.md` and `docs/ide/FEATURE_LIST.md` are two lists to keep in step.
- `docs/ide/IMPROVEMENTS.md` is the REST-pipeline-era backlog (deploy diff, release windows,
  baselines); several items are moot since the Git deploy but still read as the plan.
- `docs/ide/REST API README .md` has spaces in the file name.
- The README doc table has 17 rows and no reading order.

### 5. Smaller
- Tests: 63 files, strong on safety / deploy / Lens / MCP, almost none on the editors; four naming
  styles (`safety-*`, `mcp-*`, `lens-*`, bare) and two extensions (`.js`, `.mjs`).
- `package.json`: `author` and `keywords` empty, description ("Models-as-code tooling…") doesn't
  match the README, `version` 1.0.0 on a pre-release, `playwright` as a devDependency (not used).
- CI runs Node 22; README says Node 20+.
- `.env.example` leads with PAW settings; Setup recommends direct.

## Fix brief (for OpenCode — build, not review)

Do these in order, one commit each, and run `npm test` and `cd client && npm run build` before each
commit. Do not touch `core/tm1_client.js` or anything under `client/src` beyond what is listed.
Do not restart servers.

1. **Publish the map.**
   - Remove `CLAUDE.md` and `.claude/` from `.gitignore`; `git add CLAUDE.md`. Fix its adapter
     file names to the real `core/adapters/direct_v11.js`, `paw_native.js`, `paw_oauth2.js`.
   - Rewrite `docs/ide/ARCHITECTURE.md` from the real tree: the three programs and their entry
     points, what they share (`core/`, `shared/`, `config/`), every top-level folder with one line
     each, correct doc paths. Keep it under 150 lines. Add one sentence that settles PAW vs direct:
     "The IDE connects either directly to a TM1 server's REST port or through PAW; the adapter in
     `config/servers.json` decides. Direct is simplest for a lab; PAW is usual at a client." Then
     fix the "No direct TM1 connections" line in `CLAUDE.md` to match.
   - In `README.md`, add a one-line "Start here" above the doc table: Setup → Features →
     Architecture → `CLAUDE.md`.
2. **Clean the root and `config/`.**
   - Move runtime state to `data/`: `change_log.db`, `packages/` → `data/packages/`,
     `config/archives/` → `data/archives/`, `config/git-deploy-state.json`,
     `config/model-migration.json`, `config/deploy-approvals.json`, `config/git-secrets.json`.
     Update every path in code and `.gitignore`. List each path change in the commit message.
   - Delete `config/frames/` and `config/servers.json.bak-tls` (confirm untracked first).
     Add `tm1_deploy/` and `data/` handling to `.gitignore` as needed.
   - `push.sh`: move to `scripts/` and mention it in Setup only as developer convenience.
3. **One feature list.** Merge `FEATURE_LIST.md` into `FEATURES.md` (the numbered list becomes the
   first section), delete `FEATURE_LIST.md`, fix every link to it. Rename `REST API README .md`
   to `REST_API_README.md` and fix links. In `IMPROVEMENTS.md`, move items the Git deploy made
   moot into the "Done / intentionally skipped" section with one line saying why.
4. **Tests.** Rename to one convention: `<area>-<subject>.test.js` (`safety-`, `mcp-`, `lens-`,
   `deploy-`, `pivot-`, `client-`, `server-`), one extension. `.mjs` files that need ESM stay `.mjs`
   only if `node --test` cannot load them as `.js`; otherwise convert. Update the `test` script.
5. **`package.json`.** `description`: "A browser-based IDE and MCP server for IBM Planning
   Analytics (TM1)." `author`: falconbi. `keywords`: tm1, planning-analytics, ide, mcp. `version`:
   0.9.0. Remove `playwright` from devDependencies and from `package-lock.json`. Set CI to the
   same Node version Setup states (20), or change Setup to 22 — pick one and say which.
