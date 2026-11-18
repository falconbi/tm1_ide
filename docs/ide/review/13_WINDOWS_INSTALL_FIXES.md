# 13 — Windows install: four small code fixes

Build brief for OpenCode. Work on branch `windows-install-fixes`, which starts from `main` (`c301742`).

## Why

On 19 Nov 2026 a Claude session on a Windows 10 VM installed the IDE from a fresh clone, following
only the docs. It worked: install, start, sign-in to TM1 v11 and opening a cube. The docs were fixed
in PR #33. These four issues are in the code. Each one cost the test time.

## Fix 1 — `.gitattributes` (a test fails on Windows)

- The repo has no `.gitattributes`. Git for Windows defaults to `core.autocrlf=true`, so
  `docs/ide/MCP_SERVER.md` is checked out with CRLF (`git ls-files --eol` showed `i/lf w/crlf`).
- `tests/mcp-tool-counts.test.js` line 20 compares it with `buildTable()`, which produces LF, so it
  always fails on Windows. Its hint, "run node tools/tm1mcp/tool-table.js --write", doesn't help and
  would dirty the tree.

Fix:
- Add `.gitattributes`: `* text=auto eol=lf`, plus `binary` lines for the image, font and
  `.blob` types the repo holds. Run `git add --renormalize .` and confirm the commit changes no file
  content (the index is already LF).
- In the test, compare with `\r\n` replaced by `\n` on both sides, so a CRLF checkout made before
  this fix still passes. Apply the same normalising to any other test that compares a checked-in doc
  with generated text (grep `readFileSync` in `tests/` for doc comparisons).

## Fix 2 — `config/servers.example.json`

- A fresh clone has no `config/servers.json` and no example. The other configs have one
  (`lens-app.example.json`, `mcp-security.example.json`, `sql-connections.example.json`).
- Add `config/servers.example.json` with the Option A shape from `docs/ide/SETUP.md`: one
  `adminHosts` entry, `"url": "http://192.168.x.x:5895"`, `"adapter": "direct-v11"`, placeholder
  username and password, and `"servers": ["MyTM1Server"]`.
- `docs/ide/SETUP.md` Option A: change "create it from this example" to
  "copy `config/servers.example.json` to `config/servers.json`", with the Windows `copy` form.
  Same in the README's Getting started comment.
- **If `config/servers.json` is missing at start, the IDE says so** in the console, naming the
  example file, instead of starting with no servers silently. Check what it does today first and
  keep it running.

## Fix 3 — a wrong `url` gives "Could not reach … 401" with no explanation

What happened: `servers.json` pointed `url` at the TM1 server's own port (52670), not the Admin
Server (5895).
- `core/adapter-registry.js` `_resolveServerUrl()` calls `${url}/api/v1/Servers` without
  credentials. A TM1 server's own port answers that with 401.
- `routes/auth.js` (`/api/auth/server-login`, the outer `catch`) returned
  `Could not reach "24retail": Request failed with status code 401`.
- The tester read that as a password problem. The credentials were correct (a direct call to 52670
  with them returned 200). **Nothing was logged** in the IDE console.

Fix:
- In `_resolveServerUrl`, catch the request error and throw a plain message that names the cause:
  - **401/403:** `The address in config/servers.json (<url>) answered as a TM1 server, not the TM1 Admin Server. Set "url" to the Admin Server, usually port 5895 (HTTP) or 5898 (HTTPS).`
  - **connection refused or timeout:** `Can't reach the TM1 Admin Server at <url>. Check "url" in config/servers.json and that the Admin Server service is running.`
  - "Server not found": add the names it did list, e.g. `… Admin Server lists: 24retail, TM1_Test_DEV`.
- Give these errors a code (e.g. `ADMIN_HOST_LOOKUP`), so the sign-in route can show them as a
  setup problem, not as "Could not reach". The sign-in dialog shows the message as is.
- `routes/auth.js`: log the error once with `console.error` in that outer `catch`. Never log the
  request body or any password.
- Tests (stub axios, no TM1): 401 → the Admin Server message; ECONNREFUSED → the reach message;
  missing name → lists the names; the route's response contains no password.

## Fix 4 — `.nvmrc` says Node 20

- `.nvmrc` is `20`, which is end of life. The docs now recommend 22, and the Windows test ran on
  22.23.5. Change `.nvmrc` to `22`. Keep `engines` at `>=20` and the CI matrix at 20 and 22.

## Rules

- One commit per fix, each with a `BUG_FIXES.md` line for fixes 1 and 3.
- Before each commit: `npm test` passes, root lint 0, client lint at or below
  `client/lint-baseline.json`. No client change is expected, so `static/` shouldn't change.
- Do not push. Do not restart any server. No TM1. Tests use stubs only.
- Any other bug goes in `13_WINDOWS_INSTALL_QUESTIONS.md`.

## When finished

`docs/ide/review/13_WINDOWS_INSTALL_FIXES_DONE.md`: one line per fix with its commit hash and test
count, lint before and after, and anything not done.

## Live check for James

1. On Linux: `npm test` still passes.
2. On the Windows VM: `git pull` in `C:\Users\admin\tm1-ide-test`, then `npm test`. The
   `mcp-tool-counts` test passes. (The 22 client-package failures go away after
   `cd client && npm install`, as the Setup guide now says.)
3. In `config/servers.json` on the VM, set `url` to `http://localhost:52670` for a moment, restart
   the IDE and sign in. The message says the address is a TM1 server, not the Admin Server, and the
   console logs it. Put `5895` back.
