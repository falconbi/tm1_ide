# Change Sets — narration script

First video of the Deployment playlist. **[Bracketed]** lines are on-screen cues — don't read them out. Approximate times in brackets.

Record on **TM1_Test_DEV**, model **WFP**. Before recording: no change set open, and make sure the model's tests pass (otherwise Close will be blocked on camera — section 5 shows that on purpose only if you want it). The worked change: a comment in the **WFP Workforce Cost** rules and a new subset on **WFP Cost Centre**.

---

## Intro (~20s)

**[IDE open on TM1_Test_DEV, header showing "Change set"]**
This video is about change sets: how the IDE records every change you make to a model, why that matters, and how a change set becomes the thing you test, review and deploy. Everything in the next videos, assertions, Git and deploys, starts here.

## 1. Why change sets (~40s)

On a TM1 server, a change is just a save. Someone edits a rule, adds an element, tweaks a process, and the server takes it. Nothing records why, nothing groups it with the other changes it belongs to, and a month later nobody can say which edits made up "the new bonus rule".

A change set fixes that. It's a named piece of work. While it's open, every change I make on this server is recorded into it: what object, what happened to it, who did it and when. When the work is done, I close it, and the change set is what gets tested, reviewed and deployed: exactly those changes, nothing else that happens to be on the server.

## 2. Start one (~30s)

**[Click Change set in the header, type a name, press Enter]**
Change set, in the header. I give it a name that says what the work is, here, cost-centre-reporting, and press Enter.

**[Point to the header]**
The header now shows it's open: the name, how many changes it holds, who I'm signed in as, and on which server. The green dot means it's recording.

And if I forget? The first time I save something with no change set open, the IDE asks me to name one before it records the change. Work doesn't slip through unrecorded.

## 3. Make the changes (~35s)

**[Open the WFP Workforce Cost rules, add a comment, save]**
Now I just work as normal. I add a comment to the WFP Workforce Cost rules and save.

**[Open the Subset Editor on WFP Cost Centre, build a subset, save]**
Then a new subset on WFP Cost Centre, and save.

**[Point to the header count]**
The count in the header goes up with each save. I didn't do anything extra: the change set records it as I go. Rules, processes, dimensions and their elements, attributes, hierarchies, subsets, views and cubes: creates, saves and deletes are all recorded.

## 4. Read what's in it (~50s)

**[Click the change set name in the header to open the panel]**
Clicking the change set opens the Change Sets panel. Open this one, and every change is listed: the object, what happened to it, and the time. Click an entry and the object opens in its editor.

**[Hover an entry, click the diff icon]**
Hover an entry and the diff button shows exactly what changed: the object before, and after, side by side. That's the question every reviewer asks, answered without hunting.

**[Click the pencil, type a note]**
The pencil adds a note: the why behind the change, in plain words, for whoever reviews or deploys it.

**[Click the report icon]**
And the report opens the whole change set as one page: every object it touched, with its changes and diffs. Copy as text puts it on the clipboard, ready for a ticket or an email.

## 5. Test and close (~50s)

**[Click Test on the open change set]**
Before closing, Test runs the model's tests: the checks written for this model, which I'll cover properly in the Assertions video. The result shows right here: how many passed, and whether any blocking test failed.

**[Point to Close]**
That matters, because Close won't let a change set go with a blocking test failing. Fix the problem first, then close. A broken change never becomes a finished one by accident.

**[Click Close]**
Close stops recording. The change set is now a finished, fixed record: its changes, who made them, the note, and the test result at the moment it closed. On a server set up for it, that record is written into the model itself, in the server's Applications folder, so the model carries its own history, not the IDE.

**[Hover the closed change set, point to Resume]**
If I find I've missed something, Resume reopens it, and the next changes go into the same set.

## 6. From change set to deploy (~25s)

**[Point to the rocket icon on the change set, then Release in the panel header]**
The rocket deploys this change set. Release, at the top, deploys everything changed since the baseline was taken. Both open the Deploy Center, which is the next video.

**[Click Show deployed]**
Once a change set has shipped, it leaves this list, because its record now lives in Deploy History. Show deployed brings those back when I need them.

## Outro (~20s)

So that's change sets: start one, work as normal, and every change is recorded. Read it back with diffs, notes and a report; test it, close it, and it's ready to deploy, exactly that work and nothing else.

It isn't only for people, either. When an AI agent builds through the IDE's MCP server, its work goes into a change set too, and gets tested and reviewed the same way.

In the next video: assertions, the tests that decide whether a change set can close.

---

Total about **4 min 30 s**. The easiest cuts: the "if I forget" line in section 2 (−10s), the report paragraph in section 4 (−12s), the AI line in the outro (−8s).
