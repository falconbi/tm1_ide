# Rules Editor — narration script

Starts with the Rules Editor open on **WFP Workforce Cost** (introduced earlier in the video).
**[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.

---

## 1. History (~30s)

**[Click History, panel opens]**
History keeps a record of every change made to these rules. Each entry shows what was done, when,
and the change set it belongs to, with the latest at the top. I can open any entry and see exactly
what changed, the rules before and after, side by side.
**[Click restore on an entry]**
If a change was wrong, I click restore, and the rules go straight back to how they were before it.
That restore is logged too, so the trail stays complete.
**[Close History]**

## 2. Formatter (~35s)

**[Click Format, popup opens]**
Rules written by different people over the years rarely look the same. The formatter fixes that.
Clicking Format first lets me pick a structure: compact, standard, expanded, or one of the TM1
layouts that put each DB argument on its own line or group them together.
**[Click Format in the popup]**
One click, and the whole rule file is laid out that way: same indentation, same spacing, easy to
read.
**[Click Undo]**
And if I don't like it, undo puts it straight back.
**[Point to the gear icon]**
To set your own house style, the gear icon here opens the format settings: indentation, spacing
around commas, operators and functions, with a live preview as you change them. The settings are
kept in your browser, so the formatter always works your way.

## 3. Regions (~20s)

**[Click Regions, pick a region]**
The Regions list shows every region in the rule file, and picking one jumps straight to it. No
scrolling through hundreds of lines to find the calculation you want.
**[Jump back to where you were]**
And straight back to where I was.
**[Click Collapse]**
Collapse folds every region down to its name, so the whole file reads like a table of contents. I
open just the section I'm working on, and the rest stays out of the way.

## 4. Function reference (~20s)

**[Click Ref, panel opens]**
The function reference lists every TM1 rules function, grouped by category, each with its arguments
and a short description. No looking anything up in the IBM docs. The list comes from one catalog the
IDE checks against a real TM1 server, so every function in it actually exists.
**[Click in the editor, then click DIMIX]**
Put the cursor where I want it, click a function, and it's pasted in with placeholders for each
argument, ready to fill in.
**[Close Ref]**

## 5. Trace (~35s)

**[Click Trace, start entering elements]**
Trace answers the question everyone asks sooner or later: how did this number get here? I pick one
cell, an element for each dimension of the cube…
**[Enter the measure, click Trace]**
…and the measure last. Trace then shows the whole chain that produces that value: the rule that
calculates it, the rules and cubes it reads from, and the consolidations underneath, all the way
down to the stored input values. Each step is labelled as a rule, a consolidation or an input, with
the rule statement shown alongside.
**[Point to an input at the bottom of the chain]**
And at the bottom, for any input value, I can open its transaction history to see who entered it
and when.
And from any cube view, right-click a cell and choose Trace to get the same answer.

## 6. Minimap (~15s)

**[Click Minimap]**
The minimap is a small picture of the whole rule file down the right-hand side. On a long file I can
see its shape at a glance and click or drag anywhere on it to jump there. Errors and search matches
show up on it too, so problem lines are easy to spot.
**[Click Minimap off]**
I can switch it on or off, and the IDE remembers which I prefer.

## 7. Rules lineage (~15s)

**[Click Rules lineage]**
Rules lineage shows how this cube connects to the rest of the model through its rules: which cubes
it gets its numbers from, and which cubes depend on it. It answers "where does this come from" and
"what will this change affect" before I touch a single rule.
**[Click a cube in the list]**
Click any cube in the list, and its rules open alongside.

## 8. Rule Lens (~20s)

**[Click Rule Lens]**
Rule Lens turns the rule file into a list you can review, one item per rule. For each rule it shows
what it calculates (the area and the measures), the formula, the cubes it reads from, and the
feeders that go with it. It's the quickest way to understand someone else's rules, or check a
change, without reading the code line by line.
**[Close Rule Lens]**

## 9. Cube Map (~20s)

**[Click Cube Map, it opens on Workforce Cost — Trace depth 1, Calls ticked]**
The Cube Map opens with this cube already selected, and shows how it fits into the whole model. The
cubes it reads from, the cubes that read from it, and the TI processes that write into it, plus which
processes call those, all in one picture, built from the model itself.
**[Pause on the map]**
There's a lot more to the Cube Map, and it gets its own short later.

## 10. Autocomplete (~25s)

**[Back in the Rules Editor, start typing a DB( ]**
As I type, the editor knows where I am in the rule. Inside a DB, it offers the cube names first,
then, once the cube is chosen, the real elements for each of its dimensions in the right order. The
same goes for ATTRS and the other lookups. A signature hint shows which argument I'm on.
**[Pick a suggestion]**
No more typing element names from memory, or switching to another window to check a spelling. What I
pick is guaranteed to exist in the model.

## 11. The checks (~30s)

**[Make a small mistake, e.g. a wrong argument count; the squiggle appears]**
The editor checks the rules as I type. Wrong argument counts, unknown functions and keywords that
aren't valid in rules get a squiggle on the exact line, before I save.
**[Click Check Now; the glow goes green or red]**
Check Now sends the rules to TM1 itself to compile, without saving them. Green means TM1 accepts
them; red shows exactly what it rejected and where.
**[Optional: click Feeders]**
And Feeders asks TM1 to check the feeders for these rules, so a missing feeder shows up now, not as
an empty total in a report later.

---

Total about **4 min 25 s** at the times above. To get nearer 3 minutes, the easiest cuts are: the
format-settings paragraph (−12s), the minimap (−15s), the Feeders line (−8s), and the transaction
history line in Trace (−6s).
