# Model structure — narration script

Dimension Editor, Alternate Hierarchies, Subset Editor (incl. MDX subsets), Cube Editor. Period Builder left out.
**[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
Suggested objects: **WFP Cost Centre** (with its location Alternate Hierarchy, built by WFP Rebuild Location Hierarchy).

---

## 1. Dimension Editor — four ways to see a dimension (~30s)

**[Open WFP Cost Centre from the Explorer]**
The Dimension Editor opens on any dimension, and it gives me four ways to look at it.
**[Click Tree, Flat, Grid, Attrs in turn]**
Tree shows the hierarchy. Flat is a plain list of every element. Grid is for structural editing — parents, weights and
types side by side. And Attrs is the attribute grid: every element with every attribute, like a spreadsheet.
**[Type in the filter box]**
I can filter by text or by an existing subset, and the filter applies to all four views at once.

## 2. Editing elements (~30s)

**[Right-click an element in the tree]**
Right-click any element to add a child, rename it or delete it. Before a delete, the IDE checks where the element is used,
so I don't remove something a cube still holds data against.
**[Drag an element onto a consolidation; edit the weight]**
Drag an element onto a consolidation to add it there, and change its weight in place.
**[Click Bulk]**
For more than a handful, Bulk takes a pasted list of elements in one go.

## 3. Attributes (~25s)

**[Attrs view — edit a value in the grid]**
Attribute values are edited right in the grid. A whole sheet of values can be pasted in, or uploaded as a CSV — element in
the first column, one column per attribute.
**[Click Picklists]**
Picklists set the allowed values for a text attribute, so users choose from a list instead of typing.
**[Click a Format cell]**
And the Format attribute sets how each element's numbers display in views — click a cell and pick the format.

## 4. Used in (~10s)

**[Expand "Used in N cubes"]**
"Used in" shows every cube built on this dimension and every TI process that touches it — the impact of a change, before I
make it.

## 5. Alternate Hierarchies (~30s)

**[Open the hierarchy selector, pick the location hierarchy]**
A dimension can have more than one hierarchy. This is an Alternate Hierarchy — the same cost centres and the same data,
rolled up a different way, here by location instead of by department.
**[Point to the banner]**
The banner says exactly what it is, and which process builds it — so nobody mistakes it for a separate dimension, or
edits by hand something a process will rebuild.
**[Click an element; point to its hierarchy places]**
Click any element and I see where it sits in every hierarchy, side by side.
**[Click New hierarchy]**
And New hierarchy creates another one, right here.

## 6. Subset Editor — visual and MDX (~40s)

**[Open a subset on WFP Cost Centre]**
Subsets are edited in the Subset Editor. In Visual mode I browse the hierarchy and tick the members I want — that's a
static subset, a fixed list.
**[Switch to MDX]**
For a subset that keeps itself up to date — every cost centre under a region, or every element with a certain attribute —
I switch to MDX and write the set expression.
**[Click Execute; point to the results below]**
Execute runs it against the server and shows the members it returns, before I save anything.
**[Type in the AI bar: e.g. "all leaf cost centres under R&D", press Enter]**
And if I don't want to write MDX myself, I can describe the members I want in plain English, and the IDE writes the MDX for
me. I check the result, and keep it or adjust it.
**[Click Save ▾]**
Save keeps it, or Save As makes a copy under a new name.

## 7. Subset usage (~10s)

**[Click Scan for usage]**
Scan for usage lists every view and TI process that uses this subset — so I can see what a change will affect before I
make it.

## 8. Cube Editor (~30s)

**[Explorer — new cube; type a name]**
A new cube starts in the Cube Editor. I give it a name…
**[Pick dimensions from the list; reorder them]**
…pick its dimensions from the list and put them in order. The last one is treated as the measures dimension, and the
editor marks it.
**[Click Create Cube]**
Create, and the cube opens straight away in a view.
**[Back in the Cube Editor for an existing cube — point to Rules / View / Delete]**
For an existing cube, the same editor shows its dimensions in order, with one click to its rules or a view — and Delete,
which asks first.

---

Total about **3 min 25 s**. To get nearer 3 minutes, the easiest cuts are: Format attribute in section 3 (−8s), Bulk in
section 2 (−6s), Used in (−10s), New hierarchy in section 5 (−5s).
