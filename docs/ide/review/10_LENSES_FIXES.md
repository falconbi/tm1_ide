# 10 — Lenses: fix brief (round 1)

Build brief for OpenCode. Source: `10_LENSES_VERDICT.md`. Read `10_LENSES_FINDINGS.md` for line
numbers. Never call the feature "frames".

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npx eslint src` (129 or fewer). If
  `client/src` or `shared/` changed: `cd client && npm run build` and commit `static/` (this
  includes `static/lens-kit`).
- Do not push. Do not restart any server. Do not touch TM1. Tests use the fakes that
  `tests/lens-app*.test.js` and `tests/lens-store.test.js` already use.
- Questions go in `docs/ide/review/10_LENSES_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2, 3, 5 and 6.

## Step 1 — One publish gate (bug)

- `core/lens_store.js`: `visibleTo(doc, groups, { showDrafts })` returns true when status is
  `published` (or `draft` with `showDrafts`) **and** `canOpenLens(doc, groups)`.
- `lens-server.js`: the home list, `/api/lenses`, `/api/lens/lenses`, `visibleLens`, `/lens/:name`,
  `/lens-frame/:name` and `/api/lens/:name` all use it. Delete the four inline copies.
- Tests: with `showDrafts: false`, a draft is refused (404/403) on `/lens/:name`,
  `/lens-frame/:name` and `/api/lens/:name`, and left out of `/api/lenses` and
  `/api/lens/lenses`. A published Lens still opens.

## Step 2 — Every bridge call names its Lens (bug)

- `shared/lens-bridge.js` host: send `lens: getLens()` on every request, reads included
  (`execMDX`, `readCell`, `meta`, `hierarchies`, `elementTree`, `cell-*`).
- `lens-server.js`: each read route requires `lens` and calls `visibleLens(req, lens)` before
  dispatch. Cache the answer per session + Lens for 60 seconds (same idea as `groupCache`).
- The IDE's own preview routes in `server.js` are not part of this step. An unsaved Lens being
  authored has no name, and the IDE user is already a developer. Note this in the code comment.
- Tests: a Finance-only Lens and a non-Finance reader → 403 on `exec-mdx`, `read-cell`, `meta`,
  `element-tree`; a call with no `lens` → 400; a Finance reader passes.

## Step 3 — The editor follows the saved name (bug)

`client/src/components/LensEditor.jsx`:
- Add a `savedName` state, set from `tab.name` and from `data.name` after a successful save.
- `getLens: () => savedName` (put it in the effect's dependencies).
- `patchTab(tab.id, { name: data.name, label: data.name })` after save.

Put the transition in a small pure helper (e.g. `lib/lens-save-state.js`) and test it: a new Lens
saved gets its name, and a rename moves to the new name.

## Step 4 — Lists don't fall over

- `core/lens_store.js` `listLenses` / `listLensRuns`: catch per document and return the readable
  ones plus `errors: [{ name, error }]`. Keep the return shape callers can use (an array with an
  `errors` property, or `{ lenses, errors }`; update every caller and say which in the commit).
- `lens-server.js` `/api/lenses`: `try/catch`, JSON error. The home page shows a one-line warning
  naming unreadable Lenses.
- `LensEditor.jsx:151-180`: each start-page fetch checks `r.ok`. A failure shows an inline error
  with Retry instead of an empty list.
- Tests: one corrupt document → the others are listed and the bad name is reported; a rejected
  `listLenses` → JSON 500.

## Step 5 — No silent example config (bug)

`lens-server.js` `loadConfig`: without `config/lens-app.json` (or `LENS_CONFIG`) it throws the
"create config/lens-app.json" error. The example file is used only when `--demo` or
`LENS_DEMO=1` is set, and it logs that clearly. Test both paths. Update `docs/lenses/` setup
wording.

## Step 6 — Saving keeps the status (bug)

- `core/lens_store.js` `saveLens`: `publish` is `true` | `false` | undefined. Undefined keeps the
  current status (`draft` for a new Lens).
- `LensEditor.jsx`: **Save** keeps the status. **Publish** publishes. On a published Lens, an
  **Unpublish** action asks first ("Removes it from the Lens app for everyone"), using
  `ConfirmButton`.
- Test: saving a published Lens without `publish` stays published.

## Step 7 — `Lens.rows` reads bracketed names

`shared/lens-kit/rows.js`: import `dimOf` from `shared/pivot/cellset.js` (both are ESM) and delete
the local copy. Test a dimension name containing `]`.

## Step 8 — Theme file checked

A test that every entry in `shared/lens-themes.json` has a label and the required light and dark
keys `themeCss` reads. `lens-server.js` runs the same check once at start-up and throws a clear
error. Put the check in one function both use.

## Step 9 — Docs

- `docs/lenses/LENS_APP_PLAN.md:74`: keep the sentence. It is now true. Add "(tested in
  `tests/lens-app-security.test.js`)".
- `docs/lenses/LENSES_PLAN.md` (or the Lenses README): one paragraph pointing at
  `lenses/workforce` as the worked example (15 pages, `save.js`, kept in step with TM1), and one
  paragraph on what the toolkit bundle contains (ECharts, AG Grid, React Flow + dagre, Alpine)
  and roughly how big it is.
- Do not move or edit anything in `tmp/`.

## When finished

`docs/ide/review/10_LENSES_FIXES_DONE.md`: one line per step, commit hash, tests before and after,
lint, anything not done and why.
