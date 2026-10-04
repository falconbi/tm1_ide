# Format Attribute Bugs & Fixes

## 1. Flat format map — cross-dimension collision (ROOT CAUSE)

**Problem:** `/api/dimensions/format-attrs` merged all dimensions' Format
attributes into one flat map: `{ "Input Total": "#,##0", "Amount": "$#,##0", ... }`.
When two dimensions had elements with the same name, one dimension's format
would silently override the other's. For example, "Input Total" in a
reconciliation/reporting dimension had `#,##0`, but the measure dimension's
"Amount" element had `$#,##0`. The lookup `elemNames.find(n => formatMap[n])`
would match "Input Total" first (because it appeared earlier in the row tuple),
giving `$136,125,015` the wrong format `#,##0` instead of `$#,##0`.

**Fix:** `format-attrs` now returns `{ dimName: { elemName: format } }`.
`lookupFormat(dim, elem, formatMap)` checks the element's own dimension first,
then falls back to searching all dimensions by element name.

**Files:** `server.js:831`, `ViewEditor.jsx:109`

---

## 2. Format lookup skipped row tuples

**Problem:** `cellsetToHierarchyData` only searched column tuple element names
and page members for format keys. In CST reconciliation views, the measure
dimension is on rows, so the match element (e.g. "Amount") was never found.
The code fell through to TM1's `FormattedValue`, which always includes `.00`
decimals regardless of the intended format.

**Fix:** Include row tuple element names in `allMembers` alongside column and
page members.

**File:** `ViewEditor.jsx:167-174`

---

## 3. TM1 FormattedValue overriding custom format

**Problem:** The original code had the priority: if format key found →
`applyTm1Format`, else → TM1's `FormattedValue`. But since bug #2 meant no
format key was found for row-measure views, TM1's `FormattedValue` was always
used, which includes `.00` decimals regardless of the format spec.

**Fix:** Row tuple search (bug #2) ensures the correct format key is found,
so `applyTm1Format` gets used with the right format string.

---

## 4. Percentage values stored pre-multiplied (`%/100`)

**Problem:** Some elements (e.g. "Driver Percentage Share") store percentage
values as already-multiplied numbers (10.1 for 10.1%) rather than TM1-standard
decimals (0.101 for 10.1%). `applyTm1Format` multiplies by 100 when the format
contains `%`, producing 1010% instead of 10.1%.

**Fix:** When format contains `%/100` (e.g. `#,##0.0%/100`), divide the value
by 100 before the standard percentage multiply — net effect: display the
stored value as-is with a `%` sign.

**File:** `ViewEditor.jsx:272-292`

---

## 5. Text colour from Format attribute

**Problem:** No way to distinguish `@`-formatted (text) cells visually from
numeric cells in the grid. The user wanted configurable text colour.

**Fix:** Convention: `@<colour>` in the Format attribute (e.g. `@blue`,
`@#ff0000`). The colour is extracted in `cellsetToHierarchyData` and passed as
`__colour` metadata. HierarchyGrid's `cellStyle` reads it and applies it as the
cell's `color` CSS property. The Format picker modal (Dimension Editor) shows
colour swatches and a native colour input when the format starts with `@`.

**Files:** `DimensionEditor.jsx:428-471,745-811`, `ViewEditor.jsx:182-193`,
`HierarchyGrid.jsx:487-505`

---

## 6. Format attribute cache not invalidated

**Problem:** `useMultiFormatAttrs` had `staleTime: 60_000` (60s cache). Changes
made in the Dimension Editor were not reflected in the ViewEditor until cache
expired or the page was hard-refreshed.

**Fix:** Added `formatVersions` to the Zustand store with `bumpFormatVersion`.
Called when a Format attribute is saved (both inline AG Grid edit and modal
Apply button). `useMultiFormatAttrs` includes the version in its query key,
forcing an immediate refetch on save.

**Files:** `store/index.js:360-363`, `useApi.js:299-310`,
`DimensionEditor.jsx:651-652,804-806`
