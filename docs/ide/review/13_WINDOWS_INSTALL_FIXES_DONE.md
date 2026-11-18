# 13 — Windows install fixes: done

Branch `windows-install-fixes`, four commits on top of `f710a6e`. No push, no server restart, no TM1 — tests use stubs only. No client change; `static/` is untouched.

| Fix | Commit | Tests |
| --- | --- | --- |
| 1 — line endings / MCP docs test | `79833e7` | 682 (681 pass, 1 skipped) |
| 2 — `servers.json` example, docs, startup notice | `535f38a` | 682 (681 pass, 1 skipped) |
| 3 — Admin Server lookup errors and logging | `a23d1c1` | 686 (685 pass, 1 skipped) |
| 4 — `.nvmrc` to Node 22 | `0233073` | 686 (685 pass, 1 skipped) |

Lint before and after: root `0` problems; client `112` problems (baseline `client/lint-baseline.json` is `112`).

## Fix 1
- Added `.gitattributes` with `* text=auto eol=lf` and binary lines for the image, font and `.blob`/PDF types.
- `git add --renormalize .` changed no tracked file content (index was already LF).
- `tests/mcp-tool-counts.test.js` normalises `\r\n` to `\n` on the document and `buildTable()` before comparing. No other test compares a checked-in doc with generated text.

## Fix 2
- Added `config/servers.example.json` (Option A shape).
- `docs/ide/SETUP.md` Option A and the README Getting started now say to copy the example (`cp` and Windows `copy` forms).
- A missing `config/servers.json` now logs one startup warning naming the example file; `getLoginServer()` returns `null` instead of throwing, so the IDE keeps running.

## Fix 3
- `_resolveServerUrl` throws `AdminHostLookupError` with code `ADMIN_HOST_LOOKUP` and a plain message for: 401/403 (address is a TM1 server), refused/timeout (Admin Server unreachable), and server not listed (includes the names it did list).
- `/api/auth/server-login`'s outer catch logs once with `console.error` (never the body) and returns the message with `code: ADMIN_HOST_LOOKUP` as a 502.
- New `tests/adapter-registry-admin-host.test.js` stubs axios/fs: all three messages, and the route response/log contain no password.

## Fix 4
- `.nvmrc` is `22`. `engines` stays `>=20`; the CI matrix stays 20 and 22.

## Not done
- Nothing outstanding from the brief. Fix 1 and Fix 3 each carry a `BUG_FIXES.md` line, as asked.
