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

## The timing gap

PROD can load again between the build and the deploy. Sequence:

1. snapshot PROD (`prod-live`), record that commit on the release
2. build the release on it
3. immediately before executing, snapshot again
4. if PROD moved in a PROD-owned object, **refuse and rebuild** — rebuilding is seconds, and it is the
   only safe answer
5. if PROD moved in an object nobody owns, that is ordinary drift and still blocks

The release record carries the snapshot commit it was built on, so "did PROD move" is a comparison of
two known commits rather than a guess.

## What this does to approval and the deploy record

Approval is bound to the release commit, and the release commit now contains PROD's own state. So
approving means approving *"this, on top of what PROD has now"* — which is honest, and the review
screen already lists the objects.

The deploy record gains one field: the snapshot commit the release was built on. After a successful
deploy, both the snapshot and the deployed commit advance, so drift is clean by construction.

## What should happen first, separately

**Exclude views and subsets from the drift gate.** They are never pulled, so a change to one can
never be damaged by a deploy, and blocking on them is pure friction — the most common day-to-day
case, because users save views. This is a small change on its own and does not need any of the merge
work.

The same reasoning does **not** apply to chores or cubes: they are in the pull.

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

## What cannot work

- **Per-server ignore.** `Deployment` (singular) is accepted and never read; the global form drops the
  hierarchy file and keeps its parent, so no release can be built at all. Tested 21 Nov.
- **A partial pull.** TM1's plan is whole-tree. There is no "only these objects".
- **Avoiding the timing gap entirely.** PROD can load at any moment; the answer is re-check and
  rebuild, not prevention.

## Decisions for James

| # | Decision | Recommendation |
|---|---|---|
| 1 | Drop views and subsets from the drift gate now? | **Yes.** They cannot be damaged by a pull, and they are the common day-to-day change. |
| 2 | Ownership scope: which object types can be PROD-owned? | Dimensions (loaded), public views and subsets, chore schedules. Not rules, processes, cube structure. |
| 3 | Where ownership is stored | Per target, in the model, admin-confirmed, with suggestions. |
| 4 | Overlap: merge add-only, refuse removals | **Yes** — the only answer that cannot lose data. |
| 5 | PROD moved between build and deploy | Refuse and rebuild; never deploy a stale merge. |
| 6 | Does this block client use? | **Yes.** A client model with a nightly load cannot deploy at all today. This is the gate before the first client. |
