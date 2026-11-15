
## Intro (~75s)

**[View Editor open on Cost by Cost Centre]**
This video is about the grid: where you read your numbers, shape a view, and trace any number back to where it came from.
I'll open a view, rearrange it, choose its members, read the grid properly, and follow one number all the way down.

**[Scroll the grid; open and close a few totals]**
First, what the grid is. It's built on AG Grid, one of the most widely used data grids on the web, and the free Community
edition of it. That matters for three reasons.
It's fast. It only draws the rows and columns on screen, so a view with thousands of cost centres scrolls as smoothly as
one with ten.
It's proven. Teams all over the world build on it, so things like column resizing, pinning, sorting, search and keyboard
movement work the way people already expect.
And it's open. The Community edition is free, so anyone can run this without a licence.

**[Right-click a total to show the member menu]**
What AG Grid doesn't know about is TM1. Its tree and pivot features are in the paid edition, and they don't understand
TM1 hierarchies anyway. So the TM1 part is ours, built on top: totals that open one level at a time, inner dimensions that
remember what's open under each outer member, opening a total beyond what the view returned by asking TM1 for more, the
right-click menu on every member, totals left or right and top or bottom, typing values into input cells only, and numbers
shown with each element's TM1 Format. Column widths are remembered per view, and right-click any cell to trace it.
And it's one grid. The same grid is used in the IDE and in Lenses, so a fix or a feature lands in both at once.

## 1. A native view (~70s)
This is Cost by Cost Centre. The badge in the toolbar says it's a native view: the classic TM1 view, where each dimension
is placed on rows, columns or the filter and picks its members from a subset. It's the kind of view most TM1 models are full
of, and the kind TI processes use as a datasource.
Here, the cost centres run down the rows, with the 2026 quarters and the full year across the top. Everything else is fixed
in the filter: the Budget version, the whole Group, reporting currency, and Cost to Company, so every number on screen is the
full budgeted cost of each cost centre.
The layout is drag and drop. Say I want to compare versions. I drag Version from the filter onto the columns, and the
grid redraws by itself with each version side by side, under each quarter. No button to press, no dialogs, no
rebuilding the view.
Drag it back, and I'm where I started.
The Bench holds whatever this view doesn't place: spare dimensions, and alternate hierarchies, which I'll come to in a
moment. They sit out of the way, but each one is a single drag from joining the view.
Rearranging is safe to try, because Sessions keeps a copy of any layout I like. I click Sessions in the toolbar, type a
name, and press Enter. Later I open Sessions again and click the name to get that layout straight back. A session is a
draft kept in my browser: it never changes the saved view in TM1. There's no undo for layout changes, so it's a good habit
to save a session before trying something big.

## 2. Subsets on an axis (~35s)
Every dimension in the view chooses its members here. The columns use a named subset, 2026 Quarters + FY, built in the
Subset Editor we saw in the last video. That's the point of a named subset: it's defined once, and every view that uses it
stays the same.
I can switch to any other saved subset on this dimension,
or search and tick members by hand, for a quick one-off look,
or, if the subset I need doesn't exist yet, go straight to the Subset Editor, build it there and come back.

## 3. Hierarchies (~40s)
A dimension can roll up more than one way. Its main hierarchy is the one it's built with, and an alternate hierarchy takes
the same members and groups them differently. In this model, Positions normally roll up by cost centre, but the By Location
hierarchy groups the same Positions into city, then country, then region. Nobody maintains it by hand: a process rebuilds
it from each Position's location.
On the Bench, an alternate hierarchy shows in amber under its dimension's name. I drag WFP Position, By Location, onto the
rows, and the grid now shows cost by region, country and city, using exactly the same data.
On a pill, the hierarchy choice under the name switches between the main hierarchy and the alternate one, and the subset
list follows it: By Location has its own subsets, such as Cities.
The main hierarchy and an alternate one can both sit on the grid at once, because they share the same leaves.
One thing to know: a classic native view can't hold an alternate hierarchy, so the IDE saves a view that uses one as an
MDX view, and it tells me so when I save.

## 4. The same view as MDX (~45s)
Native views and MDX views are two ways of describing the same thing. Switch to MDX, and the IDE writes this exact view out
as an MDX query: the rows, the columns and the filter members are all there. It's a good way to learn MDX: build the layout
visually, then read the query it makes.
The warning matters. A view saved from MDX mode becomes an MDX view for good, and anything built around the native view,
such as a process reading it, would be reading something different. So the IDE says so before I save, not after.
To write MDX from scratch, the Guided MDX Builder takes it one step at a time. Choose the cube, then put each dimension on
columns, rows or the filter and pick its members. The builder writes the MDX as I go, and I can edit it by hand whenever I
want.
Execute runs it against the server and shows the result right there, before anything is saved.

## 5. Working the grid (~80s)
In the grid, totals open and close like a tree, one level at a time. Right-click a total for more: expand every level
below it in one go, open the same level for every member, keep only that member, remove it, or show just the leaves
underneath. It's the quickest way to go from the group total down to the cost centres that matter.
Suppress empty hides rows and columns with nothing in them. Each click moves it on: rows, then columns, then both, then
off. With hundreds of cost centres, it's the difference between a page of zeros and the few rows that actually have cost.
And it's saved with the view, so it's still on next time it opens.
Flat turns the tree into a plain table: one row per line of the view, with every row dimension in its own column, and every
column sortable. The tree is the right way to read a model top-down, from the group total to the detail. Flat is for the
other questions: which are the ten most expensive cost centres, or which positions cost the most across every department.
Click a column header and it sorts, so the biggest numbers come straight to the top, wherever they sit in the hierarchy.
One tip: totals sort in among the detail, so choose Show leaves only first, and the ranking is clean.
Toggle Flat off, and I'm back to the hierarchy.
With hundreds of rows, Search finds what I need without scrolling: type part of a name or a number, and the grid shows only
the rows that match. Clear it, and everything comes back.
Columns resize by dragging their edge, and the grid remembers my widths for this view next time. Fit columns, or
Ctrl+Shift+A, sizes every column to its contents in one go, and Reset widths puts them back to the default.
Freeze top row keeps the first row, here the group total, pinned while I scroll through the detail.
Grid format options change the look: row height, font size, zebra striping, the number format, and how totals stand out. CSV exports exactly what's on screen. The numbers themselves
follow each element's Format attribute, set in the Dimension Editor, so money shows as money and rates as rates.

## 6. Trace a number (~50s)
Every planner gets asked the same question: where does this number come from? Right-click any cell, choose Trace, and the
IDE shows how that number is made.
This cell is a total, so the trace says CONSOLIDATED and lists the children it adds up, each with its value. Click a child,
and I follow it down a level.
Keep going and I reach a cell calculated by a rule. Now the trace shows the rule itself, and underneath it, how that rule
works out for this exact cell: each part of the formula, with the real value it has right now. No reading the rule and
guessing.
When the rule reads a value from another cube, I can click that value and the trace carries on in the other cube. Step by
step, I follow the number through the model, until I reach the bottom: data someone typed in, or a process loaded.
That's the whole story of one number, without leaving the view.

## 7. MDX in a TI process: test it first (~40s)
MDX isn't only for views. TI processes use it too: SubsetCreateByMDX, for example, builds a subset from an MDX expression,
which processes often do to set up the subset a view will read.
The catch is that inside a TI process, the MDX is just text in quotes. Nothing checks it. A typo, or a wrong dimension name,
only shows up when the process runs, and sometimes only as a subset with the wrong members in it.
So test the MDX first, here. This one asks for every leaf cost centre. Execute runs it, and I see exactly the members it
returns.
Once it returns what I expect, I copy it into the process. MDX that's been run once in the editor is MDX I know works,
before the process ever touches it.

## Outro (~25s)
So that's views and data: open a view and rearrange it by dragging, choose members with subsets, roll them up another way
with a hierarchy, see the same view as MDX or build one with the builder, work the grid, and trace any number back to where
it came from. And whenever MDX goes into a process, test it first.
All of it runs on AG Grid, with the TM1 smarts built on top, and the same grid carries straight into Lenses.
In the next video: the Cube Map, and how to read a whole model on one page.

---

Total about **7 min 40 s**. If it needs to come down, the easiest cuts are: the Bench line in section 1 (−8s), the grid
options line in section 5 (−12s) and the builder paragraph in section 4 (−15s).
