# TI Editor — narration script

Follows the Rules Editor short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
One process throughout: **WFP Check Assignment Spans**. Section 8 also uses the **Demo HR (Sequel Lite)** connection.
Don't save the process during the video — sections 1, 2, 5, 6 and 7 change it on screen only.

---

## 1. The process and its datasource (~50s)

**[Open WFP Check Assignment Spans]**
This is WFP Check Assignment Spans. Every assignment has a start month and an end month, and this process flags any assignment
that ends before it starts.
**[Click the Datasource bar at the top]**
The datasource sits at the top of the process, one click to open. This one is a cube view: the view WFP Assignment Base Src,
on the cube WFP Assignment Detail.
**[Open that view in another tab, or point to its layout]**
The view puts every Version, Position and Employee on the rows and the FTE measure on the columns, with empty rows suppressed.
So each row that's left is one real assignment — this employee, in this position, in this version.
**[Back to the process; open Variables]**
TM1 hands the process one record per row of that view. Variables shows the columns of each record — vVersion, vPosition and
vEmployee, one for each dimension, plus the cell value. The Data section then runs once per record, using those variables.
**[Open the Type list; pick each type in turn]**
The Type list has every choice TM1 offers: none, a text file, ODBC, a cube view or a dimension subset. The fields change to
suit what you pick: for a file, the name, delimiter and header rows, with an Upload button to send the file to the server;
for ODBC, the DSN and the query; for a cube view, a list of the cubes and then that cube's views; for a subset, the dimension
and the subset.
**[Put it back to TM1 Cube View — WFP Assignment Detail, WFP Assignment Base Src]**

## 2. Parameters (~15s)

**[Open Parameters; click Add, then remove it again]**
Parameters are edited right here too: name, type, default value and the prompt the user sees when they run it. This process
doesn't need any, but when one does they're saved with the process, in the same place you edit its code.

## 3. The four sections (~15s)

**[Click through Prolog, Metadata, Data, Epilog; end on Data]**
And the code is laid out the way every TM1 developer knows it: Prolog, Metadata, Data and Epilog, one tab each. Everything
this process does is in the Data section — ten lines that run for each record.

## 4. History (~25s)

**[Click History, pick the change]**
History keeps every change made to this process — what changed, when, and the change set it belongs to. Open an entry and I
see the code before and after, side by side.
**[Point to Restore — don't click it]**
If a change was wrong, Restore puts the process straight back. Like the rules, the restore is logged too, so nothing is ever
lost.
**[Point along the toolbar to Regions, Collapse and Minimap]**
Regions, Collapse and the minimap work just as they do in the Rules editor — on a long Prolog they turn it into a table of
contents — and each section keeps its own state.

## 5. Function reference (~25s)

**[Click Ref]**
The function reference lists every TI function, grouped by category, each with its arguments and a short description.
**[Click on a new line at the end of the Data section, then click a function]**
I put the cursor where I want it, click a function, and it's inserted with a placeholder for each argument.
The list comes from the IDE's single function catalog — the same one that drives autocomplete and the checks — and that
catalog is tested against a real TM1 server: the Validate button in Catalog Admin tries every function on the server and
reports any TM1 rejects. So every function in this list is one TM1 actually accepts.
**[Undo the insert]**

## 6. Autocomplete (~30s)

**[Data section, new line at the end: type `CellGetN(`]**
As I type, the editor knows where I am. Inside CellGetN it offers the cube names first — the real cubes on this server.
**[Pick WFP Assignment Detail]**
Pick a cube, and it fills in a stop for each of its dimensions in the right order. I tab from one to the next, and at each
stop it offers that dimension's real elements.
**[Point to the hint]**
A signature hint shows which argument I'm on, and hovering any function shows what it does.
**[New line: type `sS`]**
It knows my variables too — anything assigned in the code is offered as I type, like sStart here.
**[Pick it, then delete the test lines]**
No typing cube or element names from memory. What I pick exists in the model — and it's the same catalog as the Rules
editor, so both work the same way.

## 7. Check (~30s)

**[Data section: change `nS = ATTRN( 'WFP Period', sStart, 'Period Index' );` to `nS = ATTRN( 'WFP Period', sStart );`]**
Before anything goes to the server, Check reads the whole process for mistakes.
**[Click Check]**
It goes through all four sections: every IF closed by an ENDIF, every WHILE by an END, every function given the right number
of arguments, and every function one TM1 really has. Here it's caught that ATTRN is missing its attribute name — on the right
line, with a squiggle under it.
**[Click the result — the editor jumps to the line]**
Click a result and I'm on the line. The same checks run as I type, so most mistakes show up before I even press it.
**[Click Undo]**
And when I save, TM1 compiles the process too, and the IDE warns me if it names a cube or dimension that doesn't exist.

## 8. Sequel Editor and Post to TI (~45s)

**[Open the Sequel Editor, pick Demo HR (Sequel Lite), open Payroll in the schema browser]**
This process reads a cube view. When the data comes from a database instead, the IDE has a Sequel editor. I pick a
connection — Sequel Server, Postgres, My Sequel or Sequel Lite — and browse its tables on the left.
**[Type the query with `?pYear?`, run it with 2026]**
I write the query and run it, and the rows come back here, so I test the query before TM1 ever sees it. `?pYear?` is a
parameter, filled in when it runs.
**[Click Post to TI, create Demo SQL Load, then Open in TI Editor]**
When it's right, Post to TI hands it to a process — an existing one or a new one. The query becomes the process's ODBC
datasource, and pYear becomes a process parameter automatically.
**[Show the Datasource bar and Parameters]**
Here it is: ODBC, the DSN and my query, with pYear ready to prompt for. Now I just write the Data section that uses the
columns. No copying the query by hand.
**[Close Demo SQL Load; back to WFP Check Assignment Spans, Data tab]**

## 9. Debugger (~70s)

**[Data tab]**
Back to our check. For each record, vVersion, vPosition and vEmployee come in from the view. It reads the assignment's start
and end month, turns each into a period number, and if the end comes before the start it sets nBad to 1. The last line
writes that flag back as Bad Span.
Loops like this are where TI is hardest to follow. Until now the usual answer was to add lines that write values out to a
text file, run it, open the file — and then remember to take those lines out again. The IDE's debugger does that for you.
**[Click Debug; click the margin beside the `CellPutN( nBad …` line — a red dot appears]**
I open the debugger and click in the margin to set a breakpoint on the last line — by then the check has made its decision.
I can set as many breakpoints as I like, in any section.
**[In Watches, add `vEmployee`, `sStart`, `sEnd` as text and `nBad` as a number]**
Then I add watches — the variables I want to see. Whose record it is, the two months being compared, and the answer.
**[Click Debug Run, then Run]**
Debug Run runs the process on the server against the real data. Behind the scenes the IDE makes a temporary copy of the
process — with the same datasource — adds the capture code at each breakpoint, runs it, reads the values back and deletes the
copy. My process is never changed.
**[The panel fills — open a few entries]**
Each record that reaches the breakpoint gives me an entry: this employee, starts in this month, ends in that one, nBad 0 — the
span is fine. If an assignment ended before it started, I'd see nBad 1, and exactly which employee and which months caused it.
A view can hold thousands of records, so it captures the first 50 and lets the rest of the run go at full speed.
**[Click an entry — the editor jumps to the line]**
Click an entry and the editor jumps straight to that line.
*(Optional)* It's a real run, so whatever the process writes, it writes — here that's just the Bad Span flag being worked out
again, so it's safe to run any time. In return, what I see is exactly what happens on the server, not a simulation.

---

Total about **5 min 5 s**. To get nearer 4 minutes, the easiest cuts are: the catalog-validation sentences in Ref (−12s),
the Type list walk-through in section 1 (−15s) and the optional line in the debugger (−8s).
