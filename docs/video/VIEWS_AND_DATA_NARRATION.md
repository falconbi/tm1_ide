# Views and data — narration script

Follows the Model Structure short. The Cube Map has its own short (Understanding the model). **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
One cube throughout: **WFP Workforce Cost**, view **Cost by Cost Centre** (native: Cost Centre on rows, the subset
2026 Quarters + FY on columns, Budget / Group / Reporting / Cost to Company / Amount as filters).
Don't save the view during the video — every change in sections 1–3 is on screen only.

---

## Intro (~15s)

**[IDE open, Explorer showing WFP Workforce Cost]**
In this video I'll work with the data itself: opening a view, shaping it, reading the grid, and tracing any number back to
where it came from. I'll finish with a habit worth keeping: testing MDX before it goes into a TI process. One cube
throughout, Workforce Cost, and one of its views.

## 1. A native view (~50s)

**[Explorer: expand WFP Workforce Cost — Views; open Cost by Cost Centre]**
This is Cost by Cost Centre. The badge in the toolbar says it's a native view: the classic TM1 view, where each dimension
is placed on rows, columns or the filter and picks its members from a subset. It's the kind of view most TM1 models are full
of, and the kind TI processes use as a datasource.
Here, the cost centres run down the rows, with the 2026 quarters and the full year across the top. Everything else is fixed
in the filter: the Budget version, the whole Group, reporting currency, and Cost to Company, so every number on screen is the
full budgeted cost of each cost centre.
**[Drag WFP Version from Filter onto Columns; Ctrl+Enter]**
The layout is drag and drop. Say I want to compare versions. I drag Version from the filter onto the columns, press
Ctrl+Enter, and the grid redraws with each version side by side, under each quarter. No dialogs, no rebuilding the view.
**[Drag WFP Version back to Filter; Ctrl+Enter]**
Drag it back, and I'm where I started.
**[Point to the Bench — check before recording what it shows; this view places all eight dimensions, so it may only hold the Cost Centre location hierarchy]**
The Bench holds whatever this view doesn't place: spare dimensions, and alternate hierarchies such as cost centres rolled up
by location. They sit out of the way, but each one is a single drag from joining the view.

## 2. Subsets on an axis (~35s)

**[Click the WFP Period pill on Columns]**
Every dimension in the view chooses its members here. The columns use a named subset, 2026 Quarters + FY, built in the
Subset Editor we saw in the last video. That's the point of a named subset: it's defined once, and every view that uses it
stays the same.
**[Point to the subset list]**
I can switch to any other saved subset on this dimension,
**[Point to the member search]**
or search and tick members by hand, for a quick one-off look,
**[Point to Open in Subset Editor]**
or, if the subset I need doesn't exist yet, go straight to the Subset Editor, build it there and come back.
**[Close the popover without changing anything]**

## 3. The same view as MDX (~45s)

**[Click MDX in the mode toggle]**
Native views and MDX views are two ways of describing the same thing. Switch to MDX, and the IDE writes this exact view out
as an MDX query: the rows, the columns and the filter members are all there. It's a good way to learn MDX: build the layout
visually, then read the query it makes.
**[Point to the amber warning]**
The warning matters. A view saved from MDX mode becomes an MDX view for good, and anything built around the native view,
such as a process reading it, would be reading something different. So the IDE says so before I save, not after.
**[Click Builder]**
To write MDX from scratch, the Guided MDX Builder takes it one step at a time. Choose the cube, then put each dimension on
columns, rows or the filter and pick its members. The builder writes the MDX as I go, and I can edit it by hand whenever I
want.
**[Click Execute in the builder]**
Execute runs it against the server and shows the result right there, before anything is saved.
**[Close the builder; click Visual]**

## 4. Working the grid (~40s)

**[Right-click the top cost-centre total — Expand all levels below]**
In the grid, totals open and close like a tree. Right-click a total for more: expand every level below it in one go, keep
only that member, remove it, or show just the leaves underneath. It's the quickest way to go from the group total down to
the cost centres that matter.
**[Click Suppress empty]**
Suppress empty hides rows and columns with nothing in them. With hundreds of cost centres, it's the difference between a
page of zeros and the few rows that actually have cost. And it's saved with the view, so it's still on next time it opens.
**[Click Flat, then click the FY column header]**
Flat turns the grid into a plain list. Click a column header and it sorts, so the most expensive cost centres come to the
top.
**[Click Flat again]**
Toggle it off, and I'm back to the hierarchy.
**[Point to the grid options and the CSV button]**
The grid options control the look, column widths and fitting, and CSV exports what's on screen. The numbers themselves follow
each element's Format attribute, set in the Dimension Editor, so money shows as money and rates as rates.

## 5. Trace a number (~50s)

**[Right-click a cost centre's FY cell — Trace]**
Every planner gets asked the same question: where does this number come from? Right-click any cell, choose Trace, and the
IDE shows how that number is made.
**[Point to the CONSOLIDATED badge and the components]**
This cell is a total, so the trace says CONSOLIDATED and lists the children it adds up, each with its value. Click a child,
and I follow it down a level.
**[Click down to a rule-calculated cell]**
Keep going and I reach a cell calculated by a rule. Now the trace shows the rule itself, and underneath it, how that rule
works out for this exact cell: each part of the formula, with the real value it has right now. No reading the rule and
guessing.
**[Click a DB lookup — Trace this value]**
When the rule reads a value from another cube, I can click that value and the trace carries on in the other cube. Step by
step, I follow the number through the model, until I reach the bottom: data someone typed in, or a process loaded.
That's the whole story of one number, without leaving the view.

## 6. MDX in a TI process: test it first (~40s)

**[Open the Subset Editor on WFP Cost Centre, MDX mode; type `{TM1FILTERBYLEVEL({TM1SUBSETALL([WFP Cost Centre])}, 0)}`]**
MDX isn't only for views. TI processes use it too: SubsetCreateByMDX, for example, builds a subset from an MDX expression,
which processes often do to set up the subset a view will read.
The catch is that inside a TI process, the MDX is just text in quotes. Nothing checks it. A typo, or a wrong dimension name,
only shows up when the process runs, and sometimes only as a subset with the wrong members in it.
**[Click Execute]**
So test the MDX first, here. This one asks for every leaf cost centre. Execute runs it, and I see exactly the members it
returns.
**[Copy the MDX; open a TI process; type `SubsetCreateByMDX( 'Leaf Cost Centres', '` and paste]**
Once it returns what I expect, I copy it into the process. MDX that's been run once in the editor is MDX I know works,
before the process ever touches it.
**[Undo; close without saving]**

## Outro (~15s)

**[Back to the Cost by Cost Centre view]**
So that's views and data: open a view and rearrange it by dragging, choose members with subsets, see the same view as MDX or
build one with the builder, work the grid, and trace any number back to where it came from. And whenever MDX goes into a
process, test it first.
In the next video: the Cube Map, and how to read a whole model on one page.

---

Total about **4 min 50 s**. If it needs to come down, the easiest cuts are: the Bench line in section 1 (−8s), the grid
options line in section 4 (−12s) and the builder paragraph in section 3 (−15s).
