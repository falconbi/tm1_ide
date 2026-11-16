# 03 — Explorer and the editors: fix brief (round 1)

Build brief for OpenCode. Source: `03_EDITORS_VERDICT.md` items 1–8 and 10, agreed by James
16 Nov 2026. Item 9 (splitting the five big editors) is **not** in this round. Read
`03_EDITORS_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` (every step here
  touches `client/src`, so rebuild and commit `static/` with it), `cd client && npx eslint src`
  (133 or fewer; steps 3 and 8 should bring it down and the new count goes in the commit message).
- Do not push. Do not restart any server. Do not touch TM1.
- Change only what the step names. Questions go in `docs/ide/review/03_EDITORS_FIXES_QUESTIONS.md`,
  not into guesses.
- Add a line to `docs/ide/BUG_FIXES.md` under today's date for steps 1, 2, 3 and 4 (bugs).

## Step 1 — Dirty check on every close path (bug)

`client/src/store/index.js`: `closeTab` (~232) asks before discarding a dirty tab;
`closeGroup` (~312), `closeOtherTabsInGroup` (~405) and `closeTabsToRight` (~418) do not.
- Add one helper in the store, `confirmDiscard(tabs)`: returns true if no tab is dirty, otherwise
  asks once, naming the dirty tabs (`"Rules: WFP Workforce Cost" and 2 more have unsaved changes.
  Close anyway?`). All four close actions call it. `closeTab` keeps its current wording when only
  one tab is involved.
- `client/src/App.jsx` (or wherever the window handlers live): add a `beforeunload` handler that
  warns when any tab is dirty. Needed because step 2 stops the workspace file saving content.
- Test: `tests/client-store-close.test.js` — each close action with a dirty tab and the confirm
  stubbed to false leaves the tab open; with true, closes it; with no dirty tab, never asks.
  Import the store directly (it is plain Zustand; no DOM needed beyond a `window.confirm` stub).

## Step 2 — Workspace file is layout only (bug; decided by James)

`forge.json` remembers which tabs are open and how they are split, nothing else.
- `_saveForge` (`store/index.js:89-104`): strip `content` and `dirty` from every tab before
  sending (the same `{ content: _c, dirty: _d, ...meta }` pattern already used at ~219 and ~361).
- `loadForge` (~136): restored tabs have no `content`; confirm every editor loads its content
  from TM1 when a tab has none (they do today for a fresh tab — check `initTabContent` callers and
  that no editor assumes `tab.content` is set on mount). Fix any that do.
- Server side: `POST /api/forge` in `server.js` — also strip `content`/`dirty` if present, so an
  old client cannot write them back.
- Update the forge comment in `store/index.js` and the `forge.json` line in `CLAUDE.md`
  ("Workspace persistence (open tabs, server, splitDirection)" → add "layout only; never
  content").
- Test: `_saveForge` payload has no `content` or `dirty` on any tab.

## Step 3 — `useConflictCheck` ref read in render (bug)

`client/src/hooks/useApi.js:671-688`: `openConflict` is a `useMemo` that reads
`initializedRef.current`, set in an effect after the memo ran, so the banner is one fetch late
and ESLint flags it. Hold the baseline in `useState` set from the effect (or derive it with
`useMemo` from the first non-empty history), so the memo recomputes when it is initialised.
Remove the ref. Test: `tests/client-conflict-check.test.js` with a fake history: no banner for
own change; banner when another user's entry is newer than the baseline; none when it equals
the baseline. Use `@testing-library/react`'s `renderHook` only if it is already a devDependency;
otherwise test the pure decision function extracted from the hook.

## Step 4 — One tab identity per view (bug)

Explorer opens `cubeview:${server}:${cube}:${view}`; `CubeMapEditor.jsx:1538` and
`ModelHealth.jsx:193` open `view:…`, so the same view can be open twice and "already open"
detection fails. Add `viewTabId(server, cube, view)` (and `rulesTabId`, `processTabId`,
`dimensionTabId`, `subsetTabId` while there — one place for all tab ids) in
`client/src/lib/tab-ids.js`; every `openTab` for those types uses it; the dispatcher in
`EditorPane.jsx` is unchanged (ids keep the `cubeview:` form). Grep for every `id: \`` in
`client/src` to find the call sites. Test the helper.

## Step 5 — One MDX formatter

Three `formatMDX` definitions: `SubsetEditor.jsx:33` (brace/indent, set expressions),
`GuidedMDXBuilder.jsx:24` and `ViewEditor.jsx:193` (keyword/line, statements). Create
`client/src/lib/mdx-format.js` exporting `formatMDX(mdx, { mode: 'statement' | 'set' })`;
the three editors import it; delete the local copies. Test both modes with one fixture each,
taken from the current outputs so behaviour does not change in this step.

## Step 6 — Docs match the code

- `CLAUDE.md`: the "CellContextMenu — View Grid Right-Click" section and the `HierarchyGrid`
  references describe a five-tab menu that is now Trace only (area 02 step 2 removed the Notes
  docs; finish the job: Write, Log, Copy, Rules tabs and the `.badge` note). Replace with four
  lines saying what the menu does now.
- `docs/ide/FEATURES.md:50, 94`: remove the feeder-check promises.
- `CLAUDE.md` "Completed Features": remove "cell right-click context menu (write value, …)".

## Step 7 — Direct fetch exception list

- Use the existing hook instead of a direct `fetch`: `EditorPane.jsx:391` (`/api/cube/dimensions`
  → `useCubeDimensions` or the nearest), `ViewEditor.jsx:753` and `:1127` (see findings 3 for
  the hooks they bypass).
- For the one-off calls that stay direct, check `r.ok` and `d.error` and show the error:
  `ProcessEditor.jsx:1060-1063`, `SubsetVisualEditor.jsx:180-182`, `ChangeLogPanel.jsx:148`.
- `CLAUDE.md`, State Management section, one sentence: "Data goes through hooks in
  `hooks/useApi.js`; a direct `fetch` is only for a one-off command, and it checks `r.ok`."
Do not convert the other ~70 direct fetches in this round; list them in the commit message by
file with a count, so the next round can take them in batches.

## Step 8 — Small clean-ups

Delete `useDimCubes` (`useApi.js:475`), `components/ui/sidebar.jsx`, `hooks/use-mobile.js`
(confirm no importer first, paste the grep). Remove the duplicate branch in `Explorer.jsx:30-31`.
Fix the ref-in-render in `TabBar.jsx:198` (drag-over state for the highlight, ref for the
payload). Report the new lint count.

## Step 9 — Store tests

`tests/client-store.test.js`: open, close, split right / down, move to other group, reorder,
close others, close to right, tab history. Pure state assertions; no DOM. This is the file a
forker reads to learn the tab model, so name each test as a sentence.

## When finished

`docs/ide/review/03_EDITORS_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, lint before and after, the direct-fetch list from step 7, anything not done and why.
