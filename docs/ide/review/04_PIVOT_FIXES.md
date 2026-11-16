# 04 — Shared pivot and the grid: fix brief (round 1)

Build brief for OpenCode. Source: `04_PIVOT_VERDICT.md` items 1–9, agreed by James 16 Nov 2026.
Decisions: CSV exports **formatted** values, as shown on screen; `core/git-review.js` is deleted.
Read `04_PIVOT_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` (the pivot is bundled
  into `static/` and `static/lens-kit`; rebuild and commit `static/` whenever `shared/` or
  `client/src` changes), `cd client && npx eslint src` (133 or fewer).
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/04_PIVOT_FIXES_QUESTIONS.md`.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2, 3 and 4.

## Step 0 — Delete `core/git-review.js`

No caller since area 02 removed `/api/deploy/git/review`. Grep for `git-review` across the repo
(paste the result), delete the file and any test that only tested it, and remove its mention
from `docs/deploy/*.md` if any.

## Step 1 — Display rollback on a refused write (bug)

`shared/pivot/grid.js:390-402`, immediate mode: the error branch sets `cell.v = old` but leaves
`cell.d` as the formatted new value. Restore the display too (`cell.d = show(cell, '')` after
restoring `v`, or keep `oldD` alongside `old`). Extend `tests/shared-pivot-grid.test.js:137-153`
to assert the rendered text after a rejected write equals the text before it.

## Step 2 — `dimOf` and `stripTm1TypePrefix` (bugs)

- `shared/pivot/cellset.js:15-17`: `dimOf` uses the same `]]`-aware pattern as `elementOf`:
  `^\[((?:[^\]]|\]\])*)\]` with `]]` → `]`.
- `shared/pivot/format.js:7-10`: only strip when the prefix is a TM1 type letter. TM1's
  FormattedValue prefixes are single letters followed by `:`; restrict to `/^[a-z]:/i` **and** the
  cell is numeric (`typeof value === 'number'`) or the caller says so. A text cell `1:30` must
  come through unchanged. If the exact set of letters is in `docs/ide/Planning Analytics.postman_collection.json`
  or an existing comment, use that; otherwise `[cnsCNS]` and say so in a comment.
- Tests in `tests/shared-pivot.test.mjs` for both, including the `1:30` case and a dimension
  name `A]B`.

## Step 3 — Shortcuts scoped to the focused grid (bug)

`client/src/components/GridToolbar.jsx:174-187` adds a `window` keydown listener for Ctrl+F and
Ctrl+Shift+A; three toolbars can be mounted (split panes), and all react. Attach the listener to
the toolbar's grid container (a ref passed from `PivotGrid`/the host), or keep `window` but
act only when `document.activeElement` is inside that container or the toolbar itself. Test with
two toolbars mounted in jsdom: a Ctrl+F while focus is inside grid A opens A's search only.

## Step 4 — CSV formatted like the screen (bug; decided)

`shared/pivot/grid.js` `exportCsv`: use the same `show()` path as `toText` so CSV cells match
what is displayed (TM1 Format applied). Row-label columns unchanged. Tooltip on the CSV button:
"Export as CSV (values as shown)". Test: a cell with format `#,##0.00` exports as `1,234.50`.

## Step 5 — Edit lifecycle contract

`shared/pivot/grid.js:492-501` `setPivot` clears `orig` (held save-mode edits) without warning.
- `setPivot` returns `false` and does nothing when `o.edit === 'save'` and `orig.size > 0`,
  unless called with `{ force: true }`; the host decides. `Lens.pivot` (`shared/lens-kit/index.js`
  ~802-840) uses `setPivot` for data-only refreshes and destroy/recreate only when the column set
  changes; when `setPivot` refuses, the Lens shows its existing "unsaved changes" state rather
  than silently losing them.
- Write the rule in the `grid.js` header block.
- Test: `setPivot` with held edits returns `false` and keeps the blue cells; with `force` it clears.

## Step 6 — Grid contract header and plan status

- `grid.js:28-31`: add `state`, `toText`, `fitColumns`, `resetWidths` to the method list, one
  line each.
- `docs/lenses/PIVOT_PLAN.md`: mark each open item done / pending / dropped. The shared cell menu
  is **dropped** (IDE menu is Trace only). Themes: "the host supplies the theme; the toolkit
  default is Quartz" — a decision, not a to-do.

## Step 7 — Appearance setting named for what it is

`client/src/lib/grid-appearance.js:12` uses one key for every grid. Keep it global, but: rename
the popover title to "Grid format (all grids)", fix the file comment, and remove the duplicate
`useGridAppearance()` in `PivotGrid.jsx:34-36` when an `appearance` instance is passed in.

## Step 8 — `formatOf` fallback

`shared/pivot/cellset.js:27-31`: when the current dimension has no format for the element, try
the measure dimension (last dimension of the cube, or the one the host names), then give up;
never "any dimension with that element name". Test with two dimensions sharing an element name.

## When finished

`docs/ide/review/04_PIVOT_FIXES_DONE.md`: one line per step, commit hash, tests before and after,
lint, anything not done and why.
