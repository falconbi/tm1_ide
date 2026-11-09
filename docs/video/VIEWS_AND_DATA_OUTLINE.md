# Views and data — script outline

Views and data only — no TI. Follows: **Model Structure**. Next: **Cube Map**.
Checked against the View Editor code on 9 Nov 2026. The full spoken script is
[VIEWS_AND_DATA_NARRATION.md](VIEWS_AND_DATA_NARRATION.md); it still has to be brought in line with this outline.

- **Cube:** WFP Workforce Cost
- **View:** Cost by Cost Centre (native; Cost Centre on rows, 2026 Quarters + FY on columns,
  Budget / Group / Reporting / Cost to Company / Amount as filters)
- **Recording note:** don't save the view; every change stays on screen only.

---

## Intro (~20s)

Explorer showing WFP Workforce Cost. The promise: open a view, shape it, read the grid properly, and
trace any number back to where it came from. One cube and one view throughout.

## 1. Opening a view (~25s)

- Explorer → WFP Workforce Cost → Views → Cost by Cost Centre.
- The **Native** badge: what kind of view this is, and why most models are full of them (the kind
  TI uses as a datasource).
- What the layout means: cost centres down the side, 2026 quarters and FY across the top, and
  everything else fixed in the filter, so every number is the full budgeted cost.

## 2. Rearranging by dragging (~50s)

- Drag **Version** from the filter onto the columns, press **Ctrl+Enter**, and versions appear side
  by side under each quarter. Drag it back.
- **The Bench**: dimensions the view doesn't use, and alternate hierarchies (cost centres by
  location), each one drag away. *(Check what the Bench shows before recording.)*
- **Sessions**: save the layout as a named local draft to come back to; it never touches the saved
  view.

## 3. Subsets and hierarchies (~40s)

- Click the **WFP Period** pill: the named subset **2026 Quarters + FY**, defined once and used by
  every view that references it.
- Switch to another saved subset, or search and tick members for a one-off look. "Select all leaf
  members under this consolidation" ticks a whole branch in one click.
- **Open in Subset Editor** when the subset you need doesn't exist yet.
- The **Hierarchy** choice on a pill: an alternate hierarchy rolls the same elements up another
  way, and the axis tree changes with it.

## 4. The same view as MDX (~40s)

- Switch to **MDX**: the IDE writes this exact layout as an MDX query. It's a good way to learn MDX.
- The amber warning: saving from MDX mode makes it an MDX view for good.
- **Builder** (the Guided MDX Builder): choose the cube, place each dimension and pick members, and
  it writes the MDX as you go. **Execute** runs it before anything is saved.
- Switch back to **Visual**.

## 5. Working the grid (~55s)

- Right-click a total: **Expand all levels below · Expand this level for all · Show leaves only ·
  Keep only this · Remove this**.
- **Suppress empty** (rows, columns or both): saved with the view.
- **Row totals** top or bottom, and **column totals** left or right.
- **Freeze top row** keeps the first row pinned while you scroll.
- **Flat** turns the hierarchy into a plain list; click a header to sort.
- **Fit columns** (Ctrl+Shift+A), **Reset widths**, **Search** the grid, and **CSV** of what's on
  screen.
- Numbers follow each element's **Format** attribute (Dimension Editor), so money looks like money.

## 6. Trace a number (~50s)

- Right-click a cell → **Trace**.
- **Consolidated:** its children and their values; click one to go down a level.
- **Rule:** the rule, and how each part works out for this cell, with live values.
- **DB lookup:** **Trace this value** carries on into the other cube.
- Follow it all the way down to typed-in data or a process load. That's the whole story of one
  number, without leaving the view.

## 7. Tips (~20s)

- **Ctrl+Enter** refreshes, **Ctrl+S** saves, **Ctrl+Shift+S** saves as.
- **Sessions** to try layouts without risk; reopen the view to get back to the saved layout.
- **Log** on the toolbar: who changed the selected cell, over the last day by default.

## Outro (~15s)

Recap: open a view, rearrange it by dragging, choose subsets and hierarchies, see or build it as MDX,
work the grid, and trace any number. Next: **the Cube Map**, reading the whole model on one page.

---

Total about **5 min 15 s**. The easiest cuts: Tips (−20s), Sessions in section 2 (−8s), Builder in
section 4 (−15s).

**Not in the IDE** (so not in the script): a view switcher or recent-views list, freezing the first
column, and a column-alignment setting.
