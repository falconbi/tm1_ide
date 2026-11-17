# 12 — Repo tidy: fix brief

Build brief for OpenCode. Agreed by James 17 Nov 2026. Work on branch `repo-tidy`.

**Goal:** the top of the repo reads cleanly for someone who forks it. Every folder name says what
it holds, and nothing personal or temporary is committed.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), root lint 0, and client lint at or below
  `client/lint-baseline.json`. If `client/src` or `shared/` changed, run `cd client && npm run build`
  and commit `static/`.
- Use `git mv` for moves so history follows the file.
- After each step, `git grep` the old name across the whole repo, excluding `node_modules`,
  `static/` and `docs/ide/review/`, and fix every hit. Leave dated history text (for example
  `BUG_FIXES.md` lines and `CHANGELOG.md`) as written.
- Do not push. Do not restart any server. Do not touch TM1.
- Never delete anything under `tmp/`.
- Never print the contents of `.mcp.json` or `.env` in a commit, a log or the DONE file.
- Questions go in `docs/ide/review/12_REPO_TIDY_QUESTIONS.md`, never into guesses.

## Step 1 — Remove the temp photos

`git rm -r "docs/Temp files"` (two WhatsApp images).

## Step 2 — Remove the archive

- `git rm -r docs/Archive` (33 old documents; git history keeps them).
- Remove the references in `docs/README.md`, `docs/ide/MCP_SERVER.md` and `.gitignore`.
- If a live doc links to an archived file for a fact that is still true, copy that one fact into
  the live doc instead of keeping the link. List any you do this for in the DONE file.

## Step 3 — `scripts/` folds away

- `git mv scripts/seed-test-db.js tools/seed-test-db.js`, and fix its relative `require` paths.
- `git rm scripts/push.sh`. It is a personal push helper, and `SETUP.md:180` already says it
  isn't needed. Remove that `SETUP.md` row.
- Update any `package.json` script or doc that names either file. Remove `scripts/`.

## Step 4 — `core-ti/` becomes `ti-processes/`

- `git mv core-ti ti-processes`.
- Fix every reference: `core/tm1_client.js` (the `require`), `tools/tm1mcp/tools/coreti.js` and
  anything else it loads, `docs/README.md`, `docs/ide/ARCHITECTURE.md`, the folder's own READMEs,
  tests and `CLAUDE.md`.
- The MCP tool names do not change in this step.
- Add one line to `ti-processes/README.md`: "TI processes the IDE installs on a TM1 server. They
  are not part of the IDE's own code."

## Step 5 — `.mcp.json` becomes an example

- Copy `.mcp.json` to `.mcp.example.json` with every `env` value replaced by a placeholder
  (`"TM1_MCP_SERVER": "<your server name>"`, `"MCP_MODE": "readonly"`). Keep the keys, command
  and args.
- `git rm --cached .mcp.json` (the local file stays on disk; James's setup keeps working).
  Add `.mcp.json` to `.gitignore`.
- `docs/ide/MCP_SERVER.md` and `docs/auth/AUTHENTICATION.md`: "copy `.mcp.example.json` to
  `.mcp.json` and set your server". Same pattern as `opencode.example.jsonc`. Add the same line
  to `CONTRIBUTING.md` setup.
- `docs/auth/AUTHENTICATION_PLAN.md` is a plan document. Change only text that tells a reader
  what to do today.

## Step 6 — `.gitignore` and local leftovers

- `.gitignore`: remove `/Bedrock` (the folder is gone), and the `venv/` and `tm1_deploy/` entries
  once those folders are deleted below. Remove any other entry for a path that no longer exists
  and that no tool creates. List each removed line in the DONE file.
- Local only (not tracked, no commit needed):
  - Delete `venv/`. It is a Python environment; nothing in the repo uses Python.
  - Delete `tm1_deploy/`, which holds only an old `__pycache__`.
  - Delete `server.log`.
- Do **not** touch `tmp/`, `data/`, `.tm1baseline/`, `.env` or `.claude/`.

## Step 7 — Docs match the tree

- `CLAUDE.md` Key Files, `docs/ide/ARCHITECTURE.md` and `CONTRIBUTING.md` show the top-level
  folders as they now are, one line each.
- Run `ls` at the root and confirm every folder appears in that list or in `.gitignore`.

## When finished

`docs/ide/review/12_REPO_TIDY_FIXES_DONE.md`: one line per step with its commit hash, tests before
and after, lint counts, the removed `.gitignore` lines, any facts copied out of the archive, and
anything not done and why.
