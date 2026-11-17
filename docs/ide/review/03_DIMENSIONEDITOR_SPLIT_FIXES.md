# 03 — Split DimensionEditor (editor split 4 of 5)

Build brief for OpenCode. Follows the ViewEditor, Cube Map and ProcessEditor splits; copy their
shape. **Move code and fold server calls into hooks. Do not change behaviour.** The screen,
buttons, requests and query keys stay the same. The only exceptions are the two Step 0 fixes.
Work on branch `dimensioneditor-split`, which starts from `processeditor-split`.

## Today

`client/src/components/DimensionEditor.jsx` is 1,675 lines. The main component
(`DimensionEditorCore`) holds 19 `useState`; `AttrGrid` holds another 21 hooks.

| Lines | What |
|---|---|
| 24–56 | constants `TYPE_ICON`/`TYPE_COLOR`/`TYPE_LABEL`, `buildTree`, `isUnder` |
| 57–86 | `DropLine`, `WeightInput` |
| 87–180 | `BulkAddModal` |
| 181–340 | `HierarchyPlaces`, `AlternateBanner`, `ElementPanel` |
| 341–518 | `AddRow`, `TreeNode`, `FlatList` |
| 519–544 | `buildTreeOrder` |
| 545–702 | `COLOUR_HEX`, `TM1_FORMAT_PRESETS`, `FormatPickerEditor`, `NewAttrModal`, `AttrHeader` |
| 703–994 | `AttrGrid` (the AG Grid attribute editor) |
| 995–1,118 | `parseTabDelimited`, `StructureGrid` |
| 1,119–1,236 | `NewDimensionScreen`, `PreDeleteDialog` |
| 1,239–1,243 | exported `DimensionEditor` wrapper |
| 1,244–1,425 | `DimensionEditorCore`: state, tree/filter memos, element and edge handlers |
| 1,426–1,597 | the two toolbar rows |
| 1,598–1,675 | body: tree/flat pane, element panel, attrs/grid, modals |

There is one direct call to move: `:737`, `post /api/dimension/attribute/convert-to-alias` in
`AttrGrid`.

## Step 0 — Two small fixes left from the ProcessEditor round

Each fix is its own commit and gets a `docs/ide/BUG_FIXES.md` line.

- **0a. Empty ASCII file.** `lib/process-editor/ascii-preview.js` `parseAsciiPreview`: when
  `head > 0` and there is no first line, return numbered columns (`Column 1`) and no rows,
  instead of throwing. Add the test. Then mark question 1 in
  `03_PROCESSEDITOR_SPLIT_QUESTIONS.md` as done.
- **0b. File read keeps its status.** In `routes/lenses.js`, the `GET /api/files/content` and
  `POST /api/files/upload` handlers use `fail(res, e)` instead of `res.status(500).json(...)`,
  so a TM1 "not found" comes back as 404 with TM1's own text. Change only these two handlers;
  the other hand-written 500s are a separate round. The route-table test must stay green.

## Target

```
client/src/components/dimension-editor/
  DimensionEditor.jsx        shell: wrapper + core (under 400 lines)
  DimensionToolbar.jsx       the two toolbar rows (today 1,426–1,597)
  ElementPanel.jsx           with HierarchyPlaces and AlternateBanner
  NewDimensionScreen.jsx
  StructureGrid.jsx
  tree/                      TreeNode.jsx FlatList.jsx AddRow.jsx DropLine.jsx WeightInput.jsx
  attrs/                     AttrGrid.jsx FormatPickerEditor.jsx NewAttrModal.jsx AttrHeader.jsx
  dialogs/                   BulkAddModal.jsx PreDeleteDialog.jsx
  hooks/                     one concern per hook:
    useDimensionData.js      elements, edges, index map, hierarchies, tree, filtered tree/list
    useElementActions.js     add root/child/bulk, drop, delete + pre-delete check, parents, weight, busy/error
    useHierarchySelection.js selected hierarchy, add hierarchy, hierarchy menu, from-attribute dialog
client/src/lib/dimension-editor/   pure functions, no React
  tree.js       buildTree, isUnder, buildTreeOrder
  constants.js  TYPE_ICON/COLOR/LABEL, COLOUR_HEX, TM1_FORMAT_PRESETS
  structure.js  parseTabDelimited
```

- No file over 600 lines. If `AttrGrid` can't get under that without changing behaviour, record
  the exception in the DONE file.
- `EditorPane.jsx` imports `@/components/dimension-editor/DimensionEditor`. No re-export shim is
  left behind.

## Steps

1. **Pure functions + tests.** Move the helpers and constants into `lib/dimension-editor/`.
   Test them with plain objects:
   - `buildTree` with roots, a shared child and an orphan edge;
   - `isUnder` on a cycle, which must not loop;
   - `buildTreeOrder` ordering;
   - `parseTabDelimited`: blank lines are dropped, a missing type becomes `N`, and a missing or
     bad weight becomes `1`.
2. **Tree, element panel and dialogs.** Move `DropLine`, `WeightInput`, `AddRow`, `TreeNode`,
   `FlatList`, `HierarchyPlaces`, `AlternateBanner`, `ElementPanel`, `BulkAddModal`,
   `PreDeleteDialog` and `NewDimensionScreen` to their files. Keep their props identical.
3. **Attribute grid and structure grid.** Move `FormatPickerEditor`, `NewAttrModal`,
   `AttrHeader` and `AttrGrid` into `attrs/`, and `StructureGrid` into its file.
   - Keep the column-width comment and behaviour exactly. Widths are read once and written only
     on a finished resize, and must never become React state.
   - Keep `ModuleRegistry` registration in one place.
4. **The convert-to-alias call behind a hook.** Add `useConvertToAlias()` (a mutation) to
   `hooks/useApi.js`. `AttrGrid` calls it, then keeps today's `refetch()` and toasts.
   - Keep the `window.confirm` as it is; this round doesn't change it.
   - After this step, no `get`/`post`/`request`/`apiFetch` import remains under
     `dimension-editor/`.
5. **State into hooks.** Cut `DimensionEditorCore` along the three hooks above.
   - Keep the memos' dependencies exactly.
   - `useElementActions` takes `refresh` and the selected hierarchy as arguments, rather than
     reading them a second way.
6. **Toolbar, shell and docs.**
   - Move the two toolbar rows into `DimensionToolbar.jsx`.
   - `dimension-editor/DimensionEditor.jsx` must be under 400 lines.
   - Update the CLAUDE.md Key Files entry (DimensionEditor becomes a folder) and
     `CONTRIBUTING.md`.
   - Record the final files, hooks and calls, and anything not done.

## Rules

- One commit per step, Step 0a and 0b included. Before each commit:
  - `npm test` passes;
  - `cd client && npm run build`, then commit `static/`;
  - client lint is at or below `client/lint-baseline.json`, and lower the baseline if the count
    drops;
  - root lint is 0.
- Do not push. Do not restart any server. Do not touch TM1.
- Any behaviour bug found while moving goes in `03_DIMENSIONEDITOR_SPLIT_QUESTIONS.md`, not into
  the split.

## When finished

`docs/ide/review/03_DIMENSIONEDITOR_SPLIT_FIXES_DONE.md`:
- one line per step, with its commit hash and test counts;
- lint before and after;
- the file and hook tables;
- the call moved;
- anything not done;
- the manual check list below.

## Manual check list for James

Only things the editor does today:

1. Open a dimension and switch the Tree, Flat, Attrs and Grid views. Type in the filter; it
   applies to Tree, Flat and Attrs.
2. Tree: add a root element, add a child, bulk-add children, drag an element to a new parent and
   position, and change a weight.
3. Select an element and check the element panel: parents, children, attributes and the other
   hierarchies it sits in.
4. Delete an element that is used, and check the pre-delete dialog lists where it is used. Then
   delete an unused one.
5. Switch hierarchy, add a new hierarchy, and create one from an attribute. Open an alternate
   hierarchy and check its banner.
6. Attrs: edit a value, add and delete an attribute, pick a format, and convert a string
   attribute to an alias. Resize a column, reopen, and check the width is kept.
7. Grid: paste tab-delimited structure and apply it.
8. Open Used in (cubes), the picklist builder and help.
9. Create a new dimension from the new-dimension screen.
10. Process editor: preview an empty ASCII file with a header row, which should show no rows
    instead of an error.
