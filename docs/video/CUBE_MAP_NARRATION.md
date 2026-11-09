# Cube Map (Understanding the model) — narration script

Follows the Views and data short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.

Record on **TM1_Test_DEV**. Before recording, open the Cube Map on the Workforce model, choose **WFP** in the Model filter so the LAB cubes are hidden, and start with nothing selected. The worked cube is **WFP Workforce Cost**.

---

## Intro (~15s)

**[Cube Map open on the full WFP model, nothing selected]**
This is the Cube Map, on TM1_Test_DEV. In this video I'll show how to read a whole TM1 model from one page: what connects to what, where a number comes from, and what a process run actually does, step by step. I'll use the Workforce model and the WFP Workforce Cost cube.

## 1. The whole model on one page (~45s)

**[Map tab selected; click Fit to screen]**
When you inherit a TM1 model, or come back to one after a few months, the hardest question is the simplest: how does it all fit together? Which cubes feed which, and which processes move the data? Normally the answer lives in someone's head, or in a diagram that went out of date a week after it was drawn.

The Cube Map answers it from the model itself. Every box is a cube. Every line is a real connection, worked out from the rules and the TI code on the server when the map loads. Nobody draws it and nobody maintains it, so it can't drift away from what the model actually does.

**[Click Legend]**
The legend explains the lines. An amber line is a rule in one cube reading another with DB. A dashed line is a feeder. A blue line is a TI process reading or writing a cube; other colours show a process changing a dimension or calling another process. A Lens tag marks a process that a Lens can run.

**[Point to the Show row]**
Show is the same set of switches everywhere: Rules, Feeders, Processes and Dimensions. Lens actions is a fifth switch: turn it off and the processes only a Lens button runs — and helpers only they run — leave the map, so you see the back-end loads and calculations instead.

**[Point to the bar on a cube with rules]**
The bar on a cube means it has rules. The longer the bar, the more rule lines it has, so the busiest calculation cubes stand out.

**[Click Rotate; open Advanced; point to Groups and Module]**
Rotate changes the direction of the map. Advanced opens the grouping controls: Groups clusters related cubes, and Module focuses one module at a time.

## 2. The left sidebar — finding things (~40s)

**[Model dropdown: All models → WFP]**
The left side is for finding things. The Model filter shows one model's cubes and processes at a time by name prefix. Here it's WFP only, so the lab copy is out of the way.

**[Type WFP Cost Centre in Spotlight dimension]**
Spotlight answers the question every developer asks before changing a dimension: where is it used? Type a dimension and every cube built on it lights up. Before I add, move or delete a cost centre, I can see every cube that change will reach.

**[Clear Spotlight]**
**[Type WFP Workforce Cost in Search cubes; click it]**
Search finds a cube by name. Click it, and the map focuses on that cube. Its direct connections stay bright and the rest of the model fades.

**[Click a dimension in the right-hand Dimensions list]**
Clicking a dimension filters the current trace to the cubes that use it, and adds `with <dimension>` to the thread. Back, or the X on the chip, removes the filter.

## 3. The right sidebar — one cube in detail (~40s)

**[Point down the cube panel, section by section]**
The panel on the right is everything about the cube I've picked, in one place. First its dimensions, in the cube's own order. Then the rules side: what it reads from, what is referenced by it, and what its feeders point at. Then the TI side: every process that writes into this cube, every process that reads from it, and the processes that call those writers. A Lens tag shows where a Lens button can start a process.

That last part matters when something goes wrong. If a number looks wrong, this lists every process that could have put it there.

**[Point to Rules and View]**
Rules opens the rules editor; View opens the cube's Default view. The small split button beside each opens it beside the map instead of replacing it.

**[Double-click the cube on the map]**
Double-clicking a cube on the map opens its rules straight away.

## 4. Following a thread (~55s)

**[Click a connected cube, then another]**
Now I can follow the numbers through the model. WFP Workforce Cost gets its numbers from other cubes, and those get theirs from others again. Click a connected cube and the map refocuses on it. Click the next, and the next. This is how I trace where a cost really comes from: from the cost cube, back to the pay cube, back to the rates and assumptions underneath.

**[Point to the bar at the top: Full map › WFP Workforce Cost › …]**
The bar at the top keeps the whole thread, like breadcrumbs. It shows every cube I've visited, in order. Back, or Backspace, goes one step back. Clicking any name in the thread jumps straight to that cube. Full map, or Escape, leaves the thread and shows the whole model again.

**[Point to Steps away — click 1, then 2]**
Steps away sets how far the map reaches from here. One is direct links only; two includes their links; the number beside each button previews how many objects that setting will bring in. It follows the kinds of link switched on under Show.

**[Open Fine-tune the trace in the right panel]**
Fine-tune the trace chooses exactly which links count: Rules, Feeders, TI reads, TI writes, Calls, Dimension changes and Dimension usage. Switch the TI kinds off and I see only the live calculation chain; switch them back on and the loads and movements return.

## 5. The player — a process run, step by step (~50s)

**[Click Play a run]**
The map shows what's connected. Play a run shows what happens, and in what order. I pick where the run starts: any process or chore that reads, writes or calls something.

**[Click Play; let it run a few steps; Pause]**
Each step lights up the next thing the code does, in order: the cube it reads, the cube it writes, the dimension it changes, and the next process it calls. When one process calls another, the run follows it, so a whole chain plays out as one story.

**[Click Previous and Next; point to Speed and Follow]**
Pause at any point, step back or forward, slow it down or speed it up. Follow keeps the current step in view without zooming.

**[Click What is this step?]**
What is this step? explains the step I'm on: the process, the parameters it was given, the cube or dimension it touches, and what it writes. For someone new to the model, this is how you learn a nightly load in minutes instead of reading every process line by line.

**[Click Back to the start; close Play a run]**
Back to the start replays the run from the top.

## 6. Runbook (~35s)

**[Click Runbook; select a chore]**
Runbook goes one level higher. It lists the model's chores — the order a model update runs in. A chore can be scheduled or runbook-only; it runs nothing here. It is a read-only review.

Select a chore and I see each process in order, with the description from its Prolog header. Open Steps on a process and the sequence unfolds in code order: what it reads, what it writes, what it calls, and the rule cubes each write sets off.

**[Click View on map]**
View on map shows that chore's processes and everything they touch on the Cube Map. Before a big update runs, I can review it process by process and see what it will change, instead of discovering it afterwards.

## Outro (~15s)

**[Escape back to the full map]**
So that's the Cube Map: the whole model on one page, built from the rules and the code, so it stays current. Find a cube, follow its thread, play a run, and review a chore in the Runbook.

In the next video: the editing features that make everyday work in the IDE faster.

---

Total about **5 minutes**. If it needs to come down, the easiest cuts are: the Lens-actions line in section 1 (−10s), the double-click line in section 3 (−5s) and the Fine-tune example in section 4 (−15s).
