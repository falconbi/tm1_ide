# 15 — Build the release on what PROD actually has

Design only. Date: 21 Nov 2026. Nothing here is built.

## What we know, from tests on the lab

Three things were proved today, and the design rests on all three.

1. **A pull makes the target match every object in the commit.** A dimension whose live copy
   differs gets `Replace` in the plan, whether or not the release mentions it. That deletes the
   target's own elements and their data.
2. **Views and subsets are not in the pull at all.** The plan lists Dimensions, Processes, Chores
   and Cubes — never views or subsets. We changed a view on PROD, executed the pull, and the change
   survived untouched.
3. **A changed view still counts as drift.** So a user saving a view on PROD blocks every deploy,
   while a deploy cannot damage that view. The block protects nothing.

That asymmetry is the whole design: what the pull can damage must be protected; what it cannot touch
must not block.

## The idea

Build the release on **what PROD has right now** (`prod-live`, its current snapshot) plus this change
set's files — instead of on the commit the target last received.

Then the pull replaces each object with a version that already contains PROD's own state, so nothing
is lost and drift heals as a side effect rather than blocking.

## Two kinds of object

| PROD may own it | Must never change on PROD |
|---|---|
| elements and rollups in a loaded dimension | rules |
| public views and public subsets | processes (the code) |
| chore schedules and the on/off flag | cube structure |

For the left column: keep PROD's version, record it, never block.
For the right column: a direct edit still blocks the deploy. Those are things a person should not be
changing by hand on PROD, and if they did, that is worth stopping.

## Where the split is defined

Per target, in the target's own model, beside the deploy record —
`Applications/Governance/Deployments/ownership.json`:

```json
{
  "dimensions": { "Account": { "owner": "prod", "maintainedBy": "WFP Load Accounts" } },
  "subsets":    { "WFP Period:2026 Months": { "owner": "prod", "maintainedBy": "admin" } },
  "views":      { "WFP Assignment:WFP Assignment Default": { "owner": "prod", "maintainedBy": "admin" } },
  "chores":     { "WFP Month End": { "owner": "prod", "maintainedBy": "operations" } }
}
```

Not a local file: TEST may not load what PROD loads.

**How it is suggested.** Reuse `process-scan`: a dimension a chore-scheduled process inserts into, and
the attributes it writes. For views and subsets, suggest anything saved on PROD since the last deploy
— that is evidence a person is working there. Nothing becomes PROD-owned until an admin confirms it,
and they can add entries by hand.

## The overlap case — the hard one

DEV adds a rollup to a dimension PROD owns, and PROD has meanwhile added elements of its own.

**Simplest safe answer:** the merged file is PROD's live file, plus *only* what this change set
recorded adding, applied add-only. Nothing is ever removed, and nothing PROD changed is touched.

The additions come from comparing PROD with DEV, not from the log alone — the log misses edits made in
PAW or by a TI run. Recorded additions are ticked by default; anything DEV has that the change set did
not record is shown as "not recorded in this change set" and ships only if a person ticks it.

**Refused:** a PROD-owned dimension where the change set *removed* something. Removal is not merged;
it is either dropped from the release or refused with the object named. Archiving (re-parenting under
`Archive`) is the intended way to retire an element, and it is not a removal.

**Rollup edges (re-parenting).** The same rule, applied to one edge at a time:

| Who moved the edge | What happens |
|---|---|
| PROD re-parented one of its own elements (an admin archiving, a load rebuilding a rollup) | **Kept.** It is PROD's element; the merge does not put it back |
| DEV re-parented an element the merge sees on PROD | **Shown, not applied.** It appears at Review as "moves `A-1000` under `Archive` — PROD owns `A-1000`", and ships only if a person ticks it |
| DEV re-parented an element DEV owns | Ships normally |

A re-parent can change numbers as much as a removal can, which is why a change to a PROD-owned
element is never silent.

## Views and subsets: the REST step can still overwrite

The pull never touches views or subsets (proved 21 Nov), but the IDE applies them itself afterwards —
and `applyReleaseComplement` calls `saveSubset` / `saveView` / `saveNativeView`, all of which
**replace**. So if a release ships the view `WFP Assignment Default` and someone also changed it on
PROD since the last deploy, the deploy silently overwrites their work.

That is a conflict, and it is not the drift gate's job to catch it — the object is legitimately in the
release. It has to be caught at Review:

> **Changed on PROD and in this release** — `WFP Assignment Default`.
> [ Keep PROD's version ] [ Use this release's version ]

Nothing ships until one is chosen, and the choice is recorded on the release (like a delete, or an
added item). "Keep PROD's" removes the object from the release's complement list; "use the release's"
goes ahead as today.

The same applies to a subset the release ships.

## Chores

A chore file holds two different things, and they need different answers:

| Part | Answer |
|---|---|
| the schedule and the active flag | **PROD's is kept** — operations staff own when it runs |
| the steps (tasks, order) | **DEV's is taken** — that is model work, and it is what a change set edits |

So a deploy never switches a chore on or off, and never moves its schedule, but it does update what
the chore does. If PROD changed the steps too, that is the same conflict as a view: shown at Review,
chosen.

## The timing gap

PROD can load again between the build and the deploy. Sequence:

1. snapshot PROD (`prod-live`), record that commit on the release
2. build the release on it
3. immediately before executing, snapshot again
4. if PROD moved **only inside PROD-owned objects**, the release is rebuilt on the new snapshot and the
   approval below still holds — no re-approval, no re-review
5. if PROD moved **anywhere else**, that is ordinary drift and still blocks

The release record carries the snapshot commit it was built on, so "did PROD move" is a comparison of
two known commits rather than a guess.

## Approval vs rebuild

Binding approval to the release commit is right, but it breaks on the first nightly load: PROD moves,
the release is rebuilt, the commit changes, and the approval is void — every single day, for a change
nobody asked to re-review.

**Instead, approve the change-set delta, not the commit.**

- At build, record the **delta**: the exact objects and contents this change set brings from DEV,
  as a hash, on the release.
- Approval binds to that hash. Rebuilding on a newer snapshot does not change the delta, so the
  approval survives.
- At deploy, the delta is recomputed from the rebuilt release and compared with the approved hash.
  If it differs at all, the deploy is refused.

**Why that is safe:** the only thing allowed to change between approval and deploy is the *base*, and
only inside objects we have already given to PROD. The part being approved — what DEV contributes —
is byte-for-byte the same, and is checked again immediately before executing. Anything outside the
PROD-owned set moving still blocks the deploy outright.

So the promise is narrower and stronger than "approve the commit": *the thing you approved is the
thing that ships; the rest is PROD's own state, merged in.*

The deploy record gains two fields: the snapshot commit the release was built on, and the approved
delta hash. After a successful deploy, both the snapshot and the deployed commit advance, so drift is
clean by construction.

## Attribute values (carried over from brief 14)

Two rules, both about not overwriting PROD's data:

1. **Never copy loaded attribute values from DEV.** The GL load writes descriptions and mappings on
   PROD; a deploy has no business replacing them with DEV's.
2. **No wholesale copy for a PROD-owned dimension.** Today, when the log only knows that a dimension
   changed, `syncAttributeValues` copies *every* attribute value for *every* element. For a PROD-owned
   dimension that is a guaranteed overwrite, so it must be refused and the recorded element/attribute
   pairs used instead — or nothing copied at all.

## What should happen first, separately

**Exclude views and subsets from the drift gate.** They are never pulled by TM1, so blocking on them
is pure friction — the most common day-to-day case, because users save views.

That does not mean ignoring them:

- **Drift still lists them**, labelled *"changed on PROD — not blocking"*, with the object named.
- **Verify shows them**, so after a deploy you can see what PROD has that the repo does not.
- And the release-versus-PROD conflict above still stops a deploy that would actually overwrite one.

Report, don't block. The same reasoning does **not** apply to chores or cubes: they are in the pull.

## Tests that would prove it on the lab

1. **View and subset (done):** change one on PROD, confirm drift reports it, confirm the plan ignores
   it, confirm a pull leaves it alone. ✅ done 21 Nov
2. **Dimension (done):** add an element on PROD, confirm the plan says `Replace`, confirm a release
   that omits it would wipe it. ✅ done 21 Nov
3. **Merge:** with a dimension marked PROD-owned, add a rollup on DEV, build, deploy. PROD keeps its
   elements and gains the rollup; drift is clean afterwards.
4. **Overlap:** PROD adds an element after the build; the pre-execute snapshot refuses, the rebuild
   includes it, the deploy then succeeds.
5. **Removal:** a change set removing an element from a PROD-owned dimension is refused, naming it.
6. **Chore:** change a chore's schedule on PROD; confirm it drifts and a deploy that touches the chore
   resets it (to prove chores need ownership, or to prove they do not).
7. **View conflict:** change a view on PROD *and* in a change set; confirm Review refuses until one
   version is chosen, and that "keep PROD's" really keeps it.
8. **Approval survives a load:** approve a release, add an element to a PROD-owned dimension, deploy.
   It should rebuild and deploy **without** re-approval, and the delta check should still refuse if the
   change set's own objects were altered.
9. **Attribute values:** on a PROD-owned dimension whose log knows only the dimension name, confirm no
   wholesale copy happens and PROD's descriptions survive.

## What cannot work

- **Per-server ignore.** `Deployment` (singular) is accepted and never read; the global form drops the
  hierarchy file and keeps its parent, so no release can be built at all. Tested 21 Nov.
- **A partial pull.** TM1's plan is whole-tree. There is no "only these objects".
- **Avoiding the timing gap entirely.** PROD can load at any moment; the answer is re-check and
  rebuild, not prevention.

## Decisions for James

| # | Decision | Recommendation |
|---|---|---|
| 1 | Drop views and subsets from the drift gate now? | **Yes** — reported as "not blocking" at Drift and Verify, never silent. |
| 2 | Ownership scope: which object types can be PROD-owned? | Dimensions (loaded), public views and subsets, chore *schedule and active flag*. Not rules, processes, cube structure, chore steps. |
| 3 | Where ownership is stored | Per target, in the model, admin-confirmed, with suggestions. |
| 4 | Overlap: merge add-only, refuse removals | **Yes** — the only answer that cannot lose data. |
| 5 | A release ships a view/subset PROD also changed | **Stop at Review** and make someone choose; never last-writer-wins. |
| 6 | Approve the delta or the commit? | **The delta.** Otherwise every nightly load forces a re-approval for a change nobody re-reviewed. |
| 7 | PROD moved between build and deploy | Rebuild silently **only** for PROD-owned objects; anything else blocks. Never deploy a stale merge. |
| 8 | Attribute values on a PROD-owned dimension | Never wholesale; never copy the loaded ones. |
| 9 | Does this block client use? | **Yes.** A client model with a nightly load cannot deploy at all today. This is the gate before the first client. |

---

# Appendix A — compared with "Refresh DEV from PROD"

James's alternative, as proposed (22 Nov 2026):

> Instead of merging PROD's changes into the release, copy PROD's changes back into DEV before the
> deploy. DEV then holds PROD's state plus DEV's own work, and the normal deploy carries everything.
> The merge happens on DEV through the REST API, and TM1 Git writes the file itself, so no TM1 Git
> file format is built by hand.

Both designs solve the same problem — *a target whose dimensions are loaded every night cannot be
deployed to, because the pull would delete what the load added.* They solve it on different sides of
the wire:

- **Design 15 (this document)**: merge on the **release**. The release commit is built on
  `prod-live` (PROD's own snapshot) plus DEV's delta, so the pull writes PROD's state back to
  itself. DEV is never touched.
- **Refresh-to-DEV**: merge on **DEV**. PROD's state is copied *into* DEV's model over REST, the
  change set carries it, and the release is an ordinary release of DEV. PROD is never special-cased.

The second one is smaller, because it removes two of the hardest parts of this design: building a
correct TM1 Git file by hand, and approving something that changes after approval.

It is also broader than dimensions. Agreed with James on 22 Nov, as **one rule**:

> Before a deploy, anything PROD changed is refreshed into DEV first.

## What the refresh covers

Every object type PROD is allowed to change, listed from the **drift report** — the same comparison
that already tells you PROD moved. One screen, one tick per item, ticked by default; a **delete is
unticked** and needs a deliberate tick.

| Object | What is copied to DEV |
|---|---|
| Dimension | missing elements, edges (including a re-parent / archiving move), element types |
| Hierarchy, including alternate hierarchies | new hierarchies whole; inside existing ones, added elements and edges |
| Attribute | new attribute definitions, and the values PROD's load maintains (see the attribute section below) |
| View, subset | PROD's version onto DEV. If DEV also changed the same one, someone chooses which wins — the choice already built at Review |
| Chore | schedule and active flag |

**Never refreshed:** rules, processes and cube structure. A direct change to one of those on PROD
still blocks the deploy and is fixed on DEV in a change set. They are model code, not loaded state,
and copying them back would turn a production hotfix into an unreviewed DEV edit.

Everything refreshed is written under the open change set (`writeLog`), so the release carries it,
the approval covers it, and the diff shows it. **After the refresh, drift on those objects is
resolved by the release itself**: the release carries PROD's version, so the pull has nothing to
overwrite and the target ends up matching what it received.

## Deploy only when the target is idle

Agreed with James, 22 Nov. The refresh closes most of the timing gap — if PROD is quiet, nothing
changes between the refresh and the deploy. The IDE can check that PROD *is* quiet, rather than
assume it.

**What it reads**, on the target, at two points:

| Signal | Source | Answer |
|---|---|---|
| Threads | `Threads?$expand=Session` (`getThreads`, already used by the admin screen and the MCP `get_active_threads` tool) | any user thread whose `State` is not `Idle` and whose object is a process or chore |
| Chores | `Chores` + `Chores('<name>')` — `Active`, `StartTime`, `Frequency`, `ExecutionMode` | a chore that is due inside the deploy window (next run = `StartTime` + k·`Frequency`, compared with now) |
| Sign-ins | `Sessions?$expand=…` (`getSessions`) | how many people are connected, and who |

**What each answer does:**

- **A process or chore is running** → **refuse**, naming it: *"WFP Load Accounts is running on
  TM1_Test_PROD; deploy when it finishes."* Nothing is sent, no lock is taken.
- **A chore is due within the deploy window** → **warn**, naming the chore and the time it is due.
  Not a refusal: a chore can be due in ten minutes and the deploy takes five, and only a person can
  judge that.
- **Users are signed in** → show the count and the names, and require a **confirmation**. Not a
  refusal: someone having the model open is worth telling them, not worth blocking on.

**The order, and why it is this order:**

```
1  idle check                  ← nothing is written if the target is busy
2  refresh DEV from PROD       ← the merge, recorded in the open change set
3  build the release
4  approve
5  idle check again            ← the target may have moved while DEV was being prepared
6  Save Data
7  backup (process, or the stated time)
8  pull
9  verify                      ← checks + drift, as today
```

The second idle check is the one that matters; the first stops a pointless refresh. **Save Data and
the backup sit between the second check and the pull**, which is a real hole on a large model — a
load can start in those minutes. Two ways to close it, and the second is preferred:

- move the idle check to immediately before the pull (after the backup), or
- keep the second check where it is *and* re-check after the backup, refusing if the target became
  busy in between.

Everything else in the sequence is unchanged: the lock is taken at the start of the deploy, the
approval is bound to the release commit, and the report records both idle checks.

**Recorded in the deploy report:** each idle check — when, what it found (running objects, chores
due, signed-in users), and what the person confirmed. A deploy that went ahead while two people were
signed in is a fact worth having afterwards.

**Chores are never switched off automatically.** If a chore must be paused for a deploy, an
administrator pauses it and the deploy report says it was paused. A pipeline that silently disables
production schedules is worse than a refused deploy.

## What each needs in code

| Work | Design 15 | Refresh-to-DEV |
|---|---|---|
| Ownership registry (`ownership.json`, admin UI, suggestions from `process-scan`) | **Yes** — decisions 2 and 3. New model document, a settings screen, suggestion heuristics. ~1.5–2 days | **No** for release building. A much smaller list is still needed: *which attributes PROD's load maintains*, per dimension. ~0.25 day |
| Merge PROD's state into a release | **Yes** — `buildRelease` gains a merge mode: dimension add-only, chore split (schedule vs steps), views/subsets conflict. Edits the JSON that `prod-live` produced. ~3–4 days | **No** |
| Copy PROD → DEV | — | **Yes** — compare live PROD with live DEV per object, then `addElementAt` / `addEdge` / `deleteElement` / `writeElementAttribute`, `createHierarchy` / `hierarchyInfo`, `createElementAttribute`, `updateChore`, `saveView` / `saveSubset`. All object types PROD may change. ~2.5–3 days |
| Refresh UI: drift-sourced list, tick per item, deletes unticked | — | **Yes** — ~1 day (see the review-UI row) |
| Record it in the change set | — | **Yes** — the existing `writeLog` for the open session, per object, so the change set owns what was copied. ~0.25 day |
| Snapshot + rebuild between build and deploy | **Yes** — decision 7, `prod-live` re-snapshot, rebuild, rebind. ~1–1.5 days | **No** — the release is ordinary. The timing gap is covered by the element-loss stop that is already built (with the caveat below). |
| Delta-hash approval | **Yes** — decision 6. New hash on the release, compared at deploy. ~1–1.5 days | **No** — normal commit approval (§ "Approval" below) |
| Review UI for merge results (moves, removals, conflicts) | **Yes** — ~1–1.5 days | **Yes**, but smaller: a refresh panel with the objects, ticked deletes, and a run button. ~1 day |
| Drift rule: don't block when the release already carries PROD's state | **Yes**, by ownership | **Yes**, by content — but per object type, not element names alone: elements, edges, types, hierarchy membership, attribute definitions/values, chore flag. One comparison shared with the refresh. ~1 day |
| Attribute-value discipline (brief 14) | **Yes** — never wholesale on a PROD-owned dimension | **Yes**, and *more* important: the refresh writes PROD's values onto DEV, and a later deploy writes DEV's values back |
| Idle check (threads, chores due, sessions) + the two call sites + report fields | **Yes** too — same value here, and it is what makes the timing gap small in either design. ~1–1.5 days | **Yes** — reads `getThreads`, `getChores` / `getChore`, `getSessions`; all exist. ~1–1.5 days |
| Tests + lab proof | ~2 days | ~2 days |
| **Rough total** | **~11–13 days** | **~8–9 days** |

### What it reuses

Refresh-to-DEV is mostly assembly of things that exist:

- `TM1Client`: `getElements`, `getEdges`, `addElementAt`, `addEdge`, `deleteElement`, `writeElementAttribute`, `getElementAttributeValues`, `getHierarchies` / `hierarchyInfo` / `createHierarchy`, `createElementAttribute`, `getChore` / `updateChore`, `getViewWithSubsets`, `saveView`, `saveSubset`.
- `applyView` / `applySubset` (`core/git-restore.js`) for writing a view or subset onto DEV, unchanged.
- `writeLog` (`core/change-log.js`) so the open change set records each copied object — the same
  entries the editors write, so diffs, ownership and releases work as normal.
- `compareTargetWithRepo` (`core/git-readiness.js`) for the drift rule — but see the caveat: it
  compares **element names only**.
- `getThreads`, `getChores` / `getChore` and `getSessions` for the idle check — the admin screen and
  the MCP `get_active_threads` tool already use the first.
- The element-loss stop in Ship and Review, which stops being the only timing-gap guard once the
  idle check exists.

What it does not need at all: `prod-live` as a base, a merge in `buildRelease`, an ownership
registry, a delta hash.

## What can go wrong

### DEV fills up with PROD's codes

This is real, and it is the cost of the design rather than a bug.

- Every element the load creates on PROD becomes part of DEV's dimension. DEV stops being a clean
  room and becomes a copy of production definitions — real cost centres, real employee codes,
  whatever the load writes.
- Every developer then sees production codes in autocomplete and dropdowns, and any test they run
  uses them.
- A developer who deletes one of those elements on DEV is deleting a production element as far as
  the next deploy is concerned. The element-loss stop would name it (that stop is already live),
  but the *intent* is now ambiguous: did they mean "remove this from DEV" or "remove this from
  PROD"?
- It compounds: refresh, then someone adds an element in DEV for testing, then refresh again. DEV
  accumulates both.

Mitigations, all cheap: refresh is an explicit action, per object, never automatic; the copied
elements are recorded in the change set so they are visible in the diff; and the element-loss stop
already refuses a deploy that would delete them by surprise. But no mitigation makes DEV small
again — the state itself is now large.

By contrast, design 15 leaves DEV exactly as it is. That is a genuine advantage if DEV is used for
training, demos, or by people who should not see production codes.

### Attribute values copied to DEV

The proposal says "copy the values of attributes PROD loads". That is the right instinct and the
riskiest step.

- **Which attributes?** There is no existing notion of "loaded attributes". `process-scan` knows
  what a process *writes* to a dimension (brief 14's `maintainedBy`), so it can suggest a list, but
  it must be confirmed per dimension — this is the small piece of ownership the design cannot avoid.
- **Copying the value is a write to DEV**, and the change log records it. `reconcile` already has a
  wholesale path (`syncAttributeValues`) that copies *every* value for *every* element when the log
  only names the dimension. On a refresh, that is exactly what must not happen: it would copy DEV's
  stale values over PROD's on the next deploy. Brief 14's rule stands — never wholesale, always the
  recorded element/attribute pairs.
- **Values drift immediately.** A value copied at 09:00 is stale by 09:05 if the load runs again.
  That is acceptable (the deploy only needs the element to exist), but it means the refresh is not a
  snapshot of data, only of *definitions plus a sample of values*.
- Recommendation: copy **attribute definitions and alias values** (they affect element identity in
  views and subsets), and copy **numeric/text attribute values only for the confirmed loaded list**,
  or not at all. Element existence is what the deploy actually needs; values come from PROD's own
  load.

### The drift rule as proposed has a hole: it compares the wrong thing

The proposal is: *drift on a dimension no longer blocks if the element-loss count for that dimension
is 0, using `compareTargetWithRepo`.*

`compareTargetWithRepo` compares **element names per hierarchy**. It does not compare:

- **consolidation edges** — a re-parent, including the archiving pattern this project uses
  (`Archive` under weight 0);
- **element types** (Numeric vs String);
- **hierarchy membership** — a hierarchy PROD added, or one whose contents changed;
- **attribute definitions or values**;
- element **order**.

With the refresh now covering all of those, the rule has to cover all of them too. A PROD dimension
that was re-parented, a hierarchy the load created, or an attribute the load populated has element
loss 0 — the deploy would stop blocking and the pull would silently undo the change. That is the
same class of loss the whole design exists to prevent.

**The clean formulation, which also saves work:** a drift entry is non-blocking when *the release
already carries PROD's version of that object* — which is exactly the question the refresh asks. So
one comparison serves both:

1. the refresh uses it to decide what to copy;
2. the drift gate uses it to decide whether anything is still at risk.

If the comparison says DEV's version of the object now equals PROD's, drift for that object is
resolved by the release and does not block. If it says anything still differs — an edge, a type, an
attribute — the deploy blocks, naming the object, exactly as today.

For dimensions that means comparing elements **and** edges **and** types. For hierarchies, the whole
hierarchy. For attributes, definitions and the value set PROD actually maintains. For chores,
schedule and flag. That is the +0.5 day already counted above, and it is the single most important
implementation detail in this design.

### Hierarchies and attributes have merge rules of their own

A hierarchy is not a smaller dimension: PROD may create an alternate hierarchy that DEV also has
with different contents, or add an element to one DEV deleted. The rule that works is the same as
for dimensions — take PROD's version for the parts PROD owns, keep DEV's additions — but it has to
be decided per hierarchy, not per dimension, or an alternate hierarchy rebuilt by a load will
collide with a DEV one of the same name.

Attribute definitions can collide in a worse way: the same attribute name with a different type on
the two servers (Numeric on PROD, String on DEV). That cannot be merged, only refused, and the
refusal has to name both sides.

### The "one rule" has a hard boundary, and it will be felt

Rules, processes and cube structure are not refreshed, so a change to one of them on PROD still
blocks every deploy until someone reproduces it on DEV in a change set. That is the right default —
they are code, not loaded state — but if the nightly load ever touches a cube's rules or a process,
the team will hit a blocked deploy every night with no refresh path to clear it. Worth confirming
with the load's owner before this ships, because if the load does touch code, the rule needs an
answer for it (most likely: the load must not touch code on PROD).

### Deletes are unticked by default — say what that means

Agreed: a delete is unticked and needs a deliberate tick. The consequence has to be on the screen,
because it is the opposite of what "PROD deleted this" sounds like:

- **unticked** (the default) — the element stays on DEV, so the release contains it, so the next
  deploy **puts it back on PROD**;
- **ticked** — DEV adopts PROD's deletion and the deploy removes it.

So the item must read *"PROD deleted `A-1000` — unticked: the next deploy puts it back on PROD"*,
not merely offer a box. Otherwise the safe-looking default is the one that silently re-creates data
someone deliberately removed.

### Chores: copying the schedule onto DEV changes DEV's behaviour

`updateChore` on DEV with PROD's schedule and active flag means DEV's chore may become **active at
production times** and start executing loads on DEV. Copying the flag is what makes the deploy not
switch PROD's chore off, but it has a side effect on the dev server.

Mitigation: refresh chores while DEV's chores are known-inactive, or copy the schedule but force
`Active = false` on DEV and let the deploy bring PROD's own flag from PROD's file (which is what
design 15 does by keeping PROD's chore file). This needs a decision; it is not obvious.

### The idle check is a snapshot, not a lock

It reads a moment. A load can start one second later, and Save Data plus a backup process can take
minutes on a large model — long enough for a chore to fire between the check and the pull. So the
check reduces the window; it does not close it. The second check belongs as late as possible (after
the backup, immediately before the pull), and a chore due inside that window has to be treated as a
reason to wait, not a warning to click past.

Two practical points:

- **Permissions.** Reading other people's sessions needs an account that can see them. If the deploy
  login cannot, the check must say so ("sign-ins could not be read") rather than report zero — a
  false all-clear is worse than no check.
- **Chore timing is computed**, not read: TM1 v11 gives `StartTime` + `Frequency`, not a next-run
  time, so DST and `ExecutionMode` need care. Being a few minutes out is acceptable for a warning;
  it is not acceptable for a refusal, which is why only *running* refuses.

### Idle check does not replace the drift gate

If the target was already drifted before the deploy, idleness changes nothing — drift still blocks,
and refresh is what resolves it. The two checks answer different questions: *did PROD change?* and
*is PROD changing right now?*

### Refresh and the change set's own history

The refresh writes to DEV under someone's open change set, so PROD's elements appear as *that
person's* changes. The diff will show a dimension change they did not make, and the approval covers
it. That is correct but worth saying plainly in the UI: *"12 objects refreshed from PROD into this
change set"* with a list.

## Approval: does refresh-to-DEV still need decision 6?

**No — and this is its biggest simplification.**

With the merge on DEV, the release is an ordinary release built on the target's recorded commit from
DEV's own commit. There is no base that changes underneath the approval: approve the release commit,
deploy the release commit. Decision 6 (approve the delta, not the commit) and decision 7 (rebuild on
a newer snapshot without re-approval) both exist only because design 15 changes the base after
approval.

Two consequences worth stating:

- A refresh *after* approval writes to DEV, moves DEV's commit, and therefore **voids the
  approval** — correctly. The workflow is: refresh → close → build → approve → ship. The person
  approves what will actually ship.
- The timing gap (PROD changes between refresh and deploy) is handled by the drift comparison, which
  must cover every refreshed type — elements, edges, types, hierarchies, attributes, chores (see the
  hole above). The element-loss stop that is already built covers only the element case; "refresh
  again" is a real answer only if the gate tells you which object moved and why it matters.

## What only one design can handle

| Situation | Design 15 | Refresh-to-DEV |
|---|---|---|
| DEV must stay free of production codes (training, demos, external developers) | ✅ | ❌ — the codes are copied in |
| Two targets with different ownership of the same object | ✅ per-target registry | ⚠️ per-refresh choices only |
| PROD moves inside owned objects between approval and deploy | ✅ rebuilt without re-approval — much rarer with an idle check, still needed when a load starts between the check and the pull | ⚠️ refresh again; caught by the stop only if the comparison covers the change |
| A load starting during Save Data or the backup | ⚠️ same window; decision 7 rebuilds if it can | ⚠️ same window; needs the second check late, or a re-check |
| No hand-built TM1 Git files | ❌ — the merge edits exported JSON | ✅ — TM1 writes DEV's file itself |
| Smallest approval model | ❌ delta hash | ✅ ordinary commit approval |
| DEV remains an accurate mirror of the loaded dimension day to day | ❌ DEV drifts, always | ✅ after each refresh |
| Works when the load is not the only writer (people edit dimensions on PROD) | ⚠️ needs ownership to know whose edit wins | ✅ the refresh takes PROD's state as fact |

## Recommendation

**Take refresh-to-DEV as the route to the client gate.** It is roughly two-thirds of the work,
removes the two most dangerous inventions (hand-built Git files, approval that outlives a rebuild),
and turns the problem into "make DEV match PROD, then ship normally" — which every existing safety in
the pipeline already understands.

Conditions, without which I would not ship it:

1. **One comparison serves the refresh and the drift gate, and it compares the object** — elements,
   edges, types, hierarchy membership, attribute definitions/values, chore flag — not element names.
   Without that, a re-parent or a hierarchy change on PROD is silently reverted and the design's
   whole point is defeated.
2. **Attribute rules from brief 14 stand**: no wholesale copy, and only the confirmed loaded
   attributes are refreshed. Definitions and aliases are safe; values are the risk.
3. **Deletes are unticked by default (agreed)** — and each item says, on screen, that leaving it
   unticked puts the object back on PROD.
4. **The chore flag needs a decision** before it is copied onto DEV (active at production times on a
   dev server is a real incident).
5. **Refresh is explicit and recorded** — an action with a list, written into the open change set,
   never a background sync.
6. **Confirm the load does not write rules, processes or cube structure on PROD**, because nothing in
   this design can refresh those and they would block every night.
7. **The idle check is in place at both points**, with the second one as late as the window allows —
   it is what makes "refresh, then deploy" a safe sentence rather than a hopeful one.

If refresh-to-DEV is chosen, these parts of design 15 are **no longer needed**:

- decisions 2, 3 and 4 — the ownership registry and add-only merge (the small loaded-attribute list
  survives from them);
- decision 6 — delta-hash approval;
- decision 7 — snapshot rebuild without re-approval (replaced by "refresh again", bounded by the
  stop);
- the `prod-live` snapshot as a release base.

The idle check is **new work needed either way** (see the comparison above), so it is not a reason to
choose between the two designs.

These parts **stay**, because they are true regardless of which side the merge happens on:

- decision 1 — views and subsets out of the drift gate (**done**);
- decision 5 — a view or subset changed on both sides is a choice at Review (**built**);
- decision 8 — attribute values are never copied wholesale;
- decision 9 — this is still the gate before the first client.

## Decision for James

| # | Decision | Recommendation |
|---|---|---|
| A1 | Merge on DEV (refresh) rather than in the release? | **Yes**, with conditions 1–7 above |
| A2 | Do the copy as an explicit, recorded action in the open change set? | **Yes** — never automatic, never silent |
| A3 | Copy loaded attribute *values* to DEV? | **Aliases and definitions only, plus values for a confirmed list** — element existence is what the deploy needs |
| A4 | Deletes on refresh: ticked by default, or unticked? | **Unticked (agreed)**, with the "puts it back on PROD" consequence written on each item |
| A5 | Chore active flag: copy it, or force inactive on DEV? | Force inactive on DEV; the deploy carries PROD's own chore file decision from design 15, so PROD's flag is never switched |
| A6 | Scope: which object types does the refresh cover? | **Dimensions, hierarchies, attributes, views, subsets, chores** (agreed). Rules, processes and cube structure stay blocking. |
| A7 | Deploy only when the target is idle, with the refuse / warn / confirm split? | **Yes** (agreed), and put the second check as late as possible — after the backup, immediately before the pull |

Nothing here is built. This appendix stops for James's decision.
