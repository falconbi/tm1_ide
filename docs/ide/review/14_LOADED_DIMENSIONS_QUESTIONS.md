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

### D4. A loaded dimension's hierarchy file is never in the release commit

Not "not replaced" — **absent**. If the file is in the delta, the pull has already removed the
loaded elements and their data before any REST step can run.

Consequences to handle in the build:

- `verifyRelease` must not expect that file to have landed (today it asserts every included object
  is present);
- the Review screen lists the dimension as "loaded — add only" with exactly what will be added;
- the release's object list must still show that the dimension was touched, or a reviewer cannot
  see why nothing shipped for it.
