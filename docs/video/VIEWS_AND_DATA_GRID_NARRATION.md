# Views & Data: the grid demo — video script

A demo, not a tour of the editor. Open one view, do five things that look hard, then explain the grid underneath.
Model: **WFP Workforce Cost**. View: **Cost by Cost Centre**.

Runtime about **5 minutes**. Don't save anything.

---

## Cold open (~30s)

*Open Cost by Cost Centre. Execute.*

This is Cost by Cost Centre. Cost centres down the side, quarters and the full year across the top, everything else fixed in the filter.

Before I explain anything, three things.

*Right-click a total → Show leaves only.* The group total disappears and I'm looking at the cost centres underneath it.

*Type into a leaf cell. It turns blue, then settles.* That number is now in TM1.

*Right-click a cell → Trace.* Here's where the number comes from, down to the rule and the cube it reads.

That's the whole video: a grid that behaves like TM1, not like a spreadsheet. Everything else is why.

---

## 1. One grid, two doors (~25s)

*Click a saved view, then click a cube directly.*

A View is a saved layout in TM1. Data is the ad-hoc grid you get from opening a cube. Same editor, same grid — the only difference is where the layout came from.

The same grid also runs inside a Lens. *Switch to a Lens, drag a dimension chip.* Same drill-down, same colours, same edit rules. That's deliberate: one component, so a fix lands everywhere.

---

## 2. Drill-down that remembers (~70s)

*Expand Q1 under North. Then expand Q1 under South. Then collapse North's Q1.*

Watch the state. Q1 is open under North and closed under South. Open state is remembered **per parent**, not per dimension. That's how a planner actually reads a model — one branch at a time.

Now the interesting case. *Right-click a total whose children weren't in the query → Expand all levels below.*

The grid doesn't fake it. It asks the server for the members below that total, remembers what should be open, and when the data comes back it opens exactly there. If that would add more than two thousand rows, it asks first.

*Right-click a heading.* Expand, expand all levels below, collapse, expand this level for all, show leaves only, keep only this, remove this. Those are real TM1 actions, not a generic grid menu.

And the indentation is by depth from the top, not TM1's level number, so an uneven hierarchy lines up. Repeated outer labels are replaced with a thin bar, so you follow the tree instead of reading the same region twenty times.

---

## 3. Columns that stack (~35s)

*Drag Version from the filter onto Columns.*

The grid redraws itself. Version sits under each quarter. Two dimensions on columns means two header lines — each dimension gets its own line, and the header height grows with it. This used to be capped at four dimensions; now it isn't.

*Open a consolidation in the column header.*

Same drill-down as rows. *Right-click the header.* Same member menu. Columns aren't second-class.

*Drag Version back.*

---

## 4. Cells you can trust (~50s)

*Point at a grey cell, a darker bold cell, a leaf.*

Grey is calculated by a rule. Darker bold is a total. White is input. Those colours come from the cellset itself — TM1 tells us whether a cell is consolidated, rule-derived or an input, and whether it's updateable.

*Click a total. Nothing opens. Click a leaf input cell. The editor opens.*

That's the rule. Both axes must be leaves, the cell must be an input cell, and TM1 must have marked it updateable. You can't type into a total and find out later.

*Type into a percentage cell, then a text cell.*

Percentages parse as percentages. Text stays text. And the number format is TM1's own format — `#,##0.00`, `0.0%`, accounting parentheses, the `@` text and colour formats — so what you see is what TM1 would show you.

---

## 5. The write (~35s)

*Type a value. Blue cell, "Written" toast.*

In the IDE it writes straight away. The cell updates optimistically, the write goes to TM1, and if TM1 refuses, the old value comes back and the error is shown. No silent corruption.

The same grid in a Lens runs in save mode: typed values stay blue until Save, and each one is checked against the value the person started from. Same component, different edit model — the host passes `immediate` or `save`.

---

## 6. The bits that make it feel like an IDE (~45s)

*Toolbar: Fit, Reset, Freeze top, Format, Search, CSV.*

Freeze top genuinely pins the first row; it doesn't copy it. Search filters as you type. CSV carries the member labels, not internal keys. Fit sizes to content, Reset forgets my widths, and my widths come back next time I open this view.

*Open Format. Change zebra, row height, accent colour.*

Those settings persist per user and feed a custom AG Grid theme, so the grid matches the IDE instead of looking like a stock widget. Row height, font size, header tint, header weight, accent colour, number formatting — all live.

---

## 7. Why AG Grid (~45s)

*Return to the grid, scroll fast.*

This is AG Grid — the free Community edition. Three things it gives us: it only renders the visible rows, it pins and resizes columns properly, and it exposes theme parameters so the grid can look like the app.

What it does *not* give us is a TM1 pivot. AG Grid's own pivot is an Enterprise feature, and even if it weren't, it wouldn't know what a consolidation is, or a rule, or a leaf, or a subset. So we kept the free grid and built the TM1 layer ourselves.

That layer is the part you just watched: drill state per parent, opening members the query didn't return, stacked TM1 headers, totals above or below children, editability from the cell's real state, and TM1 number formats.

One shared pivot. The IDE wraps it and adds a toolbar; a Lens calls the same factory and gets the same behaviour. So the answer to "does the Lens grid work like the View grid?" is: it is the View grid.

---

## Close (~15s)

*Open a view, drill a total, type a number, trace it.*

That's Views and Data: one grid, shaped around TM1. Next, how the same grid powers Lenses.

---

## Recording notes

- **Aha moments to hit:** per-parent drill state; opening a total the query never returned; a total refusing an edit while a leaf accepts one; Trace landing on a rule and a DB lookup.
- **Avoid:** explaining AG Grid before showing the grid. The demo earns the explanation.
- **Proof points if needed on screen:** `shared/pivot/grid.js`, `shared/pivot/tree.js`, `shared/pivot/cellset.js`, `shared/pivot/format.js`, `client/src/components/PivotGrid.jsx`, `client/src/lib/grid-appearance.js`.
