# 03 — Split ViewEditor (editor split 1 of 5)

Completed 17 Nov 2026. One commit per step. Behaviour unchanged; no direct API calls remain in the
view-editor folder.

| Step | Commit | Tests |
|---|---|---|
| 1 — Pure functions out | `66f9d78` | 512 → 518 (517 pass, 1 skip) |
| 2 — Trace out | `ac81744` | 518 (517 pass, 1 skip) |
| 3 — Axis builder and source preview out | `40d5a19` | 518 (517 pass, 1 skip) |
| 4 — Server calls behind hooks/factories | `30de751` | 518 (517 pass, 1 skip) |
| 5 — ViewEditor state into hooks | `bbf2bc0` | 518 (517 pass, 1 skip) |
| 6 — Shell under 400 lines + docs | `e99e9ef` | 518 (517 pass, 1 skip) |

Final: **518 tests, 517 pass, 1 skipped, 0 fail**. Client lint **122** (18 errors, 104 warnings,
lowered from 127); backend lint **0**. `ViewEditor.jsx` is **384 lines**.

## Hooks

| Hook | Lines | Owns |
|---|---:|---|
| `useViewLayout.js` | 224 | axes, bench, suppress/totals, aliases, drag/drop, builder collapse |
| `useViewSave.js` | 138 | save / save-as / native / default, conflict + diff |
| `useViewRun.js` | 114 | execute, auto-execute, drills, MDX sync, rules refresh, mode sync |
| `useViewLoad.js` | 111 | existing-view load, default layout, view type/complexity |
| `useFlatGrid.js` | 87 | flat grid state, widths, freeze, appearance |
| `useCellWrite.js` | 86 | writeback, context menus, log filter, refresh debounce |
| `useViewMdx.js` | 80 | MDX text, mode, sessions, AI generate, editor resize |
| `useViewPivotData.js` | 70 | display result, formats, trees, pivot/flat data |
| `useViewShortcuts.js` | 26 | keyboard listener |
| `useViewResultState.js` | 19 | result, truncation, big-view guard |
| `useViewSource.js` | 12 | source-view preview state |
| `useViewTrace.js` | 12 | trace context + saved stack |
| `useViewUsedIn.js` | 12 | Used In queries |

Other files: `view-editor/ViewToolbar.jsx` (259), `ViewAiBar.jsx` (23), `ViewUsedIn.jsx` (65),
`SourceViewPreview.jsx` (45), `trace/RuleBreakdown.jsx` (425), `trace/TraceSidePanel.jsx` (225),
`trace/TypeBadgeTrace.jsx` (11), `axes/DimPill.jsx` (168), `axes/DropZone.jsx` (42),
`axes/MemberTree.jsx` (53), `axes/SubsetPopover.jsx` (174); pure logic in
`lib/view-editor/parse-mdx.js` (85), `complex-mdx.js` (38), `member-tree.js` (29),
`trace-format.js` (24), `view-sessions.js` (7).

## Direct calls moved

| Old call | New owner |
|---|---|
| `/api/view/preview-records` | `useViewPreviewRecords` |
| `/api/element/attributes` | `elementAttrsQuery` + `fetchQuery` |
| `/api/cube/dimensions` | `cubeDimensionsQuery` + `fetchQuery` |
| `/api/dimension/alias-values` | `aliasValuesQuery` + `fetchQuery` |
| `/api/cells/write` | `useWriteCell` |

No `get`/`post`/`put`/`patch`/`del`/`request` call remains in `components/ViewEditor.jsx` or
`components/view-editor/`.

## Manual check list for James

Open an existing native view; open an MDX view; build a new view by dragging dimensions; change a
subset and a member; toggle suppress and totals; type a value and save; trace a calculated cell;
drill beyond the view; save, save as, set default view; reopen and confirm the layout persisted;
save rules for the same cube and confirm the view refreshes.
