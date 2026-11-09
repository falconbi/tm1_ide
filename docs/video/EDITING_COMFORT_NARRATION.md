# Editing comfort — narration script

Follows the Cube Map short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
Uses the Workforce model on TM1_Test_DEV. Before recording, close all tabs except **WFP Workforce Cost** rules, so the tab
bar starts clean.

---

## Intro (~15s)

**[IDE open: Explorer on the left, WFP Workforce Cost rules in one tab]**
The earlier videos were about what each editor does. This one is about the everyday things around them: finding objects,
working with several at once, the shortcuts that save time, and the function catalog that keeps every editor honest. None of
it is a big feature on its own, but together it's what makes a day in the IDE quicker than a day without it.

## 1. The Explorer (~45s)

**[Point down the Explorer tree]**
The Explorer on the left is the whole server as a tree: cubes, with their views and rules underneath, dimensions with their
hierarchies and subsets, processes and chores. Everything in the model is here, and the control objects TM1 makes for itself
are kept out of the way, so the list is only the model.
**[Type Workforce in Search objects]**
Search objects filters the tree as I type, so on a server with hundreds of objects I find the one I want in a second.
**[Clear the search; hover a cube row to show its buttons]**
Each row has its own actions: build an MDX view, edit the cube's structure, or delete it. New cubes,
dimensions, subsets and Lenses start from here too.
**[Point to a marked object]**
And when I'm working in a change set, the objects I've changed are marked in the tree, so I can see at a glance what my
change touches.
**[In the rules tab, click Show in tree (the pin)]**
It works the other way as well. From any open editor, Show in tree finds that object in the Explorer and highlights it.
**[Press Ctrl+B twice]**
And Ctrl+B hides the Explorer when I want the whole screen for code, and brings it back.

## 2. Searching the code (~30s)

**[Press Ctrl+Shift+F; type CellPutN( 'WFP Workforce Cost' or a cube name]**
The Explorer searches names. Search code searches what's inside: the Prolog, Metadata, Data and Epilog of every process on
the server, at once.
**[Point to the results]**
Each result shows the process and where the match is. It's how I answer the question every developer asks before changing a
cube: which processes write to it? Instead of opening processes one by one, I get the whole list in one search.
**[Click a result]**
Click a result, and the process opens on that line.

## 3. Tabs and split panes (~50s)

**[Open WFP Workforce Cost's view and a process from the Explorer]**
Every object opens in its own tab, so I can have the rules, a view and a process open together, the way I'd work on a real
change.
**[Drag a tab to a new position]**
Tabs drag into whatever order I want.
**[Right-click the view tab — Split Right]**
Right-click a tab and Split Right puts it in a second pane, side by side. Now the rules are on the left and the view is on
the right. I change a rule, save it, and the view on the right refreshes by itself, so I see the effect of my change on the
numbers straight away.
**[Hover a tab — click the arrow (Open in other pane)]**
The arrow on a tab sends it to the other pane, and Split Down stacks the panes instead of placing them side by side, for a
wide view on a narrow screen.
**[Right-click a tab — point to Close others and Close to the right]**
The same menu closes the others, or everything to the right, when the screen gets busy.
**[Press Alt+. and Alt+, ]**
And Alt plus full stop and Alt plus comma step through the tabs without the mouse.
**[Point to the tab bar]**
The tabs, the panes and the layout are saved with my workspace, so next time I open the IDE, everything is where I left it.

## 4. Shortcuts (~45s)

**[Press F1]**
F1 opens the keyboard shortcuts, grouped by where they work: everywhere, in the code editors, in views, and in rules.
**[Point to General]**
The ones I use most: Ctrl+S saves whatever I'm in, Ctrl+Enter runs it, whether that's a view or an MDX query, and Ctrl+Z
and Ctrl+Shift+Z undo and redo.
**[Point to the editor shortcuts]**
In the code editors, Ctrl+slash comments a line in or out, using TM1's hash comments. Alt with the up or down arrow moves a
line. Ctrl+D selects the next match, to change several at once.
**[Close F1; in the rules, double-click inside 'WFP Workforce Cost']**
And one that's made for TM1: double-click inside a quoted name, and it selects the whole name, not just the word under the
mouse. Names like WFP Workforce Cost have spaces, and this is how I replace one in one go.
**[Double-click the quote mark itself]**
Double-click the quote mark, and it takes the quotes too.
**[Press Ctrl+= then Ctrl+0]**
Ctrl plus and minus change the editor's font size, and Ctrl+0 puts it back. Handy on a big screen, or when sharing it.

## 5. The Function Catalog (~50s)

**[Tools menu — Function Catalog]**
Every function the IDE knows comes from one place: the Function Catalog. Autocomplete, the hover help, the function
reference and the checks in the Rules and TI editors all read the same list, so they can never disagree with each other.
**[Click the TI Functions tab; type CellPutN in the search]**
There's a tab for Rules functions, TI functions and MDX functions. Each entry has the function's arguments, what it returns,
a description, and which versions of TM1 it works in.
**[Click Validate]**
The important part is Validate. It doesn't trust the list: it tries every function against the real TM1 server and reports
any the server rejects. That's how the catalog stays correct, tested against the server rather than typed from memory.
**[Point to Edit and the add button]**
If my server has something the catalog doesn't, I can add or correct an entry here, and every editor picks it up.

## 6. The Naming Dictionary (~25s)

**[Click the Naming / Formatter tab]**
The last tab is the Naming Dictionary. TM1 doesn't care how a function is capitalised, but people reading the code do. When
the formatter tidies a rule or a process, this is the list it follows: when it sees a function written one way, it writes it
the house way instead.
**[Point to Import, Export and Reset]**
It can be exported and imported, so a whole team writes code the same way, and reset to IBM's own spelling at any time.

## Outro (~15s)

**[Close the catalog; back to the split rules and view]**
So that's the everyday side of the IDE: find anything in the Explorer, search all the code at once, work side by side in
split panes, keep your hands on the keyboard, and rely on one tested function catalog behind every editor.
That's the end of the developer's IDE series. Next, deployment: change sets, assertions, and moving a change safely to
another server.

---

Total about **4 min 35 s**. If it needs to come down, the easiest cuts are: the font size line in section 4 (−6s), the
Import/Export line in section 6 (−8s) and the drag line and Alt shortcuts in section 3 (−10s).
