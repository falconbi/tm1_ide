# 07 — Deploy round 3b: two bugs found in the round 3 check

Build brief for OpenCode. Same branch, `deploy-round3`, on top of `a532f00`. Claude found both
bugs while checking round 3. **Each one would fail a live check**, so fix them before James
tests. One commit each, with a `BUG_FIXES.md` line each.

## Fix 1 — `ownerOf` matches subsets and views by name only (live check 1 fails)

This is question 1 in `07_DEPLOY_ROUND3_QUESTIONS.md`. It's worse than "medium".

- `core/git-release.js` `ownerOf` compares `type + name` only.
- On TM1_Test_DEV, the change set **"AI: Workforce — new hires need Finance approval"** saved
  `Default` subsets on 17 other dimensions.
- So rebuilding "Testing WFP" would refuse with a false message:
  `…By Location.json needs …By Location.subsets/Default.json, which belongs to change set
  "AI: Workforce — new hires need Finance approval"`.
- The same false owner hides the "Add to this release" checkbox and mislabels "Left on DEV".

Fix:
- `ownerOf` compares with `objectKey(type, name, parent)`. For each log entry, use the same
  parent rule as `csetObjectKeys`: `e.detail` for `subset`/`view` entries.
- Tests:
  - `Default` on `DimA` owned by change set X does **not** own `Default` on `DimB`;
  - `Default` on `DimB` owned by X **does**.

The key has a known limit, so record it in the DONE file: it holds the dimension, not the
hierarchy. So `Default` on `WFP Position` (main hierarchy) and `Default` on `WFP Position ›
By Location` are the same key. Leave that as it is in this round.

## Fix 2 — A saved token is reported as "from .env" after a restart (live check 7 fails)

- At startup, `server.js:18` copies the saved token into `process.env.TM1_GIT_TOKEN`.
- `tokenSource()` treats any `process.env` value as `.env`, and `setToken` refuses whenever
  `process.env.TM1_GIT_TOKEN` is set.
- So after any restart with a saved token (James's setup since 18 Nov):
  - the dialog says "from .env";
  - **Save token is refused, so an expired token can't be replaced from the screen.**

Fix: **one way to read the token.**
- Delete the seeding line in `server.js:18`.
- `setToken` no longer writes `process.env`.
- Every reader calls `gitSecrets.getToken()` (`.env` value first, then the saved file):
  - `core/server_helpers.js:11` `_GITOK`;
  - `routes/deploy.js` lines 45, 56, 79, 100, 134 and 163 (use `_GITOK()`);
  - `core/git-readiness.js:285`.

  After this, `grep -rn "process.env.TM1_GIT_TOKEN" core routes server.js` must find only
  `core/git-secrets.js`. `tools/eval-tm1-git.js` is a stand-alone tool, so leave it.
- `tokenSource()` then means what it says: `'env'` only when `.env` (or the shell) really sets it.
- Tests:
  - a saved token with no env var → `tokenSource() === 'saved'`, and Save token is allowed;
  - an env var → `'env'`, and Save token is refused;
  - a saved token is used by the release route's token helper.

## Also

- `07_DEPLOY_ROUND3_QUESTIONS.md` question 4 says Step 4 wasn't implemented, but it was
  (`fd3eec1`). Mark it as done.
- Update the DONE file with both fixes.

## Rules

As round 3:
- one commit per fix;
- `npm test` passes;
- client lint stays at or below 112, and root lint at 0;
- rebuild `static/` only if the client changes;
- no push, no restart, no TM1 or Git remote;
- leave `docs/images/*.png` alone.
