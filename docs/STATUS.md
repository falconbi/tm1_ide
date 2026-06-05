# Session Status — ViewEditor Writeback

## What we are doing
Implementing cell writeback in **ViewEditor** (the actual rendered component for cube view tabs).

## Architecture confirmed
- `EditorPane` renders `ViewEditor` for tab types `view` and `cubeview` — this is the real path
- `CubeViewer` is dead code — never rendered, previous writeback work there was wasted
- `ResultGrid` writeback works correctly in `GuidedMDXBuilder` preview panel — leave as-is
- Two grids intentionally separate: `ResultGrid` (MDX preview) and `ViewEditor→HierarchyGrid` (cube view tabs)

## What was built
- `HierarchyGrid` — added `onCellEdit` prop, `singleClickEdit`, `stopEditingWhenCellsLoseFocus`, and `editable` function that blocks consolidated row/col cells
- `ViewEditor` — added `handleCellEdit` callback that builds full dim coordinate from row tupleKey + column members + page members, calls `/api/cells/write`
- `/api/cells/write` endpoint already exists in `server.js` — calls `tm1_client.writeCellValue`
- `ResultGrid` — removed all `[writeback]` console.logs (cleanup only)

## Currently testing
Diagnosing why writeback is silent. Added 3 console.logs:

1. `[ViewEditor] grid mode: HierarchyGrid | plain AgGrid` — fires on every render, tells us which grid is actually mounted
2. `[HierarchyGrid] cell NOT editable` — fires when `editable()` returns false, shows why
3. `[HierarchyGrid] onCellValueChanged fired` — fires when a cell edit commits
4. `[ViewEditor] handleCellEdit called` — fires when ViewEditor receives the edit

## Next step
User to open browser console, hard refresh, open cube view, report what `[ViewEditor] grid mode:` says.
If it says `plain AgGrid` → `useHierarchy` is false, element trees not loading.
If it says `HierarchyGrid` → `singleClickEdit` issue or editable function returning false.

## Deploy command (correct)
```
cd client && npm run build && cp dist/assets/index-*.js ../static/assets/ && cp dist/assets/index-*.css ../static/assets/ && cp dist/index.html ../static/ide.html
```
Server serves `static/ide.html` — never `index.html`.

## Key files
- `client/src/components/ViewEditor.jsx` — main target
- `client/src/components/HierarchyGrid.jsx` — grid component
- `server.js` line 1527 — `/api/cells/write` endpoint
- `core/tm1_client.js` line 703 — `writeCellValue`
