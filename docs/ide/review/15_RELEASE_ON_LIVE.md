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
