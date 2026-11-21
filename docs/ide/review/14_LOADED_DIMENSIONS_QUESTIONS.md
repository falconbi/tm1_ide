# 14 — Loaded dimensions: questions and decisions

Companion to `14_LOADED_DIMENSIONS.md`. Anything decided here goes into the build brief;
anything still open is a question with an owner and a way to answer it.

Date: 21 Nov 2026.

---

## Verify first — the answer that gates the design

### Q1. When a release leaves a dimension's file unchanged, does TM1's pull skip that dimension?

**Why it matters:** the whole "add over REST after the pull" approach depends on it. If the pull
fast-forwards the working tree, PROD's loaded elements and their data are gone before any later
step runs, and the only safe design becomes merging at build time.

**Expected (to be confirmed, not assumed):** TM1's pull plan is computed from the commit delta, so a
file absent from the delta gets no operation at all, and the live copy on the target is untouched.

**How to answer:**
1. Pick a test dimension on PROD with elements that DEV does not have.
2. Build a release that touches a *different* object, so the dimension's file is not in the delta.
3. Before executing, read the pull plan: assert the dimension gets no operation (Skip or absent).
4. Execute, then read PROD's elements: the target-only elements must still be there, with their
   attribute values.

**If it fails:** stop. Merge at build time becomes mandatory and this brief needs rewriting.

### Q2. Does adding an element over REST keep PROD's attribute definitions?

Add an element to a dimension over REST that already carries attribute definitions, then read the
attribute values of another (untouched) element. If the definitions survive, the REST path is safe.
If REST re-creates the hierarchy cleanly, it is not.

### Q3. Re-adding an element after its data was deleted

If the load removes an element and a later deploy "adds" it back (because DEV still has it), the
element returns **empty** — TM1 deleted its cells when it was removed. The area comparison would
call it an addition. Expect this; do not treat a re-added element as a restored one.

---

## Decisions

### D1. Source of the "additions" list — PROD vs DEV, with recorded items ticked

The change log alone is not enough: edits made in PAW, Architect, or by a TI run during a change set
are never recorded, so a log-only rule would refuse routine work.

The comparison of PROD's elements against DEV's gives the **candidate** additions. Then:

| Item | Shown as | Ships? |
|---|---|---|
| Recorded in this change set | "added in this change set" | **ticked by default** |
| On DEV, PROD lacks it, not recorded | "not recorded in this change set" | **unticked** — only if a person ticks it |
| On PROD, DEV lacks it | "loaded on PROD" | never removed |

Ticking an unrecorded item is recorded as an explicit approval of that item — the release already
carries `addedByUser` for exactly this purpose (`setSessionRelease`), so reuse it rather than
inventing a second record.

This neither refuses routine work nor ships DEV's test codes silently.

### D2. A load that retires codes does not block deploys — but is reported

Elements removed on the target under the loaded part of a loaded dimension are **not** drift that
blocks a deploy.

Reason: the deploy cannot have caused it — an add-only deploy never removes anything. And a deploy
could not fix it: TM1 deletes an element's cell data when the element goes, so re-adding it would
not restore the data.

What replaces the block:

- the count and a sample are always reported — "the load added 14 and removed 3 elements in Account
  since the last deploy" — at Verify and on Drift, never silently ignored;
- a large removal (a load that wiped far more than it added) is surfaced as a **warning** on the
  deploy screen, not a refusal, so a broken load is visible without blocking shipping;
- everything else about the dimension (attribute *definitions*, the rollups DEV owns, an explicit
  named delete in a change set) stays reportable and blockable as today.

**Not doing:** a "load window" or per-load acknowledgement. It adds state and a step for a
condition the deploy neither causes nor can fix.

### D3. Add over REST after the pull, not merge-at-build

Chosen, subject to Q1.

Merging at build time means hand-synthesising TM1 Git's file format — element order, types, weights,
attribute definitions, hierarchy headers. A subtle mistake there ships a corrupt dimension to PROD,
which is the failure mode this whole brief exists to prevent. The REST path uses the TM1 API, which
validates its own input.

**Cost accepted:** the file in the repository and the live dimension on PROD diverge for loaded
dimensions. That is why D2 has to exist — drift must know about the loaded part by design, not by
accident.

### D4. A PROD-owned object's file is never in the release commit

Not "not replaced" — **absent**. If the file is in the delta, the pull has already removed the
loaded elements and their data before any REST step can run.

Consequences to handle in the build:

- `verifyRelease` must not expect that file to have landed (today it asserts every included object
  is present);
- the Review screen lists the dimension as "loaded — add only" with exactly what will be added;
- the release's object list must still show that the dimension was touched, or a reviewer cannot
  see why nothing shipped for it.

### D5. The concept is "PROD-owned", not "loaded"

A dimension maintained by a nightly GL load and one an admin edits by hand behave
identically at deploy time. So there is one property, not two:

| Term | Meaning |
|---|---|
| **PROD-owned** | A deploy may only **add** to it. Never removes, never replaces, never overwrites values. |
| **DEV-owned** | A deploy may change it as it does today. |

`maintainedBy` records *why* it is PROD-owned — a process name, or `admin` — for the screen and the
drift report. It never changes behaviour.

"Governed" stays in documentation as the policy word: a governed dimension is one the organisation
marks PROD-owned.

**Applies to dimensions, hierarchies, subsets and views.** Subsets and views must be PROD-ownable:
`applySubset`/`applyView` call `saveSubset`/`saveView`/`saveNativeView`, all of which **replace**, so
a PROD-side edit to a subset or view is silently reverted by the next deploy that carries it today.

Record per target, in the target's own model under `Applications/Governance/`:

```json
{
  "dimensions": {
    "Account": {
      "owner": "prod",
      "maintainedBy": "WFP Load Accounts",
      "prodAttributes": ["Description", "GL Mapping"],
      "setBy": "jdlove", "setAt": "2026-11-21", "why": "GL load"
    }
  },
  "subsets": { "Account:Default": { "owner": "prod", "maintainedBy": "admin" } },
  "views":   { "WFP Workforce Cost:Input": { "owner": "prod", "maintainedBy": "admin" } }
}
```

- **`owner`** — the switch every part of the pipeline reads
- **`maintainedBy`** — for people, never for behaviour
- **`prodAttributes`** — the attribute *values* that are PROD's even on a DEV-owned dimension

**Who sets it:** admin only, on an **Ownership** screen (rail item beside Baselines), suggested then
confirmed. Suggestions come from `process-scan`: a dimension inserted into by a chore-scheduled
process, and the attributes those processes write. Nothing becomes PROD-owned until confirmed.

**Inheritance:** a PROD-owned dimension makes its hierarchies and subsets PROD-owned by default.
Views are flagged individually (they belong to a cube). Default to protected: un-flagging a subset
is cheap; a reverted subset nobody notices is not.

### D6. PROD-owned means create-only at deploy time

If the element (or subset, or view) already exists on the target, **skip it and report the skip**.
Never update an existing PROD-owned object. Otherwise a load-maintained description is quietly
overwritten with whatever DEV happened to hold.

### D7. Archiving is a re-parent, not a delete

Add an `Archive` consolidation to each governed dimension and move retired elements under it at
**weight 0**, so they keep their cells and attributes and contribute to no total.

`Archive` normally grows on PROD through admin work. Drift therefore treats re-parents on a
PROD-owned dimension as **expected** (like additions), and reports the count. Archiving needs no
approval — no elements are lost.

### D8. True deletes are admin work on PROD, and the pipeline cannot undo them

Elements removed by an admin on PROD stay removed, because:

- the hierarchy file is never shipped for a PROD-owned object, and
- unrecorded additions are opt-in (D1), so DEV's copy of a deleted element is not silently sent back.

**Drift is split in two**, and only the second kind pauses a deploy:

| | Examples | Effect |
|---|---|---|
| **Expected** | elements added on PROD; elements re-parented under `Archive` | listed, counted, never blocks |
| **Unexpected** | an element that is **gone**; a changed attribute definition; changes to rollups DEV owns | blocks, as today |

Every ignored item is named with its `maintainedBy` — "ignored: 3 added by WFP Load Accounts" —
so tolerance never becomes silence.

### D9. DEV must be able to sync PROD-owned objects from the target

Without this, DEV's copy of Account is months stale: project work cannot build a rollup over loaded
elements, cannot reference them in a subset, and the model's tests run against a shape that PROD does
not have.

**"Refresh from PROD"**, per object or for every PROD-owned object:

- **Structure only**: elements, edges (including `Archive`), attribute definitions, and PROD-owned
  attribute values. **Not cube data** — so an assertion that depends on loaded *values* can only be
  proven at deploy, not on DEV. Say that where the tests are run.
- **Add and update; never remove.** Report what DEV holds that PROD does not, rather than deleting it.
- **Preview before applying**: N elements added, M updated, K subsets, V views.
- **Recorded as a sync, not as a change**: its log entries carry their own action and are not mapped
  to a release object, so a sync can never ship back to PROD. (Same treatment `process-run` gets.)
- If DEV's copy of a PROD-owned element differs from PROD's, PROD wins — and the difference is
  reported, because someone edited DEV against the rule.

*Open:* who may run a sync — any user with DEV write access (my preference: it is needed to do the
work) or admin only.
