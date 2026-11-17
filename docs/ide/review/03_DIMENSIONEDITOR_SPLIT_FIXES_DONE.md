# 03 — Split DimensionEditor (editor split 4 of 5)

Completed 17 Nov 2026. One commit per step, Steps 0a and 0b included. Behaviour is unchanged
except the two Step 0 fixes. The screen, buttons, requests and query keys are the same.

| Step | Commit | Tests |
|---|---|---|
| 0a — Empty ASCII preview returns numbered columns | `370447c` | 540 (539 pass, 1 skip) |
| 0b — File read/upload keep TM1's status | `185ad84` | 540 (539 pass, 1 skip) |
| 1 — Pure helpers and tests out | `af2a3d2` | 549 (548 pass, 1 skip) |
| 2 — Tree, element panel and dialogs out | `6c570d1` | 549 (548 pass, 1 skip) |
| 3 — Attribute and structure grids out | `5fcb3c5` | 549 (548 pass, 1 skip) |
| 4 — Convert-to-alias behind a mutation | `eda7070` | 549 (548 pass, 1 skip) |
| 5 — State into the three hooks | `f6a8eeb` | 549 (548 pass, 1 skip) |
| 6 — Toolbar, shell and docs | this commit | 549 (548 pass, 1 skip) |

Final: **549 tests, 548 pass, 1 skipped, 0 fail**. Client lint **116 → 115** (baseline lowered
to 115); root lint **0**. `dimension-editor/DimensionEditor.jsx` is **173 lines**.

## Files

| File | Lines | What |
|---|---:|---|
| `dimension-editor/DimensionEditor.jsx` | 173 | shell: wrapper + core; hooks, loading state and body |
| `dimension-editor/DimensionToolbar.jsx` | 188 | the two toolbar rows, HelpPanel, alternate banner, from-attribute dialog |
| `dimension-editor/ElementPanel.jsx` | 167 | element panel with HierarchyPlaces and AlternateBanner |
| `dimension-editor/NewDimensionScreen.jsx` | 45 | new-dimension screen |
| `dimension-editor/StructureGrid.jsx` | 125 | Element/Parent/Weight bulk grid |
| `dimension-editor/agGrid.js` | 10 | one AG Grid module registration and the shared themes/column defaults |
| `dimension-editor/tree/TreeNode.jsx` | 100 | recursive tree node |
| `dimension-editor/tree/FlatList.jsx` | 39 | flat element list |
| `dimension-editor/tree/AddRow.jsx` | 52 | inline add row |
| `dimension-editor/tree/DropLine.jsx` | 18 | drag placement line |
| `dimension-editor/tree/WeightInput.jsx` | 13 | weight field |
| `dimension-editor/attrs/AttrGrid.jsx` | 303 | attribute grid (column widths stay grid state) |
| `dimension-editor/attrs/FormatPickerEditor.jsx` | 65 | format cell editor |
| `dimension-editor/attrs/NewAttrModal.jsx` | 37 | new attribute modal |
| `dimension-editor/attrs/AttrHeader.jsx` | 32 | stable grid header |
| `dimension-editor/dialogs/BulkAddModal.jsx` | 95 | bulk add elements |
| `dimension-editor/dialogs/PreDeleteDialog.jsx` | 77 | pre-delete check dialog |
| `lib/dimension-editor/tree.js` | 58 | `buildTree`, `isUnder`, `buildTreeOrder` |
| `lib/dimension-editor/constants.js` | 36 | type icons/colours/labels, colour regex, format presets |
| `lib/dimension-editor/structure.js` | 9 | `parseTabDelimited` |
| `tests/dimension-editor-split.test.mjs` | 91 | 10 plain-object tests for the pure helpers |

## Hooks

| Hook | Lines | Owns |
|---|---:|---|
| `hooks/useDimensionData.js` | 52 | elements, edges, index map, hierarchies, usage, attribute values, tree, filtered tree/list |
| `hooks/useElementActions.js` | 139 | add root/child/bulk, drop, delete + pre-delete check, parents, weight, busy/error, delete dialog state |
| `hooks/useHierarchySelection.js` | 37 | selected hierarchy, add hierarchy, hierarchy menu, from-attribute dialog |

`useElementActions` takes `refresh` and `selectedHierarchy` as arguments. `refresh` is the plain
data refetch from the shell; the hook wraps it once to clear its own `error`, which keeps the old
`refresh()` behaviour for the structure grid. The hooks keep `DimensionEditorCore`'s remaining
state to the ten UI values (view, selection, index toggle, add/bulk flags, used-in, filter,
picklist, help, dragged element).

## Direct call moved

| Old call | New owner |
|---|---|
| `POST /api/dimension/attribute/convert-to-alias` in `AttrGrid` | `useConvertToAlias()` mutation in `hooks/useApi.js`; `AttrGrid` keeps its confirm, `refetch()` and toasts |

No `get`/`post`/`request`/`apiFetch` import remains under `components/dimension-editor/`.

## Not done / notes

- All six steps (plus 0a and 0b) are complete.
- No file needed the “over 600 lines” exception; `AttrGrid` is 303 lines.
- `agGrid.js` is the one file outside the brief's target list. It holds the single
  `ModuleRegistry` registration and the themes/column defaults shared by `AttrGrid` and
  `StructureGrid`, so the registration stays in one place.
- `isUnder` gained a `seen` guard. Without it the required cycle test would loop forever on a
  malformed cycle; behaviour on valid trees is identical.
- The only intentional behaviour changes are the two Step 0 fixes, both recorded in
  `docs/ide/BUG_FIXES.md`; ProcessEditor question 1 is marked done.
- No behaviour bugs were found while moving.

## Manual check list for James

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
