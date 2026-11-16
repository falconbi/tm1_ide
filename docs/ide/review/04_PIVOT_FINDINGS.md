# 04 — Shared pivot and the grid: findings

Reviewed 16 Nov 2026, read-only. Scope: `shared/pivot/` (tree, mdx, cellset, format, grid,
picker, index), `client/src/components/PivotGrid.jsx`, `GridToolbar.jsx`,
`client/src/lib/grid-appearance.js`, the Lens kit's `Lens.pivot`/member picker use, and the
pivot tests. No code changed, no server restarted, no TM1 call.

Method: read every file in the scope, traced both hosts (IDE View editor and Lens), inspected the
pure tests and the jsdom AG Grid tests, and checked the documented contract in
`docs/lenses/PIVOT_PLAN.md` and the grid's own header. The shared pivot is in good shape: pure
logic, real tests, one grid for two products. The findings are mostly edge cases in the cell/edit
model and two host-integration behaviours.

## What's good — keep as the model

- **Pure logic is separated.** `tree.js`, `mdx.js`, `cellset.js` and `format.js` are plain
  functions with no DOM or React; `shared-pivot.test.mjs` pins the drill-down, escaping,
  suppression, totals and widening rules. This is the cleanest part of the client code.
- **One grid, two products.** `PivotGrid.jsx` is a small React wrapper; `Lens.pivot` uses the
  same `createPivotGrid` factory. Host-specific behaviour is passed in, not forked.
- **The AG Grid work is real.** Pinned row labels, stacked headers, remembered widths, frozen top
  row, quick search, CSV, single-click edit and the shared cell colours are all implemented on
  the free Community edition.
- **The grid tests draw the real bundle.** `shared-pivot-grid.test.js` runs the toolkit in jsdom
  and asserts rendered labels, colours, typing rules and immediate/save behaviour — not just
  private functions.
- **The Lens picker and edit model are plain JS.** No React dependency leaks into the toolkit.

---

## 1. A rejected immediate write restores the value but not the display

`shared/pivot/grid.js:390-402` (immediate mode):

```js
const old = cell.v, nv = p.newValue
cell.v = nv
...
.catch(e => { pending.delete(key); cell.v = old; repaint(); onError(e) })
cell.d = ...formatted new value...
```

On rejection the old `v` is restored, but `cell.d` still holds the **new** display text. `show()`
(`grid.js:211-215`) returns `cell.d` for a non-held cell, so the grid keeps showing the value TM1
refused. The existing test (`tests/shared-pivot-grid.test.js:137-153`) asserts `.v` only, so it
passes.

**Why it matters:** the user sees an edit that the server rejected until a later data load. It is
the opposite of the promise in the file header (“rejects → value put back”).

**Suggested fix:** save `oldD = cell.d` before setting the new value; on rejection restore both
`cell.v = old` and `cell.d = oldD` (or reformat from `old`), then repaint. Add the display assertion
to the existing test. Effort: **small**.

## 2. `dimOf` cannot read a dimension name containing `]`

`shared/pivot/cellset.js:15-17`:

```js
export function dimOf(uniqueName) {
    return uniqueName?.match(/^\[([^\]]+)\]/)?.[1] ?? ''
}
```

`elementOf` (`cellset.js:19-23`) correctly accepts `]]` as an escaped `]`, and `mdx.js:9-11`
escapes `]` when building a query — but `dimOf` stops at the first `]`. A dimension named `A]B`
comes back as `A`, so format lookup (`formatOf`), labels and the per-cell `dim` are wrong. The
pure test at `tests/shared-pivot.test.mjs:154-158` checks `elementOf`, not `dimOf`.

**Why it matters:** the pivot promises to handle names with `]` (bug 3 in `PIVOT_PLAN`), and the
MDX side does; the reading side does not.

**Suggested fix:** use one bracket parser for both:
`^\[((?:[^\]]|\]\])*)\]$` then replace `]]` with `]` for the dimension; or share a
`firstBracketPart()` helper with `elementOf`. Add a `dimOf` round-trip test. Effort: **small**.

## 3. `stripTm1TypePrefix` treats any second-character colon as a type prefix

`shared/pivot/format.js:7-10`:

```js
if (typeof fv === 'string' && fv.length > 2 && fv[1] === ':') return fv.slice(2)
```

A string cell whose text is `A:B` or a time-like `1:30` loses its first two characters. The code
is applied to any `FormattedValue`, not just numeric ones. `applyTm1Format` itself uses a
narrower `/^[a-z]:/` test (`format.js:17`), so the two rules disagree about what a prefix is.

**Why it matters:** text measures are common in TM1 (comments, status, periods), and this is
silent data loss in the display path.

**Suggested fix:** accept only the known TM1 type codes (at minimum a letter followed by `:`), or
use the same lowercase-letter rule as `applyTm1Format`; add tests for `A:B`, `1:30` and a real
`c:12345` prefix. Effort: **small**.

## 4. CSV exports raw values, the screen shows TM1 formats

`shared/pivot/grid.js:536-545` exports `p.value` for data cells. `toText` (`523-534`) uses
`show(...)`, which applies the TM1 format. The video scripts say CSV carries what is on screen /
the member labels (`docs/video/VIEWS_AND_DATA_NARRATION.md:93`,
`docs/video/VIEWS_AND_DATA_GRID_NARRATION.md:98`), and `PivotGrid` exposes the same CSV button.

So a `0.03` cell displayed as `3.0%` exports as `0.03`; an accounting `(1,000)` exports as
`-1000`. Labels are included, values are not formatted.

**Why it matters:** “CSV exports exactly what is on screen” is a user promise; choosing raw
values may be correct for re-import, but then the docs and the button label need to say so. Two
exports (CSV and `toText`) currently disagree.

**Suggested fix:** apply `show()` in `exportCsv` (or add a “raw/displayed” option); align
`toText` and CSV. Effort: **small**.

## 5. Every `GridToolbar` listens to Ctrl+F and Ctrl+Shift+A globally

`client/src/components/GridToolbar.jsx:169-189` attaches a `window` keydown listener per toolbar
instance. In a split workspace with two View editors (or a pivot and a flat grid), pressing
Ctrl+F focuses/selects **every** toolbar's search input; the last listener wins. Ctrl+Shift+A
runs `onFit` for every grid at once.

**Why it matters:** the IDE is explicitly a split-pane editor; a shortcut that silently acts on
another pane is confusing and hard to undo (it resizes columns).

**Suggested fix:** scope the handler to the active pane (e.g. only the grid whose container
contains `document.activeElement`, or a shared active-grid context), or attach to the grid host
instead of `window`. Add a two-toolbar test. Effort: **small**.

## 6. `setPivot` silently drops held edits; the Lens rebuilds the whole grid

- `shared/pivot/grid.js:492-501`: `setPivot()` calls `orig.clear()` and redraws. In save mode
  (`Lens.pivot`) that is the list of typed, unsaved values; nothing warns and `onEdit` is not
  told. The public `refresh()`/`load()` path can call it while edits are held.
- `shared/lens-kit/index.js:802-816` (and `:836-840`): every layout change calls `rebuild()`,
  which destroys the existing grid and creates a new one. Only a drill keeps state; scroll
  position, focus and the active cell are lost.

**Why it matters:** the edit model promises “blue = typed, not saved”; a background refresh can
make blue cells disappear. Recreating the grid on every chip move is also heavier than needed.

**Suggested fix:** make `setPivot` refuse (or return a conflict) when `orig.size > 0`, or keep
edits keyed by tuple across the new data; use `setPivot` for data-only refreshes and reserve
destroy/recreate for layout changes that alter the column set. Document the contract in the
header. Effort: **medium**.

## 7. Two AG Grid themes remain, while the plan says one

`docs/lenses/PIVOT_PLAN.md:95` lists “One AG Grid theme (IDE uses Balham, toolkit uses Quartz)” as
an item to fold in. The code still does both: `shared/pivot/grid.js:425-429` defaults to
`themeQuartz`, while `client/src/lib/grid-appearance.js:30-31` builds `themeBalham` and
`PivotGrid` passes `makeTheme`.

A host-specific theme is a reasonable design, but it is not documented as the decision; a
forker reading the plan thinks the split is a bug, and a Lens grid and an IDE grid still look
different in the same product family.

**Suggested fix:** either unify or change the plan/doc to “the host supplies the theme; the
toolkit default is Quartz”. Effort: **small**.

## 8. `grid-appearance` is global, not per-grid

`client/src/lib/grid-appearance.js:12` uses one key, `tm1-grid-appearance`, for every grid. The
file comment says “per-grid display settings”; `PivotGrid.jsx:34-36` creates its own
`useGridAppearance()` even when an `appearance` instance is passed in, and that unused instance
still writes the same key. Changing the Format popover in one grid changes every grid for that
browser, with no explanation in the toolbar.

**Why it matters:** the toolbar says “Grid format options”, not “all grids”; a forker may expect
per-view settings (the rest of the view state is per tab).

**Suggested fix:** either make the key per view/grid, or rename/document the setting as a global
user preference and remove the extra `useGridAppearance` in `PivotGrid` when `appearance` is
supplied. Effort: **small**.

## 9. Documentation drift in the grid contract

- `shared/pivot/grid.js:28-31` lists `changes/undo/saved/setPivot/expandAll/quickFilter/
  freezeTop/stripes/exportCsv/destroy/setOptions` but omits `state`, `toText`, `fitColumns` and
  `resetWidths` — all used by `PivotGrid` or `Lens.pivot` (`PivotGrid.jsx:68-69`,
  `lens-kit/index.js:729` and `:805`).
- `docs/lenses/PIVOT_PLAN.md` still lists open items (IDE member picker/right-click menu,
  Advanced views/aliases) without saying whether they are abandoned or pending; the IDE
  `CellContextMenu` is currently Trace-only (see area 03), while the plan implies a shared cell
  menu.

**Why it matters:** the header is the API reference a forker copies. Missing methods means they
reimplement width reset or clipboard export.

**Suggested fix:** complete the header block; mark the plan items done, pending or dropped.
Effort: **small**.

## 10. The tests miss the cases above

The pure and jsdom suites are strong on drill-down, MDX escaping, suppression, stacked headers,
colour/typing rules and save/immediate modes. They do **not** cover:

- display rollback after a rejected immediate write (only `.v` is asserted,
  `tests/shared-pivot-grid.test.js:137-153`);
- `dimOf` with a dimension name containing `]` (only `elementOf` is tested,
  `tests/shared-pivot.test.mjs:154`);
- `stripTm1TypePrefix` on a non-prefix colon (`format.js`);
- CSV number formatting (`exportCsv`);
- two `GridToolbar` instances and the global shortcut conflict;
- `setPivot` with held save-mode edits, and Lens rebuild state.

**Why it matters:** the first three are correctness, the last three are user-visible behaviour;
all are cheap to pin with the existing harnesses.

**Suggested fix:** extend `shared-pivot-grid.test.js` for display rollback and two-toolbar
shortcuts; extend `shared-pivot.test.mjs` for `dimOf`/`stripTm1TypePrefix`; add a CSV formatter
test. Effort: **small/medium**.

## 11. Smaller

- `formatOf` (`cellset.js:27-31`) falls back to **any** dimension's map when the current one has
  no entry. With repeated element names (e.g. `Amount`, `Total`), a cell can pick up another
  dimension's format. Prefer the measure dimension or an explicit fallback list.
- `grid-appearance` `refreshKey` omits `zebra` (handled separately) and `numFormat` (a host
  pipeline concern); the comment says row height/font/accent only — accurate, but worth keeping
  in mind when adding settings.
- `openMemberPicker` allows more than one picker at a time; each click opens a new popup rather
  than closing the previous one (`shared/pivot/picker.js`). Minor.

**Checked and found nothing:** no duplicate pivot implementation in the client; every
`shared/pivot` module is consumed (grid by `PivotGrid`/`Lens`, picker by `Lens`, pure modules by
tests); no `TODO`/`FIXME`; the free AG Grid Community edition is used consistently; the pure
logic has no DOM dependency.

---

**Overall:** start with **1 (display rollback)**, **2 (`dimOf`)**, **3 (colon prefix)** and
**4 (CSV/display)** — small, isolated, testable. Then **5 (shortcuts)** and **6 (edit lifecycle)**
before touching the larger host integrations. Keep the pure-module/test shape: it is why the
first four are easy to fix.
