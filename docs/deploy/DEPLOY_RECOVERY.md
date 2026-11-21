# Deploy recovery — every failure and how the user gets out of it

Status: **for review**. This describes what the code does today, including the places where
the answer is "there is no path in the IDE". Those are listed plainly in §7 — they are the
part worth reviewing.

Source of truth: `core/git-deploy.js` (`prepare`, `execute`), `core/git-release.js`,
`core/git-lock.js`, `core/git-approvals.js`, `routes/deploy.js`,
`client/src/lib/deploy/deploy-outcome.js`, `client/src/components/ShipDialog.jsx`,
`client/src/components/DeployWizard.jsx`.

---

## 1. The one idea that decides recovery

A deploy is not one step. It is:

```
preconditions → pull (TM1 Git) → record → subsets/views over REST → verify landing → reconcile → control checks
```

Each stage fails differently and leaves the target in a **different state**. So the only
useful question in recovery is:

> **Where did it stop, and what does the target hold right now?**

There are exactly four answers.

| State | Meaning | Recovery shape |
|---|---|---|
| **Untouched** | Nothing reached the target. | Fix the reason, run it again. |
| **Part-changed** | The pull died part-way. Unknown mix. | **Stop.** Do not re-run. Read Drift first. |
| **Changed, bookkeeping wrong** | Objects are on the target; the IDE's record is not. | Fix the record before anything else ships. |
| **Changed, but wrong** | The release is on the target and computes wrongly, or parts of it did not land. | Fix on DEV, ship a new release. |

**There is no automatic rollback anywhere in the pipeline.** Not a missing feature to note in
passing — it is the design (`15_RELEASE_ON_LIVE.md`): TM1 has no undo for a pull, and a
half-understood automatic revert is more dangerous than a human fixing forward.

---

## 2. Before anything reaches the target (target untouched)

Every one of these returns `executed: false`. The UI card says
**"Stopped before anything changed — the target is untouched."**

### 2.1 Tests fail when closing the change set

```
Cannot close: N block-severity assertions failing. Fix them, or set severity to warn.
```

**Recovery:** fix the assertion on DEV (or set its severity to `warn` if it is advisory),
re-run the tests, close again. Deploy was never attempted.

### 2.2 Commit / push refused

```
Readiness blockers must be fixed before pushing: <blockers>
Change set "<name>" is retired as a phantom change set — restore it before committing.
```

**Recovery:** retire → unretire the change set (row `⋯` menu), or fix the blockers the
readiness check named. Then ship again.

### 2.3 Release cannot be built

```
Refused: the release has failing dependencies — <object>: <message>
Change set "<name>" is retired as a phantom change set — restore it before releasing.
The release could not be built.            (client, when no releaseCommit comes back)
```

**Recovery:** the dependency check is telling you the change set references objects that are
not in it and are not on the target — add the missing object to the change set (it gets added
automatically as a dependency at approve time in the normal path, but a *failing* dependency
means it could not be resolved), or fix the object on DEV. Then ship again.

### 2.4 Nothing was ever built for this target

```
Build a release first — deploys ship only a change set’s objects. First-time setup
(first-pull) is the only whole-model path.
```

**Recovery:** this comes from `execute` being called without a `release_commit` on the change
set. In the one-button path it cannot happen (release is built immediately before). In the
step-by-step path: go back to **Build release** and build one. This is the guard that stops
"deploy whatever is on DEV".

### 2.5 Commit is not approved for this target

```
Refused: commit <id> is not approved for <target>. Record an approval first (the Approve
step), then deploy.
Refused: commit <id> is not a release built for <target>. Build the release first, then
approve it.
Refused: the change set for commit <id> has failing block-severity tests. Fix and re-close
before approving.
```

**Recovery:** approve the release commit (Approve step), or fix the failing tests and
re-close. Approvals are bound to `(target, commit)` — a new commit never inherits one.

### 2.6 Source does not match

```
source does not match the approved change set
source is required when the approval has no linked change set
Could not determine the incoming commit from <source>: <error>
```

**Recovery:** the approval records the change set; the deploy must run against the same
server. Ship from the same change set. The third is a connectivity/Git problem on the source
— check the source server is signed in and its Git remote is reachable.

### 2.7 Another deploy holds the lock

```
Refused: <target> is already being deployed by <user> since <time>. Wait for that deploy
to finish.
```

**Recovery:**
- If a real deploy is running: wait.
- If it is stale (backend died mid-deploy), the lock becomes clearable after **30 minutes**.
  In the wizard at Deploy/Verify there is a **Clear lock** button. It refuses a live lock:

```
Refused: <target> is being deployed by <user> since <time> — that lock is not stale, so it
is not cleared.
```

Clearing is recorded in `Deployments/lock-events.json` (who, when, whose lock).

Note: this is also the model-writability gate — if the target's model cannot be written, the
deploy stops here rather than silently proceeding.

### 2.8 The target has drifted (blocking)

```
PROD has drifted: <status> <file>; <status> <file>. Re-apply the change on DEV in a change
set, then release it. Deploys to this server are paused until drift is clean.
(<n> view/subset changes on <target> are reported but not blocking: <files>)

PROD drift could not be checked (<error>). Deploys to this server are paused until drift is
clean.
```

Drift means: what the target holds now is not what it last received from a deploy. Checked in
`prepare` (shown at Review, `ready=false`) **and** re-checked in `execute` (refuses).

Blocking: dimensions, hierarchies, attributes, cubes, rules, processes, chores.
Reported only: views and subsets — TM1's pull never applies them, so they cannot be
overwritten by this deploy.

**Recovery — and this is the weakest part of the whole flow:**

1. Open **Deploy → Drift**, look at what differs.
2. If it is a legitimate change someone made on the target, **re-apply it on DEV inside a
   change set and release that**. The next deploy then carries it and drift returns to clean.
3. If it was accidental, the change has to be undone **on the target** (by hand, in PAW or
   Architect) so it matches what it last received. The pipeline has no "reset target to last
   received commit" action.

There is no partial credit here: **one drifted dimension pauses every deploy to that
target.** See §7.1.

### 2.9 A view or subset changed on the target *and* this release ships it

```
<target> has its own version of <names>, and this release ships it. Deploying would replace
<target>'s version. Resolve it before approving: keep <target>'s copy, or take this
release's.
                                                                    (Review / prepare)

Refused: <files> changed on <target> and is also in this release. The view/subset step would
replace the target's version. Resolve it at Review (keep <target>'s, or take the release's).
                                                                    (Deploy / execute)
```

Why it blocks here and not in 2.8: a view or subset *on its own* is harmless (the pull ignores
it). The danger is the IDE applying this release's version over it afterwards — that is a
silent overwrite of someone's work.

**Recovery — the honest version:** the message offers two choices, and **only one of them is
built.**

| Choice | Built? |
|---|---|
| Take the release's version | Yes — remove the view/subset from the change set, or simply accept the overwrite by deleting the target's version first |
| Keep the target's copy | **No.** There is no control that says "ship this change set but leave PROD's view alone". The user must remove that view/subset from the change set (and lose the DEV version of it), or copy PROD's version back onto DEV |

See §7.2 — this is decision 5 in `15_RELEASE_ON_LIVE.md`, still unbuilt.

### 2.10 The pull plan cannot be produced

```
Pull plan failed: <TM1 message> (a stale view or name in the source breaks the pull — run
the readiness check)
```

**Recovery:** the source's Git state is not pullable — commonly a view or subset referencing
an object that no longer exists. Fix on DEV (delete or repair the offending view/subset),
commit, rebuild the release, ship again. Nothing reached the target.

### 2.11 The plan does not match the approval

```
Refused: cannot verify the commit being deployed (approved-incoming <a>, plan commit <b>).
Approve a specific commit and retry.
Refused: the incoming commit moved (approved <a>, branch head is now <b>). Approve the new
commit before deploying.
Refused: the pull plan contains <n> object(s) not in this release — <list>. Rebuild the
release; it must carry only the change set's objects.
Refused: the pull plan contains <n> operation(s) this deploy cannot classify — <ops>.
Rebuild or inspect the release before deploying.
Refused: could not verify the release's objects against the pull plan (<error>).
```

All five mean the same thing: **what is about to be applied is not what was approved.**
Nothing reached the target.

**Recovery:** rebuild the release and approve it again. If the "not in this release" list
contains objects you never touched, that is a signal the branch carried someone else's work —
investigate before retrying.

---

## 3. During the pull (the only part-changed state)

```
Pull failed: <TM1 message>
```

This is the one failure where the target may hold **some** of the release. The recorded
commit has **not** moved, so the target no longer matches what it last received — drift will
report it, and every later deploy is paused.

The outcome card says:

> **The pull failed part-way** — the target may hold some of the release but not all of it.
> Its recorded commit has NOT moved, so it no longer matches what it last received.
> **Next:** Do not run the deploy again. Open Drift first: if it reports differences, the
> target has to be returned to its last received commit before anything else ships.

**Recovery, as built:**

1. **Drift** — see what actually landed.
2. Undo it **on the target** (by hand) until Drift is clean, **or** make DEV match the
   half-applied state and ship that as a new change.
3. Re-run only when Drift is clean.

**Gap:** step 2's first option is manual work on a production server, and there is no
"restore to last received commit" helper in the IDE (§7.3).

---

## 4. The pull applied, but the record was not written

```
Deploy applied, but the deploy record could not be written: <error>. Investigate before the
next deploy.
```

`executed: true`, `recorded: false`. The target **has** the release. The IDE's
`lastDeployedCommit` did not move.

Card:

> **Deployed, but the deploy record was not written.** The target has the release and is at
> `<commit>`. The IDE does not know which commit the target received, so drift and
> "already deployed" will be wrong until that is fixed. Investigate before the next deploy.

**Recovery:** this is a model-writability fault on the target, not a deploy fault. Fix the
target's governance documents (`Applications/Governance/Deployments/state.json` — rights,
existence), then correct the record before any further deploy. There is no UI to repair it
(§7.4).

---

## 5. Applied, but something did not land (all amber, target is changed)

These are all `executed: true`. Nothing is rolled back; each card names one next action.

### 5.1 Subsets/views did not apply

```
<n> subset/view(s) did not apply
The cubes, dimensions and processes are on the target. The subsets and views, which TM1 Git
does not pull, did not all land.
Next: Deploy the same release again — that step re-applies and is safe to repeat.
If it keeps failing: <type> <name>: <error>; …
```

**Recovery:** ship again. The complement step is idempotent. If it repeats, the named object
is the fault (commonly a view referencing a deleted subset or element).

### 5.2 Objects not confirmed on the target

```
Some objects could not be confirmed on the target
The deploy ran. Verification could not prove every object in the release is there.
Next: Deploy the same release again. Still missing: <objects>
        (or) The check itself errored: <error>
```

**Recovery:** ship again. A `Skip` in the pull is never reported as a clean deploy — this card
exists because a skip once looked like success.

### 5.3 Safety checks failed

```
Deployed, but the safety checks failed
The target has the release and is at <commit> — but what it computes is now wrong.
Next: Fix it on DEV, commit, build a new release and deploy that. First failure:
<description>. There is no automatic rollback yet.
```

**Recovery:** fix on DEV → new change set → ship. The target stays wrong until that lands;
there is nothing to click that makes it right.

The same verdict (`controlOk: false`) is produced by any of: a failing control assertion, a
reconcile error, a skipped delete, a failed attribute sync, an errored verification.

### 5.4 Reconcile problems

Reconcile runs after the pull for the things TM1 Git does not cover: deletes, attribute
values. Each problem is pushed into `controlReasons` and forces `controlOk: false`:

```
reconcile: <error>
reconcile deletes: <error>
delete skipped: <type> <name> — <error>
reconcile attribute values: <error>
attribute sync <dim>: <error>
```

**Recovery:** same as 5.3 — the change is on the target but the model is not fully correct.
Fix on DEV and ship. A `delete skipped` usually means the object is still referenced
somewhere (a view, a rule, a process) and must be unhooked first.

### 5.5 Reconcile skipped because there is no change set

```
This approval has no linked change set — reconcile scope is unknown and was skipped (not
silently).
```

Only reachable in catch-up/legacy paths. Recovery: re-approve through a change set if reconcile
matters for the change.

---

## 6. After the fact — drift appears later

Nothing failed; something changed afterwards (a nightly load added an element, someone edited
a rule in PAW, another pipeline deployed).

- **Reported, not blocking:** views and subsets. No action. Shown in Drift, Verify, and inside
  any refusal message.
- **Blocking:** everything else. Every deploy to that target is paused until it is resolved
  (`§2.8`).

**Recovery:** the same as `§2.8` — bring the change into DEV through a change set and release
it, or undo the change on the target by hand.

---

## 7. What has no recovery path today

Listed plainly, because this is where review should focus.

### 7.1 Drift blocks everything, with no repair action in the IDE
One changed dimension pauses all deploys to that target. The message says "re-apply the change
on DEV and release it", which is right when the drift is intended — but when it is accidental,
the only path is hand-editing a production server. There is no "accept target's state as the
new baseline" (that would be a seed, and seeding is currently a separate admin action) and no
"reset target to last received commit". **A single careless edit on PROD can stop the team
shipping, with no in-product way out.**

### 7.2 "Keep the target's copy" (view/subset conflict) is offered but not built
The refusal message gives two choices. Only "take the release's" exists. To keep the target's
version the user must strip the view/subset out of the change set — which also discards their
work on it. This is decision 5 in `15_RELEASE_ON_LIVE.md` (`Review` should let you choose per
object); it is not built.

### 7.3 A part-changed target has no restore
`§3`. Detecting it is solid; undoing it is manual. There is no engine action that replays the
target to `lastDeployedCommit`.

### 7.4 A lost deploy record has no repair
`§4`. The state is wrong in a way that only matters *later* (drift compares against it), and
fixing it means editing governance documents by hand.

### 7.5 Nothing durable records what a deploy shipped
`Deploy → History` stores: the commit, the time, the commit's summary line, and the approvals
(who, when, note, added objects). It does **not** store the release's object list, the safety
check results, or the drift result at deploy time. After the completion card is closed, "what
did this deploy actually change" is not answerable from the product.

This matters for recovery: after a part-changed pull or a failed check, the record you would
want in order to reason about it was never written.

### 7.6 Retry is not resumption
"Try again" re-runs the whole sequence: tests → commit → **rebuild release** → **new
approval** → deploy. That is safe (an approval is never stale) but it is not a resume, and it
means a retry always produces a new release commit — so two attempts are two entries in the
approval history for one intent.

### 7.7 A deploy killed outright (backend dies) leaves a stale lock
Recovery is: wait up to 30 minutes, then **Clear lock** in the wizard. There is no
"clear now, I know it is dead" (deliberate — but it does mean a crash costs up to half an
hour of not being able to deploy).

### 7.8 Concurrency
`git-lock.js` is check-then-write, not compare-and-swap. Two deploys to the same target issued
at the same instant can both acquire. Noted in the code as acceptable for small teams; it is
still a real hole in "one deploy at a time".

---

## 8. Worked examples

### A. Someone edited a rule on PROD last night
1. Ship → Drift refuses: `PROD has drifted: M cubes/WFP.rules ...`.
2. Human decides it was legitimate.
3. In DEV, recreate that edit inside a new change set; close it.
4. Ship → release contains the rule; drift now clean after deploy.
5. If instead it was a mistake: undo it on PROD by hand (PAW/Architect), then Drift returns
   to clean and shipping resumes.

### B. The pull died half-way
1. Card: *"The pull failed part-way… do not run the deploy again."*
2. Drift shows a mix of what landed.
3. Undo on the target until Drift is clean; then ship again.
4. If step 3 is impractical, make DEV match the half-applied state and ship that instead.

### C. Deploy applied, checks failed
1. Card: *"safety checks failed — what it computes is now wrong."*
2. Fix the cause on DEV.
3. New change set, new release, ship.
4. The target is wrong for the whole interval — that is accepted, visible, and not hidden.

### D. A view is on both sides
1. Review blocks: *"PROD has its own version of `<view>`, and this release ships it."*
2. If the release's version should win: remove the view from the change set and add it back
   after copying PROD's version to DEV, or overwrite deliberately.
3. If PROD's should win: there is no button — copy PROD's version to DEV, then release.
   (§7.2)

---

## 9. Code map

| Behaviour | Where |
|---|---|
| Review gate (drift + view/subset conflict, `ready=false`) | `core/git-deploy.js` `prepare` ~77–146 |
| Deploy gate (approval, lock, drift, plan ⊆ release, view/subset conflict) | `core/git-deploy.js` `execute` ~154–325 |
| Drift refusal text | `core/git-deploy.js` `driftRefusal` ~36 |
| Conflict rule (shared by Review and Deploy) | `core/git-release.js` `viewSubsetConflicts` |
| Lock, stale rule, clear | `core/git-lock.js` |
| Approvals bound to `(target, commit)` | `core/git-approvals.js` |
| Post-pull verification / complement | `core/git-release.js` `applyReleaseComplement`, `verifyRelease` |
| Six outcome classes shown to the user | `client/src/lib/deploy/deploy-outcome.js` |
| One-button flow, Try again, done/failed cards | `client/src/components/ShipDialog.jsx` |
| Step-by-step, Clear lock, drift panel | `client/src/components/DeployWizard.jsx` |
| Durable record (commit, time, summary, approvals) | `core/git-state.js`, `core/git-approvals.js`, `routes/deploy.js` `/api/deploy/git/history` |
