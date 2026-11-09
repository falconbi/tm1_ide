# Cube Map (Understanding the model) — narration script

Follows the Views and data short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.
One cube throughout: **WFP Workforce Cost**. Before recording, choose WFP in the model filter so LAB cubes are hidden.

---

## Intro (~15s)

**[Cube Map open on the full WFP model, nothing selected]**
This is the Cube Map. In this video I'll show how to read a whole TM1 model from one page: what connects to what, where a
number comes from, and what a process run actually does, step by step. I'll use the Workforce model throughout, and the
Workforce Cost cube as the starting point.

## 1. The whole model on one page (~45s)

**[Open the Cube Map; click Fit to screen]**
When you inherit a TM1 model, or come back to one after a few months, the hardest question is the simplest one: how does it
all fit together? Which cubes feed which, and which processes move the data? Normally the answer lives in someone's head, or
in a diagram that went out of date the week after it was drawn.
The Cube Map answers it from the model itself. Every box is a cube. Every line is a real connection, worked out from the
rules and the TI code on the server each time the map loads. Nobody draws it and nobody maintains it, so it can't drift away
from what the model actually does.
**[Click Legend]**
The legend explains the lines. An amber line is a rule in one cube reading a value from another with DB. A dashed line is a
feeder, telling TM1 where calculated values will appear. A green line is a TI process writing into a cube; other colours show
a process reading a cube, changing a dimension, or calling another process.
**[Point to the bar on a cube with rules]**
And the bar on a cube means it has rules. The longer the bar, the more lines of rules it has, so the busiest calculation
cubes stand out straight away.

## 2. The left sidebar — finding things (~40s)

**[Point to the model filter: All models → WFP]**
The left side of the map is for finding things. A server often holds more than one model. This server has the Workforce
model and a lab copy of it, so the filter shows one at a time. Here it's WFP only, and the lab cubes are out of the way.
**[Type WFP Cost Centre in Spotlight dimension]**
Spotlight answers a question every developer asks before changing a dimension: where is it used? Type a dimension, and
every cube built on it lights up. Before I add, move or delete a cost centre, I can see every cube that change will reach.
**[Clear Spotlight]**
**[Type WFP Workforce Cost in Search cubes; click it]**
Search finds a cube by name. Click it, and the map focuses on that cube. Its direct connections stay bright, and the rest of
the model fades into the background.

## 3. The right sidebar — one cube in detail (~40s)

**[Point down the cube panel, section by section]**
The panel on the right is everything about the cube I've picked, in one place. First, its dimensions, in the cube's own
order. Then its rules: which cubes they read from, and which other cubes read from this one. Then its feeders. And then the
TI side: every process that writes into this cube and every process that reads from it.
That last part matters most when something goes wrong. If a number in this cube looks wrong, this list tells me every
process that could have put it there, without searching through every process on the server.
**[Point to Rules, Cube and Log]**
From here, one click opens the cube's rules, its structure in the Cube Editor, or its transaction log, to see who changed
what and when.
**[Double-click the cube on the map]**
Double-clicking a cube on the map does the same for its rules: it opens them straight away.

## 4. Following a thread (~55s)

**[Click a connected cube on the map, then another]**
Now I can follow the numbers through the model. Workforce Cost gets its numbers from other cubes, and those cubes get theirs
from others again. Click a connected cube, and the map refocuses on it. Click the next, and the next. This is how I trace
where a cost really comes from: from the cost cube, back to the pay cube, back to the rates and assumptions underneath.
**[Point to the bar at the top: Full map › WFP Workforce Cost › …]**
While I click around, the bar at the top keeps the whole thread, like breadcrumbs. It shows every cube I've visited, in
order, so I never lose track of how I got here.
Back, or the Backspace key, goes one step back along the thread. And clicking any name in the thread jumps straight back to
that cube.
**[Click WFP Workforce Cost in the thread]**
So one click brings me back to the cube I started from, however far I've wandered. Full map, or Escape, leaves the thread
completely and shows the whole model again.
**[In the right panel, point to Trace depth 1–4]**
Trace depth sets how far the map reaches from the cube I'm on. At one, I see only its direct neighbours. At two or three, I
see the neighbours of the neighbours, which is how far a change to this cube can really spread. At four, I see almost
everything it touches.
**[In the right panel, untick TI reads and TI writes under Follow, then tick them again]**
Follow chooses which kinds of connection count. Untick the TI ones, and I see only what the rules tie together, the live
calculation chain. Tick them back, and the processes that load and move data come back in. It's the same model seen two
ways: how it calculates, and how it's fed.

## 5. The player — a process run, step by step (~50s)

**[Click Show; open Start from… and pick a WFP process]**
The map shows what's connected. Show shows what happens, and in what order. It plays a process run across the map. I pick
where the run starts: any process or chore that reads, writes or calls something.
**[Click Play; let it run a few steps; Pause]**
Each step lights up the next thing the code does, in the order it does it: the cube it reads, the cube it writes, the
dimension it changes, and the next process it calls. When one process calls another, the run follows it, so a whole chain of
processes plays out as one story.
**[Click Previous and Next; point to Speed]**
I can pause at any point, step back and forward one step at a time, or slow it down or speed it up.
**[Click What is this step?]**
And What is this step? explains the step I'm on: which process is running, the parameters it was given, and what it writes.
For someone new to the model, this is how you learn a nightly load in minutes instead of reading every process line by line.
**[Click Back to the start; close Show]**
Back to the start replays the run from the top.

## 6. Runbook (~25s)

**[Click Runbook; select a phase]**
Runbook goes one level higher. It groups the model's processes into phases: the order a model update runs in, from loading
the data, through the calculations, to the checks at the end.
Select a phase, and the map shows every process in that phase together, with everything they touch.
**[Close the runbook]**
So before a big update runs, I can review it phase by phase and see exactly what each phase will change, instead of
discovering it afterwards.


## Outro (~15s)

**[Escape back to the full map]**
So that's the Cube Map: the whole model on one page, built from the rules and the code, so it's always current. Find a cube,
follow its thread and jump back, play a process run, and review an update phase by phase.
In the next video: the everyday editing features that make working in the IDE faster.

---

Total about **4 min 45 s**. If it needs to come down, the easiest cuts are: the double-click line in section 3 (−5s), the
Follow example in section 4 (−15s) and the Runbook (−25s).
