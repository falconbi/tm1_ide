# 03 — Editors round 2b: finish the client API round

Build brief for OpenCode. Claude checked round 2 on 17 Nov 2026.

## What round 2 did, and what it didn't

Kept: `lib/api.js`, the API-layer tests, and the static-before-parameter route test (step 0).

Not done: steps 2–7 asked for a decision per call (read → `useQuery`, save → `useMutation`,
genuine one-off → `lib/api.js` helper). Instead, 78 `fetch(` calls were renamed to
`apiFetch(`, which adds the token and nothing else: it doesn't check `r.ok`. In files like
`EditorPane.jsx`, `CubeMapEditor.jsx` and `ServerLoginDialog.jsx` no response is checked at all.
The no-direct-fetch test now passes while the problem it was written for is still there. That's
a false green, the thing area 11 removed.

## Rules

As `03_EDITORS_ROUND2_FIXES.md`. One commit per area. **The decision table per call is
required** in the DONE file: file:line → hook name, or `get`/`post`/`patch`/`del`/`postRaw` with
the reason it is a one-off.

## Step 1 — The test tells the truth

`tests/client-no-direct-fetch.test.js`: `apiFetch(` is allowed only at the call sites listed in
an allowlist inside the test, each with file, reason and kind (`download`, `stream`, `upload`,
`sign-in`). Start it with the real one-offs only. The test then fails on every other `apiFetch(`,
and steps 2–7 make it pass.

## Steps 2–7 — The decision per call

The same six areas as round 2, steps 2–7. For each `apiFetch(`:
- reads server state → an existing hook if one covers the route, else a new `useQuery` hook in
  `hooks/useApi.js` (key starts with `server`);
- saves or acts → a `useMutation` hook, invalidating the keys the old code refreshed by hand;
- a genuine one-off that returns JSON → `get` / `post` / `patch` / `del` from `lib/api.js`;
- not JSON (download, stream, upload) → `postRaw`, or stays `apiFetch` on the allowlist.

Every place where an error used to be ignored and is now shown goes in the DONE file.

## Step 8 — Docs

`apiFetch`'s comment in `lib/api.js` and the `CLAUDE.md` / `CONTRIBUTING.md` rule name the
allowlist test as the gate.

## When finished

`docs/ide/review/03_EDITORS_ROUND2B_FIXES_DONE.md`: one line per step, commit hash, tests before
and after, lint, the decision table, errors now shown, the final `apiFetch(` count (target:
only the allowlist), anything not done and why.
