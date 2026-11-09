# Cube Map (Understanding the model) — narration script

Follows the Views and data short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.

Record on **TM1_Test_DEV**. Before recording, open the Cube Map on the Workforce model, choose **WFP** in the Model filter so the LAB cubes are hidden, and start with nothing selected. The worked cube is **WFP Workforce Cost**.

---

## Intro (~20s)

**[Cube Map open on the full WFP model, nothing selected]**
This is the Cube Map, on TM1_Test_DEV. In this video I'll show what it is, why it matters, how it's built, and how to use it to read the whole Workforce model. We'll finish with the Runbook and a played process run.

## 1. What it is and why it's useful (~45s)

**[Click Fit to screen]**
When you inherit a TM1 model, or come back to one after a few months, the hardest question is the simplest: how does it all fit together? Which cubes feed which, and which processes move the data? Normally that answer lives in someone's head, or in a diagram that was out of date a week after it was drawn.

The Cube Map answers it from the model itself. Every box is a cube. Every line is a real connection, worked out from the rules and the TI code on the server each time the map loads. Nobody draws it and nobody maintains it, so it cannot drift away from what the model actually does.

It is useful in three ways: it shows the shape of the model, it shows the source of any number, and it shows the path a process run will take.

**[Click Legend]**
The legend explains the lines. Amber is a rule reading another cube with DB. Dashed is a feeder. Blue is a TI process reading or writing a cube. Other colours show a process changing a dimension or calling another process. A Lens tag marks a process a Lens button can run.

**[Point to the bar on a cube with rules]**
The bar means the cube has rules. The longer the bar, the more rule lines it has, so the busiest calculation cubes stand out.

## 2. How it's built (~35s)

**[Point around the graph]**
The map is a React component inside the IDE. The graph itself is drawn with **React Flow** — the panning, zooming, nodes and connection handles. **Dagre** calculates the automatic layout, so nobody places a box by hand.

The data comes from the Node/Express server. It reads cubes, rules, processes, dimensions and chores through the **TM1 REST API**, then scans the rules and TI code for DB references, feeders, CellGet/CellPut calls, dimension changes and ExecuteProcess calls. The Lens process usage comes from the Lenses' declared run processes.

So there is no diagram database and no external drawing service. The map is a view over the live model. If the code changes, the next load changes the map.

## 3. The Map options — show and hide the layers (~65s)

**[Point to the Show row]**
Show is the same set of switches on the full map and in a cube trace: Rules, Feeders, Processes and Dimensions. Lens actions is a fifth switch.

**[Untick Rules; pause]**
With Rules off, the rule-to-rule links go. What remains is the movement of data through feeders and TI. This is useful when the calculation chain is too noisy and I only care about what loads or copies data.

**[Tick Rules; untick Feeders; pause]**
With Feeders off, the feeder edges go. The calculation rules are still there, but the map no longer shows where calculated values are fed. This is the reading-only view of the logic.

**[Tick Feeders; untick Processes; pause]**
With Processes off, the process boxes and their read/write edges go. Dimensions become unavailable, because on the full map dimensions are shown through the processes that change them. What remains is the cube-to-cube relationship: the shape of the model without the movers.

**[Tick Processes; untick Lens actions; pause]**
Lens actions is the interesting one. Turn it off and the processes that only a Lens button runs — and helpers only they run — leave the map. What is left is the back-end flow: loads, recalculation, snapshots. Turn it back on and the front-end actions return.

**[Point to Model, Search and Spotlight]**
The Model filter shows one model at a time by name prefix. Search finds a cube. Spotlight dimension lights up every cube that uses a dimension. Those are the finding controls; the Show row is the explaining control.

## 4. Pick WFP Workforce Cost (~70s)

**[Clear any search; click WFP Workforce Cost in the cube list]**
Now let's pick a real cube: WFP Workforce Cost. The map focuses on it, dims the rest, and the thread at the top starts with Full map › WFP Workforce Cost.

**[Point to the right-hand panel, top to bottom]**
This is the context of the cube I selected. Across the top are its dimensions, then the actions: Rules and View. The small split buttons open Rules or the Default View beside the map instead of replacing it.

Below that are the stats or KPIs for this cube: dimensions, rule lines, connected objects, TI writers and TI readers.

**[Point to each section]**
Then the relationships: the cubes its rules read from, the cubes that reference it, its feeders, the TI processes that write into it, the processes that read from it, and the processes that call those writers. A Lens tag shows where a Lens button can start a process.

That is the direct answer to “where does this number come from?” — without opening every process in the model.

**[Open Fine-tune the trace]**
Fine-tune the trace is where I change which link kinds count: Rules, Feeders, TI reads, TI writes, Calls, Dimension changes and Dimension usage. This is the detailed version of the Show switches.

**[Click a dimension in the Dimensions list]**
I can also filter by a dimension. Clicking one narrows the current trace to the cubes using that dimension and adds “with <dimension>” to the thread. Back or the chip's X removes it.

**[Hover a TI process; click it]**
Every TI name here opens its process. A process that calls helpers folds them into its box with a **+n** count. Click **+n** and the chain opens into the individual TI processes; click any one to open it, and the thread still takes me back.

## 5. The thread, levels and helpers (~55s)

**[Click a connected cube, then another]**
Now I follow the numbers. WFP Workforce Cost gets its numbers from other cubes, and those get theirs from others again. Click a connected cube, and the map refocuses; click the next, and the next.

**[Point to the thread at the top]**
The thread keeps every cube I've visited, in order. Back or Backspace goes one step back. Clicking any name in the thread jumps back to it. Full map or Escape leaves the thread and returns to the whole model, so I can never get lost.

**[Click Steps away 1, then 2]**
Steps away controls how far the map reaches. One is direct links only. Two is two steps out: the neighbours of the neighbours. That wider view matters here, because it brings in the earlier cubes whose Lens buttons start the downstream processes — and their process boxes carry the Lens tag. The number beside each button previews how many objects it will add.

**[Click +n on a process with helpers]**
Most load chains are one box with a +n. That box is the top-level process; the helpers it calls are folded in. Click +n and each helper appears as its own TI. The folding is calculated from ExecuteProcess calls every time the map loads, so it stays right without anyone tagging the helpers.

## 6. Runbook (~75s)

**[Click Runbook; select a chore]**
The Runbook is the presentation of the model's **chores** — the sequences TM1 already uses to run an update. It is read-only; it runs nothing.

It is built from TM1: the chore list comes from the server, each chore's processes come in their stored order, the description comes from each process's Prolog header or saved summary, and the steps come from scanning the process code. That is why it does not need a hand-written phases file and cannot get out of step with the model.

**[Point to the chore list]**
On the left are the chores. A scheduled chore runs on TM1; a runbook-only chore is inactive and never runs on a schedule. If the master process is not on a chore, give it one — inactive if it should only be reviewed.

**[Point to a process and click Steps]**
For each process I see its description, then Steps expands it in code order: what it reads, what it writes, what it calls, and the rule cubes each write sets off. So I can review an update before it runs, not after it has gone wrong.

**[Click View on map]**
View on map takes that chore's processes and everything they touch onto the Cube Map. That is the bridge between “what runs” and “what it changes”.

## 7. Play a run (~95s)

**[Click Play a run]**
Play a run shows the order a process will execute in. It does not run anything; it walks the code path across the map.

**[Choose ⏱ WFP Month End (inactive); click Play]**
Start from a chore: WFP Month End. It is runbook-only here, so it never fires on a schedule, but playing it shows exactly what it would do: WFP Load HR Assignments, then WFP Calc Variances, then WFP Snapshot. The player follows the chore across those processes, and WFP Snapshot itself calls the core version copy, so the helper chain appears too.

As it plays, the current connection and node light up. The bar tells me where I am: the path at the top, the step number, and the caption. On the right are the controls. Play and Pause are the same button. The arrows step back and forward. The speed menu slows the run to half speed or speeds it up. Follow pans to the current step when it leaves the screen.

**[Pause on WFP Load HR Assignments; click the info button]**
Pause first. The highlight stays on the step, so I can read it properly. The info button — What is this step? — opens the detail card for this exact read, write or call. It names the process and its parameters, the cube being read or written, the measures it writes, and the rule lines and dimensions behind it.

The card is how I see the information without leaving the run. If the step is a process, I get Open process. If it touches a cube, I get Open view, and Open rules when the cube has rules. A dimension gets Open dimension.

**[Click Open process]**
Open process pauses the run and docks the TI beside the map, so I can read the actual code next to the step that triggered it. Alt-click opens it in the pane instead. This is where I check the CellGet, the CellPut, or the ExecuteProcess call I just saw on the map. When I have finished, the map is still on the same step, and I can press Play again or step on.

**[Step to WFP Calc Variances, then WFP Snapshot]**
The same card follows each step. On WFP Snapshot, Open process shows the wrapper; back on the map, click +n on that process box and the core copy it calls unfolds as its own TI. That is the difference between guessing what an update does and reading the two lines that do it.

**[Choose WFP Change Assignment from the same list]**
The list is the switching point. I can change the start without closing the player: here is one process, its reads and writes, and the recalculation helper it calls. The map is rebuilt for that run, so I get a focused story rather than the whole model.

**[Pause on the last step]**
At the end the player says the run is finished. The order follows the code as written; loops play once. It is a reading of the path, not a replay of a real execution.

## Outro (~15s)

**[Escape back to the full map]**
So that's the Cube Map: what it is, how it's built from the live model, how to switch the layers, pick a cube, follow its relationships, open Rules or the Default View beside it, and use the Runbook and Play a run — pausing on a step and opening the TI — to understand an update before it happens.

In the next video: the editing features that make everyday work in the IDE faster.

---

Total about **7–8 minutes**. To shorten, the easiest cuts are: the Show walk-through in section 3 (−30s), the helper example in section 5 (−15s), and one of the two Play a run examples (−20s).
