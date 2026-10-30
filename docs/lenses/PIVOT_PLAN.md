# Shared Pivot — plan

Agreed Oct 21 2026. The pivot (slice-and-dice grid with hierarchy drill-down,
built on the free AG Grid) moves out of the IDE's View editor into one shared
component that the IDE and Lenses both use. Alongside it, two more pieces move
out: the member picker and the cell menu (rule breakdown, transaction log,
notes, write, copy).

## Why

- The pivot is the clever part we built ourselves: drill-down remembered per
  parent, stacked multi-dimension column headings, TM1 layout → MDX → grid.
  Pivoting is a paid AG Grid feature; ours runs on the free edition and knows
  TM1. It deserves to be one well-tested component, not code inside a
  2,500-line screen.
- Lenses need slice-and-dice (e.g. compare assumptions across companies)
  without a second copy that drifts apart.
- The View editor shrinks from ~2,550 lines to ~1,500 (≈1,000 once the rule
  breakdown and trace panels also move out).

## Order of work

1. **Pin today's behaviour in tests** — MDX builder, the drill-down / visible
   rows logic, stacked headings, the cellset conversion, the member picker's
   tree. Include tests that expose bugs 1–5 below.
2. **Build the shared pivot** from the IDE's code (no Tailwind; its own small
   stylesheet), fold in the improvements below, and run the step-1 tests
   against it.
3. **Lenses first** — `Lens.pivot` in the toolkit: chip bar (move dimensions
   between rows, columns, filters — only those the builder allows), a new
   read-only bridge call for element trees, the toolkit edit model. First use:
   Assumptions (compare companies side by side).
4. **Repoint the IDE** View editor to the shared pivot once it passes the
   tests and has been used in Lenses; delete the old IDE copy. No fixes to the
   old copy in the meantime — keep the two-copy window short.
5. Then split out the **member picker** and the **cell menu** (rule breakdown,
   transaction log, notes, write, copy) the same way, so a Lens cell gets the
   same right-click menu ("why is this number?", comments on cells).

## Review findings

### Keep
- Drill-down state per parent; stacked column headings; parents above/below
  children; "show parent" vs "replace with children".
- Column widths remembered per person; quick search; freeze top row; CSV
  export with labels; TM1 number formats; aliases.

### Bugs (fix in the move)
1. With 2+ dimensions on columns, only the first is checked for "is this a
   total?" — totals aren't shaded and open an edit box TM1 will refuse.
2. Indentation uses TM1's level (counted up from leaves), so uneven
   hierarchies indent wrongly — use depth from the top instead.
3. Names containing `]` or `"` break the MDX (no escaping in mdxBuilder).
4. View editor supports at most 4 dimensions per axis (fixed slots); a 5th
   silently loses its hierarchy.
5. Click-to-edit reads a column flag that's never set, so it disagrees with
   the "editable" rule.
6. (Found in step 1.) Pruning a tree to the returned members marks a total as a
   leaf when its children were filtered out — it then looks editable.

Progress: step 1 done (51d3db6), step 2 — shared/pivot (9c67c7a), step 3 —
Lens.pivot (99eda08, ⇄ swap fb595ed), step 4 — IDE View editor on the shared
pivot (5ffb890), old HierarchyGrid / lib/pivot-tree / core/mdxBuilder deleted
(Oct 21; tried on 24Retail Income Statement and WFP Workforce Cost). Step 5a —
member picker + Advanced (39ba9b6); step 5b — cell story: Why / Changes / Notes
(8704be8). Still to do: repoint the IDE's own member picker and right-click menu
to the shared ones; Advanced 'views' (choose a saved view) and aliases.

Step 1 detail (commit 51d3db6): the pure logic lives in
`client/src/lib/pivot-tree.js`; bugs 1–6 and items 12–13 are `todo` tests in
`tests/pivot-tree.test.mjs`, `tests/mdx-builder.test.mjs`,
`tests/view-cellset.test.mjs`.

### Scale
6. Visible rows are every combination first, then filtered — build them from
   the tuples TM1 actually returned.
7. Every typed cell re-runs the whole view (≈40 s on a cold cost cube) —
   update in place, refresh in the background.
8. Whole dimensions are fetched up front for drill-down — later: open to a
   level and fetch children on demand for big models.

### Entering data
9. Use the toolkit edit model: blue = typed not saved, Save / Undo, "still
   the old value?" check, History, live cursors. The IDE may keep
   "write immediately" as a setting.
10. **Paste from Excel** (free AG Grid has no clipboard) — straight after the move.
11. **Spreading** (type on a total, spread to leaves) — check what the TM1
    REST API offers first; separate piece of work.
12. Keep the real value and the display format separate (today values become
    display text before the grid sees them).

### Look and consistency
13. One colour scheme: grey = calculated, darker grey = total, blue = unsaved
    (the cellset's rule / total flags are currently dropped).
14. One AG Grid theme (IDE uses Balham, toolkit uses Quartz).
15. Collapse-all / expand-all for columns too (nice-to-have).
16. Today's toolkit grid features apply: stripes, fit to content, fit-all-rows
    height, builder "Save layout".

### Scope agreed
Fold in bugs 1–6 and items 6–9, 12–14 and 16 during the move; 10 straight after; 11 as its own
investigation; 15 when convenient.

## Shape of the shared component
- Input: a cube, a layout (rows, columns, filters; which dimensions may move),
  and a bridge for TM1 calls. Two modes: IDE (write immediately, full
  freedom) and Lens (save model, limited to what the builder allows).
- Tests: drill-down and visible rows, MDX with awkward names, cellset
  conversion with rule/total flags, the edit model, paste.

## What a Lens shows (agreed Oct 21)

Rule: **the builder decides the playground; the viewer plays inside it.** The
shared pivot can do everything the View editor does; a Lens exposes only part.

- **Always on:** drill-down, expand / collapse all, move and swap the dimensions
  the builder allows, pick filter members from the builder's list, stripes,
  column widths, layout remembered per person.
- **Behind an "Advanced" button** — each one only if the builder switches it on
  (`advanced: ['views', 'members', 'suppress', 'aliases', 'totals', 'csv', 'mdx']`):
  **choose a saved TM1 view** (from the views the builder names — loads its
  rows, columns, filters and subsets; needs a read-only bridge call for a
  view's layout, using the IDE's existing view reader),
  pick members / named subsets on an axis (the member picker, step 5, limited
  to subsets the builder names), suppress empty rows/columns, aliases, totals
  top/bottom, export to CSV, **copy MDX** (the pivot's current query, read-only —
  to take into the IDE or PAW).
- **MDX reaches planners through the builder**, never typed by them: dynamic
  named subsets the builder writes ("Over budget this month", "Hires next
  quarter", "Top 20 by cost") show up as plain choices; views built from MDX
  are offered through view selection. Typing MDX is a natural wall for most
  end users — and one bad query can tie up a large cube.
- **IDE only, never in a Lens:** writing MDX, building or saving subsets and
  views, moving locked dimensions, changing version or cube.

The view switch in a Lens is called **Pivot** (e.g. Assumptions: By month | Pivot).
Build the Advanced button after step 5, when the member picker exists.
