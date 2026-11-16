# 04 — Shared pivot and the grid: checked verdict

Claude checked OpenCode's `04_PIVOT_FINDINGS.md` against the code on 16 Nov 2026. Nothing fixed
yet. James decides.

## What was checked

| Claim | Result |
|---|---|
| Rejected immediate write restores `cell.v` but not `cell.d`, so the refused value stays on screen (`grid.js:390-402`) | **Confirmed** — the error branch does `cell.v = old; repaint()`; `cell.d` keeps the formatted new value |
| `dimOf` stops at the first `]`; `elementOf` handles `]]` (`cellset.js:15-22`) | **Confirmed** — `/^\[([^\]]+)\]/` vs the `]]`-aware pattern |
| `stripTm1TypePrefix` strips any string whose second character is `:` (`format.js:7-10`) | **Confirmed** — a text cell `1:30` becomes `30` |
| CSV exports raw values; `toText` (copy) uses `show()` with TM1 formats (`grid.js:523-545`) | **Confirmed** — `exportCsv` returns `p.value ?? ''`; `toText` formats |
| Every `GridToolbar` adds a `window` keydown listener for Ctrl+F / Ctrl+Shift+A (`GridToolbar.jsx:174-187`), three mount sites | **Confirmed** — in a split pane both grids react |

Not re-verified line by line: `setPivot` dropping held edits and the Lens rebuild (finding 6),
two themes (7), global appearance key (8), the `formatOf` cross-dimension fallback (11).
Consistent with the code shape seen.

## Ranked recommendations

1. **Display rollback on a refused write.** Restore `cell.d` alongside `cell.v` in the error
   branch; extend `shared-pivot-grid.test.js:137-153` to assert the display. *Small. A user sees
   a value TM1 rejected as if it were saved.*
2. **`dimOf` and `stripTm1TypePrefix`.** `dimOf` uses the same `]]`-aware pattern as `elementOf`;
   `stripTm1TypePrefix` only strips when the prefix is a known TM1 type letter (`c`, `n`, `s`…)
   and the rest parses as the value. Tests in `shared-pivot.test.mjs`. *Small. Correctness.*
3. **Shortcuts scoped to the focused grid.** The toolbar's keydown listener attaches to the
   grid's container (or checks `document.activeElement` is inside it), not `window`. Test with
   two toolbars mounted. *Small. Split panes misbehave today.*
4. **Edit lifecycle contract.** `setPivot` refuses, or returns a conflict, when `orig.size > 0`
   in save mode; the Lens uses `setPivot` for data refreshes and destroy/recreate only when the
   column set changes. Write the rule in the `grid.js` header. *Medium. Blue "typed, not saved"
   cells can vanish on a background refresh.*
5. **CSV vs copy: decide, then document.** Options: CSV formatted like the screen (what Excel
   users expect from "export what I see"), or CSV raw with a note in the toolbar tooltip. Either
   is fine; today it is undocumented. *Small.*
6. **Grid contract header.** Add `state`, `toText`, `fitColumns`, `resetWidths` to the method
   list in `grid.js:28-31`; mark `docs/lenses/PIVOT_PLAN.md` items done / pending / dropped
   (the shared cell menu is dropped: the IDE's is Trace-only). *Small.*
7. **Theme and appearance: name the decision.** "The host supplies the theme; the toolkit
   default is Quartz" in `PIVOT_PLAN.md`; rename the appearance setting as a global user
   preference (or make its key per view) and remove the duplicate `useGridAppearance` in
   `PivotGrid.jsx:34-36` when `appearance` is passed in. *Small.*
8. **`formatOf` fallback** (`cellset.js:27-31`): prefer the measure dimension, then an explicit
   fallback, never "any dimension with that element name". *Small.*
9. **Tests** for all of the above, using the two harnesses that already exist. *Small/medium.*

## Keep as the model (agreed)

The pure modules (`tree.js`, `mdx.js`, `cellset.js`, `format.js`) with their tests; one factory
(`createPivotGrid`) used by both `PivotGrid.jsx` and `Lens.pivot`; jsdom tests that draw the real
bundle; no React in the toolkit. This is the shape the five big editors (area 03) should be
brought to.

## Carried over from area 02 fixes

`core/git-review.js` is now unreferenced (its only route was deleted as dead). Recommendation:
delete it; review is done through `/api/git/drift`. James to confirm.
