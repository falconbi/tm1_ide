# Cube Map (Understanding the model) — narration script

Follows the Views and data short. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.

Record on **TM1_Test_DEV**. Before recording, open the Cube Map, choose **WFP** in the Model filter, and start with nothing selected. The worked cube is **WFP Workforce Cost**.

---

## Intro (~20s)

**[Cube Map open on the full WFP model, nothing selected]**
This is the Cube Map, on TM1_Test_DEV. In this video I'll show what it is, why it's useful, how it's built, and how to use it to understand a model.

## 1. What it is and why it's useful (~75s)

When you inherit a TM1 model, or come back to one after a few months, the first question is: how does it all fit together? A live diagram helps you refresh your own understanding, and it helps you explain the model to another developer, at a handover or in a model review.

The Cube Map answers that question from the model itself. Every box is a cube. Every line is a real connection, worked out from the rules and the TI code on the server each time the map loads. Nobody draws it and nobody maintains it, so it can't drift away from what the model actually does.

**[Point to the legend]**
The legend explains the lines.
Amber is a rule reading another cube with DB.
Dashed is a feeder.
Blue is a TI process reading or writing a cube.
The other colours show a process changing a dimension, or one process calling another.

**[Point to a Lens tag]**
You'll also see a Lens tag on some processes, so first: what is a Lens?
A Lens is a web page built on top of the TM1 model, for the people who plan in it rather than the developers who build it. A manager opens it in a browser and sees their own numbers, such as their people, positions and costs, laid out for the job they're doing. When they press a button on the page, such as Hire or Change assignment, a TI process on the server does the work. The page holds no data and no logic of its own; everything stays in TM1.

So the Lens tag marks a process that a Lens button runs. This sample model leans on TI on purpose. The heavy calculations run in TI rather than in rules, which keeps the feeders light and the server small, and every Lens action is a TI process. So expect to see a lot of processes on this map.

## 2. How it's built (~35s)

The map is a React component inside the IDE. The graph itself is drawn with **React Flow**, which handles the panning, zooming, boxes and connections. **Dagre** works out the layout automatically, so nobody places a box by hand.

The data comes from the IDE's Node/Express server. It reads the cubes, rules, processes, dimensions and chores through the **TM1 REST API**, then scans the rules and the TI code for DB references, feeders, CellGet and CellPut calls, dimension changes and ExecuteProcess calls. The map is a view over the live model, nothing more.

## 3. Show — switch the layers on and off (~40s)

**[Click each Show switch in turn]**
The Show switches work the same on the full map and when you trace a cube:
Rules,
Feeders,
Processes,
and Dimensions.
Lens actions is a fifth switch. It hides the processes the Lens buttons run, along with any helpers only they use.

Switch on what you're interested in and switch off the rest. The map redraws and fits itself to the screen each time, so it only shows what you asked for.

## 4. Pick WFP Workforce Cost (~75s)

**[Click WFP Workforce Cost]**
Now let's pick a real cube: WFP Workforce Cost.
The map focuses on it and dims everything else. The thread at the top now reads Full map › WFP Workforce Cost.

**[Point to the right panel]**
A panel opens on the right for the focused cube. This is where you get the detail, and where you can fine-tune what you see around the cube.

At the top, Rules and View open the cube's rules or its default view. The split half of each button opens it in a pane beside the map, so you keep your place. Below them are counts of the objects connected to this cube.

**[Open Fine-tune the trace]**
Fine-tune the trace is where you choose which kinds of link count: Rules, Feeders, TI reads, TI writes, Calls, Dim changes and Dim usage. It's the detailed version of the Show switches.

**[Scroll the relationship lists]**
Then come the relationships: the cubes its rules read from, the cubes that reference it, its feeders, the TI processes that write into it, the processes that read from it, and the processes that call those writers.

The Lens tag appears on every process a Lens uses, here and in the Explorer, so you can tell a front-end process from a back-end one at a glance.

Between them, the map and the panel let you follow the logic of a complex model by drilling into the diagram, instead of opening objects one by one.

## 5. The thread and Steps away (~55s)

**[Click a connected cube, then another, then another]**
Let's follow the thread. Click a connected cube and the map refocuses on it. Click another and the thread grows, and again.

The thread keeps every cube you've visited, in order. Back, or Backspace, goes one step back, and you can click any earlier step to jump straight to it. You never get lost.

**[Click 1, then 2, under Steps away]**
Steps away sets how far the map reaches out from the focused cube.
One shows direct links only.
Two goes two steps out: the neighbours of the neighbours.
Each button shows how much it would bring in before you click it.

On this model, two steps gets busy quickly. That's the design choice from earlier: lots of TI, much of it behind Lens buttons. In another model, the same processes could just as easily be action buttons in Planning Analytics Workspace. Either way, the Lens actions switch and the Processes switch are how you thin it out.

## 6. Runbook (~75s)

**[Switch the mode tab to Runbook]**
Now switch the Cube Map to the Runbook tab. A Runbook shows a model's workflow as it's defined in its **chores**, the sequences TM1 already uses to run an update.

The IDE builds it all from TM1. The chore list comes from the server. Each chore's processes come in their stored order. The description comes from each process's Prolog header or saved summary, and the steps come from scanning the process code.

**[Point to the chore list]**
This model has three chores. WFP Recalculate Cost is **scheduled**: it runs on TM1. WFP Month End and WFP Year Start are **runbook only**: they're inactive, so they never run on a schedule. They exist to show the workflow.

That's the one rule for a Runbook: if a sequence matters, it needs a chore. If the master process isn't on a chore, give it one, inactive if it should only be reviewed. Set your chores up well, and the Runbook presents them well.

**[Click WFP Month End, then Steps]**
For each process I see its description. Steps expands it in code order: what it reads, what it writes, what it calls, and which rule cubes each write sets off.

**[Click View on map]**
View on map takes the chore's processes, and everything they touch, onto the Cube Map. That's the bridge between what runs and what it changes. From here it's the same map as before: switch on TI, click into other cubes, and use the thread to go back to where you started.

## 7. Play a run (~2:15)

**[Switch the mode tab to Play a run]**
Now a feature that shows a run as a sequence on the map.
Models are full of processes, and the usual question is: if I run this, what happens, in what order, and what does it touch?
Play a run answers that without running anything. It's a presentation only, and no data in the model changes.
This is the feature that makes the Cube Map more than a picture.

**[Pick WFP Month End and press Play]**
Start from a chore. WFP Month End is runbook only, so it never fires on a schedule.
As it plays, the current connection and box light up. The bar tells me where I am: the path at the top, the step number, and what this step does.

Play and Pause are the same button.
The arrows move one step at a time, and Follow pans the map to the current step when it goes off screen.

**[Pause, then click the info button]**
Now pause and ask: what is this step?
The info button opens the detail card for this exact read, write or call.
It names the process and its parameters, the cube being read or written, the measures it writes, and the rule lines and dimensions behind it.
That's the information I'd otherwise collect by opening several tabs and holding it all in my head.

The card also tells me where to go next.
For a process: Open process.
For a cube: Open view, and Open rules when it has rules.
For a dimension: Open dimension.
These open beside the map, so I don't lose the run.

**[Click Open process]**
Open process pauses the run and docks the TI beside the map.
This is where the feature pays off: I can read the actual code next to the step that triggered it.
The map stays on the same step, so I can read, go back, and carry on.

**[Pick WFP Change Assignment]**
You don't need a chore to play a run. Any single process works too.
WFP Change Assignment shows one process: its reads and writes, and the recalculation helper it calls.
Chore or process, the controls are the same.

**[Let it play to the end]**
At the end, the player says the run is finished.
The order follows the code as written, and loops play once.
Remember, it's a reading of the path, not a replay of a real execution. Nothing in the model has changed.

## Outro (~20s)

So that's the Cube Map: what it is, how it's built from the live model, how to switch the layers, pick a cube and follow its relationships, open the rules or default view beside it, and use the Runbook and Play a run to understand an update before it happens.

---

Total about **8 min 25 s**. The easiest cuts: section 2 "How it's built" (−35s), the second Play a run example (−20s), the Lens explanation in section 1 if the Lenses short covers it (−20s).
