# Model structure — narration script

Dimension Editor, Alternate Hierarchies, Subset Editor (incl. MDX subsets), Cube Editor. Period Builder left out.
**[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
Suggested objects: **WFP Cost Centre** for the Dimension Editor; **WFP Position** for Alternate Hierarchies
(its **By Location** hierarchy, built by WFP Rebuild Location Hierarchy).

---

## 1. Dimension Editor — four ways to see a dimension (~30s)

The Dimension Editor opens on any dimension, and it gives me four ways to look at it. Lets open WFP Cost Centre to see how it works. 
Tree shows the hierarchy. 
Flat is a plain list of every element.
Grid is for structural editing — parents, weights and
types side by side. And Attrs is the attribute grid: every element with every attribute, like a spreadsheet.
Filter elements, top right, narrows Tree, Flat and Attrs to the elements whose name matches, and it stays as I switch views.

## 2. Editing elements (~30s)

Lets look at editing the Dimension and options available in the IDE.
To add a single element click a Parent and select add child 
you can specify the Element to be before or after, the type and name and click to add. Once added you can edit the attributes and weight.
Note we can relink by drag and drop and we can remove parent as well, this is effectively a move.

If you are adding by bulk you can copy paste and again specify the insert location.

Note when deleting before a delete, the IDE checks where the element is used, so I don't remove something a cube still holds data against.

## 3. Attributes (~25s)

Attribute values are edited right in the grid. A whole sheet of values can be pasted in, or uploaded as a CSV — element in
the first column, one column per attribute.

> **[Open a measure dimension, e.g. WFP Workforce Input Measure; click Picklists]**
 Picklists live on the measure dimension. Works the same was as PAW.
 
The Format attribute decides how each element's numbers look in a view. Like picklists, it usually lives on the measure dimension, so every Amount shows the same way wherever it appears.
Click a Format cell and the picker opens, with ready-made formats grouped as Number, Currency, Percentage and Accounting: thousands separators, decimal places, a currency sign, percentages, and negatives in brackets or in red.
If none fits, I type my own TM1 format string. Apply saves it.
Open a view, and the numbers follow it: money shows as money, rates as percentages. It's TM1's own Format attribute, so it's set once on the element and used everywhere.

## 4. Used in (~10s)

**[Expand "Used in N cubes"]**
"Used in" shows every cube built on this dimension and every TI process that touches it — the impact of a change, before I
make it.

## 5. Alternate Hierarchies (~30s)

A dimension can have more than one hierarchy. This is **WFP Position / By Location** — the same positions and the same
data, rolled up by location instead of by department.

The banner says exactly what it is, and which process builds it — so nobody mistakes it for a separate dimension, or
edits by hand something a process will rebuild.

Click any element and I see where it sits in every hierarchy, side by side.

### Adding one (~45s)

**[Open WFP Position in Explorer]**
This dimension already has one, so the **Hierarchies** section is here. Hovering the dimension gives me the generated one;
the plus beside **Hierarchies** gives me both kinds.

**[Open the plus menu]**
**From an attribute…** builds it from the data. Pick the attribute the rollup follows — here, **Grade** — and each position goes under its value. The IDE writes a process that rebuilds it, so it stays in step; I never edit this hierarchy by hand.

The options are:

**[Point to each field]**
- **Hierarchy name** — defaults to “By Grade”.
- **Levels above, from a dimension** — optional. Point it at a dimension to add levels above the attribute value; leave it blank for one group per value, which is what Grade needs.
- **Keep it in step** — optional. Hook the rebuild into the Epilog of the process that runs after the attribute changes, such as a load or a recalculation. Leave it blank and I run it myself.

**[Create]**
It opens WFP Position on the new By Grade hierarchy.

**[Back to the plus menu → Empty]**
**Empty** is the hand-built one. Name it — say, By Status — press Enter, and the Dimension Editor opens on that hierarchy. Same positions and same data as the default — I add elements and drag them under consolidations to shape it.

Either way, the default hierarchy is untouched. The tree, the subsets and the element panel all follow whichever hierarchy I'm in.

## 6. Subset Editor — visual and MDX (~40s)

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

Subsets are hierarchy aware you can see the groupings in the explorer.

Subsets show as MDX or native in the explorer, open WFP Position  Open Reqs, which shows the MDX, run the Execute to see subset built. 

To Create a new MDX subset clisk MDX and enter MDX code the Functions and patterns are able to be insert at the surser and you can test and built them up, not as with Views and SQL and MDX Views you can save a session for later use. 

## 7. Subset usage (~10s)

**[Click Scan for usage]**
Scan for usage lists every view and TI process that uses this subset — so I can see what a change will affect before I
make it.

## 8. Cube Editor (~30s)


A new cube starts in the Cube Editor. I give it a name…
And if I don't want to write the MDX myself, I can describe the members I want in plain English, and the IDE writes the MDX for me. I check the result, then keep it or adjust it.
This needs an AI provider set up for the IDE, with your own API key: Claude, an OpenAI-compatible service, or Gemini. 
Without one, the bar says AI isn't configured, and everything else in the Subset Editor works the same.
You can also of course use the MCP and prompt you subset that way.

Create, and the cube opens straight away in a view.
For an existing cube, the same editor shows its dimensions in order, with one click to its rules or a view — and Delete,
which asks first.

---

Total about **4 min 10 s**. To get nearer 3 minutes, the easiest cuts are: Format attribute in section 3 (−8s), Bulk in
section 2 (−6s), Used in (−10s), the Levels and hook detail in section 5 (−15s).
