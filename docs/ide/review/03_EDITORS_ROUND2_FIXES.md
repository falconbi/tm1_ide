# 03 — Editors round 2: one way to call the server

Build brief for OpenCode. Source: the deferred items in `03_EDITORS_FINDINGS.md` /
`03_EDITORS_FIXES_DONE.md`. Written by Claude 17 Nov 2026.

**Scope: the ~100 direct `fetch` calls only.** Splitting the big editors (ViewEditor 2,800 lines,
CubeMapEditor 2,183, ProcessEditor 1,853, DimensionEditor 1,681, EditorPane 1,155) is **not** in
this round. Each editor gets its own brief later, one at a time, once its calls go through hooks
(this round makes those splits smaller and safer).

**The rule a forker should see:** the client talks to the server one way. Data and saves go
through hooks in `hooks/useApi.js`. A genuine one-off command (sign-in, a download, a streamed AI
reply) uses the helpers in `lib/api.js`. Nothing else calls `fetch`.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` and commit `static/`,
  client lint 129 or fewer, root lint 0.
- **No behaviour change.** Same URL, method, body, headers and query key semantics. Where a direct
  fetch silently swallowed an error, the hook now surfaces it. That is the one intended change;
  list each one in the DONE file.
- Query keys start with `server`, as `CLAUDE.md` says. Reuse an existing hook when one already
  calls the same route. Never write a second hook for the same route.
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/03_EDITORS_ROUND2_QUESTIONS.md`, never into guesses.

## Step 0 — Carry-over from the server split: route order test

The split fixed a real bug by accident. Before it, `POST /api/lenses/:name` was registered before
`POST /api/lenses/generate`, so the Lens editor's Generate request was handled as a save of a Lens
named "generate" and never reached the AI. Make that impossible to reintroduce:

- `tests/server-route-table.test.js`: add a test over the live route list. For any two routes with
  the same method whose paths can match the same URL (same segment count, every segment equal or
  one of them a `:param`), the one with fewer `:param` segments must be registered first. The SPA
  fallback stays last.
- `docs/ide/BUG_FIXES.md`: one line for the Generate bug (fixed by the split, now tested).

## Step 1 — `lib/api.js`

Move `authHeader`, `extractError`, `get`, `post`, `patch`, `del` out of `hooks/useApi.js` into
`client/src/lib/api.js` (exported). `useApi.js` imports them. Add `postRaw` (returns the
`Response` after the `r.ok` check) for downloads and streams. Test: `tests/client-api.test.mjs`
covers a non-ok response turning into a thrown error with the server's message, and the
`noSession` event on post.

## Steps 2–7 — Move the direct calls, one area per commit

For each call, decide: **read** → `useQuery` hook; **save / action** → `useMutation` hook (with the
cache invalidation the old code did by hand, if any); **one-off command** → `lib/api.js`. Record
the decision per call in the DONE file (file:line → hook name or helper).

2. Dimensions and subsets: `DimensionEditor.jsx` (8), `SubsetVisualEditor.jsx`, `SubsetEditor.jsx`
3. Views and MDX: `ViewEditor.jsx` (7), `GuidedMDXBuilder.jsx`
4. Processes and rules: `ProcessEditor.jsx` (6), `EditorPane.jsx`, `ProcessSummariesDialog.jsx`,
   `FindReplace.jsx`
5. Lenses and files: `LensEditor.jsx` (6), `FileManager.jsx`
6. Change sets, assertions and deploy: `AssertionsManager.jsx` (6), `DeployWizard.jsx` (5),
   `GitSetup.jsx`, `GitDrift.jsx`, `DeployHistory.jsx`, `ChangeLogPanel.jsx`, `ModelHealth.jsx`
7. Everything else: `TransactionLogPanel.jsx` (5), `LoginPage.jsx`, `CatalogAdmin.jsx`,
   `ServerSelector.jsx`, `Explorer.jsx`, `CubeMapEditor.jsx`, `lib/tm1-completion.js`,
   `lib/catalog-runtime.js`, and anything `grep` finds that isn't listed here

## Step 8 — The rule holds

- `tests/client-no-direct-fetch.test.js`: scans `client/src` and fails on any `fetch(` outside
  `lib/api.js`. An allowlist entry needs a file, a reason and a line number; the target is none.
- `CLAUDE.md` State Management section and `CONTRIBUTING.md`: replace "a direct `fetch` is only for
  a one-off command" with the rule above, naming `lib/api.js`.

## When finished

`docs/ide/review/03_EDITORS_ROUND2_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, lint, the per-call decision table, every error that used to be swallowed and is now shown,
the remaining `fetch(` count (target 0 outside `lib/api.js`), anything not done and why.
