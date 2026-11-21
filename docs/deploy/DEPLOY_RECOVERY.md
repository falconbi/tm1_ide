# When a deploy goes wrong

This is the practical guide. Every scenario below is something that can actually happen,
written as: **what you see → why → what to do → how you know it's fixed.**

Read the one that matches your screen. You do not need to read the rest.

---

## Before you start: the four things that are always true

1. **There is no undo.** A deploy that reached the target is corrected by fixing it on DEV and
   shipping again. Nothing in the IDE rolls a production server back.
2. **Drift stops everything.** If the target has changed outside the pipeline, no deploy to it
   will run until that is resolved. This is deliberate — it is what stops a deploy quietly
   overwriting someone's work.
3. **One deploy at a time, per target.** A second one is refused while the first is running.
4. **The report tells you what happened.** After any deploy, open it from the change set row
   (`⋯` → **Deploy report**), from **Deploy → History**, or from **Details** on the result.
   It names the step that failed. Read it before doing anything else.

---

## Quick index

| What you see | Scenario |
|---|---|
| Ship button greyed out | [1](#1-the-ship-button-is-greyed-out) |
| `Cannot close: N block-severity assertions failing` | [2](#2-tests-fail-so-the-change-set-will-not-close) |
| `Stopped before anything changed` | [3](#3-stopped-before-anything-changed) |
| `the release has failing dependencies` | [4](#4-the-release-cannot-be-built) |
| `commit … is not approved for …` | [5](#5-the-approval-no-longer-matches) |
| `PROD has drifted` | [6](#6-prod-has-drifted--the-most-common-one) |
| `PROD has its own version of <view>` | [7](#7-a-view-or-subset-exists-on-both-sides) |
| `already being deployed by …` | [8](#8-someone-elses-deploy-is-running) and [9](#9-nobody-is-deploying-but-it-says-someone-is) |
| `The pull failed part-way` | [10](#10-the-pull-failed-part-way--the-dangerous-one) |
| `safety checks failed` | [11](#11-deployed-but-the-safety-checks-failed) |
| `N views/subsets did not apply` | [12](#12-some-views-or-subsets-did-not-apply) |
| `the deploy record could not be written` | [13](#13-deployed-but-the-record-was-not-written) |
| `the incoming commit moved` | [14](#14-the-approval-is-for-a-different-commit) |
| It worked, but weeks later PROD differs | [15](#15-weeks-later-prod-no-longer-matches-what-we-shipped) |
| I sent the wrong change set / wrong target | [16](#16-i-shipped-the-wrong-change-set) |

---

## 1. The Ship button is greyed out

**What you see:** the Ship dialog is open, but the green button does nothing.

**Why:** two things must be true before it will send — a target chosen, and the approval box
ticked. The target deliberately starts empty: the IDE does not guess which server is
production.

**Do this:**
1. Pick the target from **Send to**.
2. Tick **I approve sending `<change set>` to `<target>`**.
3. The button enables and names the target.

**You're done when:** the button is green and says *Ship to `<target>`*.

---

## 2. Tests fail, so the change set will not close

**What you see:**
```
Cannot close: 3 block-severity assertions failing. Fix them, or set severity to warn.
```

**Why:** the model's own tests run before anything is committed. A failing block-severity
assertion means the model is known to be wrong; shipping it would carry that to production.

**Do this:**
1. Open **Deploy → Model health** (or the Tests panel) and read the failing assertions — each
   shows what was expected and what the model actually returned.
2. Fix the calculation on DEV, **or**, if the assertion itself is out of date, update its
   expected value and record why.
3. Re-run the tests, then close the change set and ship again.

**You're done when:** tests show `N/N passed` and the set closes.

**Note:** an assertion you believe is advisory can be set to `warn` severity — it still runs
and still reports, but no longer blocks. Do that deliberately, not to get past a red light.

---

## 3. "Stopped before anything changed"

**What you see:** a card saying the deploy was refused, with a message underneath.

**Why:** almost every refusal happens before the target is touched, so this is the safe
outcome — nothing was applied.

**Do this:** read the message; it names the exact reason. The common ones:

| Message | What it means | Next |
|---|---|---|
| `Build a release first` | nothing was built for this target | use **Ship** (it builds one) or the step-by-step **Build release** |
| `Readiness blockers must be fixed before pushing: …` | DEV's model is not in a shippable state | fix what is listed, then ship |
| `source does not match the approved change set` | the approval belongs to a different change set | ship from the change set that was approved |
| `Commit <x> is not a release built for <target>` | the approval was for a raw commit, not a built release | build the release, then approve |
| `the pull plan contains N objects not in this release` | the branch carries work nobody approved | do not retry — someone else's commit is on the branch; investigate |

**You're done when:** the ship completes, or the message is one of the ones with its own
scenario below.

---

## 4. The release cannot be built

**What you see:**
```
Refused: the release has failing dependencies — <object>: <message>
```

or, in the step-by-step view, a red line under **Build release**.

**Why:** a release is built from the target's last state plus *only* this change set's
objects. If the change set references something that is neither in it nor on the target, the
release would be broken — so it is refused rather than built.

**Do this:**
1. The message names the object and why.
2. Add that object to the change set (save it on DEV while the change set is open), or fix the
   reference on DEV.
3. Ship again.

**You're done when:** a release builds and shows the **Included** list.

---

## 5. The approval no longer matches

**What you see:**
```
Refused: the incoming commit moved (approved 2dae44c9, branch head is now 8f31b002).
Approve the new commit before deploying.
```

**Why:** an approval is bound to one exact commit. If the commit changed after you approved
it, the approval is void — that is the point of it.

**Do this:** ship again from the change set. The one-button path always builds a fresh release
and records a fresh approval, so it never hits this. In the step-by-step view, go to
**Approve** and approve the current release commit.

**You're done when:** the deploy runs.

---

## 6. PROD has drifted — the most common one

**What you see:**
```
PROD has drifted: M dimensions/Account.hierarchies/Account.json. Re-apply the change on DEV
in a change set, then release it. Deploys to this server are paused until drift is clean.
```

**Why:** the target no longer matches what the last deploy gave it. Something changed it
outside the pipeline — a nightly load, someone in PAW/Architect, another tool. Deploying on
top of that would silently discard whatever it was.

**First, decide which case you are in.**

### 6a. The change was intended

1. Open **Deploy → Drift** and read exactly what differs.
2. On **DEV**, make the same change (open a change set first so it is recorded).
3. Close the change set and ship it.
4. The deploy now carries that change; drift returns to clean.

### 6b. The change was a mistake

1. Undo it **on the target** (PAW or Architect) so the object matches what it was given.
2. Open **Deploy → Drift** and press **Check**.
3. When it reports clean, shipping resumes.

**You're done when:** Drift says clean and the next ship runs.

**Don't:** ship repeatedly hoping it clears. It cannot — the gate is doing its job.

**Know the cost:** one changed dimension pauses **every** deploy to that target, for everyone,
until it is resolved. This is the strongest argument for keeping manual edits off production.

---

## 7. A view or subset exists on both sides

**What you see:**
```
TM1_Test_PROD has its own version of WFP Assignment Default, and this release ships it.
Deploying would replace TM1_Test_PROD's version. Resolve it before approving: keep
TM1_Test_PROD's copy, or take this release's.
```

**Why:** views and subsets are applied over the API *after* the Git pull, and that application
replaces whatever is there. If both sides changed the same view, one version is about to be
lost. Unlike §6, views alone do not block deploys — only a view that this release also ships.

**Do this — pick a side:**

- **Take the release's version** (the usual case: DEV's is the one you want):
  1. Open the view on PROD and note what is there, in case you need it back.
  2. Ship. PROD receives DEV's version. Nothing else to do.

- **Keep PROD's version:**
  1. Open the view on PROD and copy its definition (MDX, or the rows/columns/titles).
  2. Paste it onto DEV, save, and commit that to the change set.
  3. Ship. Both sides now agree, so the release carries the same definition PROD already has.

  *There is currently no button that says "ship everything except this view". The message
  offers that choice; the workaround is the copy above.*

**You're done when:** the ship completes and the view on PROD is the version you chose.

---

## 8. Someone else's deploy is running

**What you see:**
```
Refused: TM1_Test_PROD is already being deployed by jane since 10:42. Wait for that deploy
to finish.
```

**Why:** one deploy at a time per target, so two people cannot interleave changes.

**Do this:** wait. The lock is released when that deploy ends, successfully or not. Ask them
if it has been longer than a few minutes.

**You're done when:** the message disappears and your ship runs.

---

## 9. Nobody is deploying, but it says someone is

**What you see:** the same message as §8, but the named person finished long ago (or the
backend was restarted mid-deploy, so the lock was never released).

**Why:** a deploy that died unexpectedly leaves its lock behind. A lock is only clearable once
it is **30 minutes old** — that window exists so a slow but live deploy is never unlocked
underneath itself.

**Do this:**
1. Press **Ship** (or **Deploy…**). It refuses with the message above — that is expected here.
2. On the red result card, press **Details**. The step-by-step view opens with the lock line at
   the **top**, on whichever step it lands.
3. Press **Clear lock** (it only appears once the lock is older than 30 minutes — that window
   exists so a genuinely slow deploy is never unlocked underneath itself).
4. Nothing else is needed; the clearing is recorded in the target's governance log (who cleared
   it, whose lock it was).
5. Ship again.

**You're done when:** the lock line is gone and the ship runs.

**Don't:** ask an admin to delete the lock file directly unless the button is unavailable —
the record of who cleared it matters.

---

## 10. The pull failed part-way — the dangerous one

**What you see:**
```
Pull failed: <TM1's own message>
```
and the card:
> **The pull failed part-way.** The target may hold some of the release but not all of it.
> Its recorded commit has NOT moved, so it no longer matches what it last received.
> **Next:** Do not run the deploy again. Open Drift first.

**Why:** this is the only failure where the target may be **half-updated**. The IDE does not
know which objects landed. Re-running immediately would push onto an unknown state.

**Do this:**
1. **Do not press Ship again.**
2. Open **Deploy → Drift → Check.** It shows exactly which objects differ from what the
   target last received — that is your list of what the failed pull changed.
3. Choose one:
   - **Undo on the target:** revert those objects in PAW/Architect to their pre-deploy
     definition, then check Drift until it is clean.
   - **Finish it from DEV:** if the half-applied state is acceptable, make DEV match it and
     ship that as a new change set.
4. When Drift is clean, ship again.

**You're done when:** Drift is clean and a ship completes.

**Worth knowing:** the failure itself is usually environmental (target unreachable, TM1
restarted, a permissions fault mid-pull). The report records TM1's own message — read it, it
usually says which.

---

## 11. Deployed, but the safety checks failed

**What you see:**
```
Deployed, but the safety checks failed
TM1_Test_PROD has the release and is at 55941a6b — but what it computes is now wrong.
Next: Fix it on DEV, commit, build a new release and deploy that. First failure: <description>
```

**Why:** the release is on the target, but an invariant that must hold for *any* data no longer
holds. The deploy was technically successful and the model is now wrong.

**Do this:**
1. Read the first failure in the report (**Details** → Checks) — it shows expected vs actual.
2. Reproduce and fix it on DEV.
3. Close, ship. The new release corrects the target.

**You're done when:** a ship ends with `safety checks N/N passed`.

**Don't:** assume the next deploy will fix it — only a change that addresses the cause will.

---

## 12. Some views or subsets did not apply

**What you see:**
```
2 views did not apply
The cubes, dimensions and processes are on the target. The subsets and views, which TM1 Git
does not pull, did not all land.
Next: Deploy the same release again — that step re-applies and is safe to repeat.
If it keeps failing: <type> <name>: <error>
```
(A sibling card, "some objects could not be confirmed", behaves the same way.)

**Why:** TM1's Git pull handles cubes, dimensions, processes and rules. Views and subsets are
applied separately, over the API, after the pull. That step can partly fail.

**Do this:**
1. Ship the same change set again. The step is idempotent — repeating it is safe and normally
   fixes it.
2. If it fails twice, the named object is the fault. The usual causes: a view referencing a
   subset or element that no longer exists; a subset containing a deleted element.
3. Fix that object on DEV, ship again.

**You're done when:** the ship completes with no such card, and the report shows the view or
subset in **What shipped**.

---

## 13. Deployed, but the record was not written

**What you see:**
```
Deploy applied, but the deploy record could not be written: <error>. Investigate before the
next deploy.
```

**Why:** the release reached the target, but the IDE could not write its record of "this target
is now at commit X". Drift and "already deployed" both depend on that record, so they will be
wrong from here.

**Do this:**
1. Stop shipping.
2. Check the target is writable by the IDE user — governance documents live under
   `Applications/Governance/Deployments/`. A rights change or a locked model is the usual cause.
3. Once writable, that record needs correcting before the next deploy (an administrator task;
   the report names the commit it should hold).
4. Ship again afterwards.

**You're done when:** **Deploy → History** shows that commit as the latest deploy and Drift
reports clean.

---

## 14. The approval is for a different commit

**What you see:** one of
```
Refused: commit <x> is not approved for <target>. Record an approval first…
Refused: cannot verify the commit being deployed (approved-incoming <a>, plan commit <b>).
```

**Why:** the plan TM1 produced does not match the approval — the release was rebuilt, DEV moved,
or the approval was recorded against a different commit.

**Do this:** ship again from the change set (builds a fresh release and approval), or in the
step-by-step view go back to **Build release** then **Approve** the commit shown.

**You're done when:** the deploy runs.

---

## 15. Weeks later, PROD no longer matches what we shipped

**What you see:** nothing until you ask — **Deploy → Drift → Check** reports differences, or the
next ship refuses with `PROD has drifted`.

**Why:** something changed the target after the deploy: a load process, a person in PAW, another
tool. Expected over time.

**Do this:** exactly §6. Decide whether the change was intended. If it was, bring it into DEV
through a change set and ship it, so the pipeline owns it. If it was not, undo it on the target.

**To see what a past deploy actually did:** the change set row `⋯` → **Deploy report**, or
**Deploy → History** → the commit. Newer deployments record what shipped, who approved it, the
check results and the drift at the time. Deployments from before that was introduced show only
the commit, time and summary, and say so.

---

## 16. I shipped the wrong change set

**What you see:** the completion card is green. The change set was not the one you meant, or
the target was not the one you meant.

**Why:** it happens. The dialog names the target in the approval sentence precisely so this is
visible before you click.

**Do this:**
1. **Open the deploy report** and note exactly what shipped — that list is what is now on the
   target.
2. If the change was harmless, no action. If it must be undone:
   - **Undo it through the pipeline:** on DEV, revert each shipped object to its previous
     definition, put that in a new change set, and ship it. This is the supported route, and it
     leaves a record of both changes.
   - **Undo it by hand** only if the model is currently unusable, and then bring DEV back into
     line so drift does not block the team.
3. If it went to the wrong target entirely, the same applies on that target — it now holds the
   release, so it has to be corrected there.

**There is no "un-deploy".** The report is what tells you the size of the job.

---

## Things that look like failures but are not

| What you see | What it is |
|---|---|
| *"Checked 0 differences"* on Drift right after a ship | normal — nothing has had time to change |
| A green **Check for drift** button on the result screen | a manual re-read, not a next step. **Done** closes |
| The same change set listed under **Show N finished** | deployed sets move there; that is the "done" shelf |
| `Resume` missing on a deployed change set | correct — a shipped set cannot be reopened; start a new one |
| The Ship dialog showing "Done — PROD is up to date" for a set you never shipped | stale panel from an earlier run — reload the page (fixed in the current build) |

---

## Appendix — where each message comes from

For whoever maintains this: the messages above are the exact strings returned by
`core/git-deploy.js` (`prepare` for Review, `execute` for the deploy), with drift text from
`driftRefusal`, the view/subset rule from `viewSubsetConflicts` in `core/git-release.js` (used
by both paths), locks from `core/git-lock.js`, approvals from `core/git-approvals.js`, and the
six user-facing outcome classes from `client/src/lib/deploy/deploy-outcome.js`. The per-deploy
record is written by `core/deploy-records.js` from the `execute()` result and read back through
`/api/deploy/record?target=&commit=`.
