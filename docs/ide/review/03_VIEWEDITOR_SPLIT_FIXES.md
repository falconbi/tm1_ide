# 03 — Split ViewEditor (editor split 1 of 5)

Build brief for OpenCode. Written by Claude 17 Nov 2026. The first of the five editor splits;
the others (CubeMapEditor, ProcessEditor, DimensionEditor, EditorPane) follow the pattern this
one sets, so get the shape right.

**This round moves code and puts server calls behind hooks. It does not change behaviour.** Same
screens, same buttons, same requests, same query keys. No restyling, no "while I'm here" fixes. If
you find a bug, write it in the QUESTIONS file and leave it.

## Today

`client/src/components/ViewEditor.jsx`: 2,779 lines, one import site (`EditorPane.jsx:11`).

| Lines | What |
|---|---|
| 30–46 | view-session history in `localStorage` (`loadViewSessions`, `saveViewSessionEntry`) |
| 70–146 | `SourceViewPreview` (calls `post` directly at :78) |
| 147–193 | `COMPLEX_MDX_PATTERNS`, `detectComplexMDX`, `viewerAxesToBuilderConfig` |
| 194–275 | member tree: `Checkbox`, `TreeNodes`, `buildElementTree` |
| 276–631 | axis builder: `SubsetPopover`, `DimPill`, `DropZone` |
| 632–650 | trace formatting: `GUARD_RX`, `isGuardStatement`, `fmtTraceValue`, `formatStatement` |
| 651–1290 | trace: `RuleBreakdown` (~420 lines), `TypeBadgeTrace`, `useTraceData`, `TraceSidePanel` |
| 1291–2779 | `ViewEditor` itself: ~1,490 lines, 42 `useState`, 19 `useEffect`, 34 `useCallback` |

Direct server calls left after round 2b: `:78` (post), `:684` and `:736` (element attributes),
`:724` and `:1131` (cube dimensions), `:1387` (alias values), `:2152` (cell write).

## Target

```
client/src/components/view-editor/
  ViewEditor.jsx           the shell: wires hooks to panels; target under 400 lines
  SourceViewPreview.jsx
  axes/
    DropZone.jsx  DimPill.jsx  SubsetPopover.jsx  MemberTree.jsx (Checkbox, TreeNodes)
  trace/
    TraceSidePanel.jsx  RuleBreakdown.jsx  TypeBadgeTrace.jsx  useTraceData.js
  hooks/                   the ViewEditor's state, one concern per hook, e.g.
    useViewLayout.js       axes, pills, aliases, suppress/totals (the reducer if one fits)
    useViewLoad.js         load existing view / default layout for a new cube view
    useViewRun.js          execute, auto-execute, drill beyond the view, cellset → grid
    useViewSave.js         save / save-as / default view / conflict check
    useCellWrite.js        writeback + trace/log from a cell
client/src/lib/view-editor/  pure functions, no React
  view-sessions.js  complex-mdx.js (detectComplexMDX, viewerAxesToBuilderConfig)
  member-tree.js (buildElementTree)  trace-format.js (GUARD_RX … formatStatement)
```

The hook names are a guide. Read the component first and cut along the concerns that are really
there, then record the final list and why in the DONE file. Rules for the cut:
- A panel component takes props and calls hooks; it never holds another panel's state.
- A hook in `view-editor/hooks/` owns one concern and returns what the shell needs. Hooks may call
  `hooks/useApi.js`; they don't call `lib/api.js` directly.
- Pure logic goes in `lib/view-editor/`, so it can be tested without React.
- No file over 600 lines. `RuleBreakdown` is the likely exception; if it can't get under 600
  without changing logic, leave it and say so.
- `EditorPane.jsx` imports `@/components/view-editor/ViewEditor`. Delete the old file; no
  re-export shim.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` and commit `static/`,
  client lint at or below 128 (lower `client/lint-baseline.json` if it drops), root lint 0.
- Copy code as it is when moving. Rename only where a name collides.
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/03_VIEWEDITOR_SPLIT_QUESTIONS.md`, never into guesses.

## Step 1 — Pure functions out, with tests

Move the four `lib/view-editor/` modules. Tests in `tests/view-editor-*.test.mjs`:
`detectComplexMDX` (one complex pattern, one plain MDX), `viewerAxesToBuilderConfig` (rows,
columns, titles round-trip), `buildElementTree` (parent/child, an element under two parents),
`isGuardStatement` / `formatStatement` (the non-calc guard from `CLAUDE.md`), view-sessions with a
throwing `localStorage`.

## Step 2 — Trace out

`trace/` as above. `TraceSidePanel`'s cube-dimensions read (`:1131`) uses the same query as
`useCubeDimensions`: export a `cubeDimensionsQuery(server, cube)` options factory from `useApi.js`,
use it in the hook and as `queryClient.fetchQuery(cubeDimensionsQuery(...))` here. That is the
pattern for any read inside an event handler or a loop: same key, same cache, no second copy of
the URL.

## Step 3 — Axis builder out

`axes/` as above, plus `SourceViewPreview.jsx`. Its `post` at `:78` becomes a hook or a
`useMutation` in `useApi.js`, depending on whether it reads or acts (record which).

## Step 4 — The remaining direct calls behind hooks

- Element attributes (`:684`, `:736`): `elementAttrsQuery(...)` factory shared with
  `useElementAttrValues`; the loop uses `fetchQuery` (drop the hand-made `attrCache` ref if the
  query cache now does its job; say so).
- Cube dimensions (`:724`): `cubeDimensionsQuery` from step 2.
- Alias values (`:1387`): `useAliasValues` already exists; use it or its factory.
- Cell write (`:2152`): `useWriteCell` mutation in `useApi.js` (check one doesn't already exist
  under another name). It invalidates what the old code refreshed after a write.
- After this step `grep -nE "\b(get|post|put|patch|del|request)\(" client/src/components/view-editor`
  returns nothing.

## Step 5 — ViewEditor's own state into hooks

Cut the 1,490-line component along its sections (load existing view, default layout, drill-down,
auto-execute, pivot grid data, save, writeback) into `view-editor/hooks/`. One commit per hook if
that keeps each diff readable; otherwise one commit for the step. Keep effect order and
dependencies exactly as they are. If two effects depend on each other's order, keep them in the
same hook and add one comment saying why.

## Step 6 — The shell and the docs

- `view-editor/ViewEditor.jsx` under 400 lines: hooks at the top, layout below.
- `CLAUDE.md` Key Files: `ViewEditor.jsx` → `view-editor/` with one line per subfolder. Add a
  short "Editor layout" rule under UI conventions: an editor is a folder with a shell, panels,
  `hooks/` for its state, and pure logic in `lib/<editor>/`. Reads in handlers use a query
  factory with `fetchQuery`.
- `CONTRIBUTING.md`: one paragraph pointing at `view-editor/` as the layout for a new editor.

## When finished

`docs/ide/review/03_VIEWEDITOR_SPLIT_FIXES_DONE.md`: one line per step, commit hash, tests before
and after, lint, the final file list with line counts, the hook list and what each owns, every
direct call → hook/factory, anything not done and why.

Also a **manual check list for James** (he runs it in the IDE; OpenCode can't): open an existing
native view; open an MDX view; build a new view by dragging dimensions; change a subset and a
member; toggle suppress and totals; type a value and save; trace a calculated cell; drill beyond
the view; save, save as, set default view; reopen and confirm the layout persisted; save rules
for the same cube and confirm the view refreshes.
