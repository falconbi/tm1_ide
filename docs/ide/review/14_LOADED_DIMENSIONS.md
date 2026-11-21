# 14 — Loaded dimensions: PROD keeps what it loads, DEV adds what it designs

Build brief for OpenCode. Date: 21 Nov 2026. Area: the deploy pipeline.

## Why

Found by James during a step-by-step walkthrough of the deploy. In real models, some dimensions
are maintained **on PROD**: for example, a nightly process loads new account codes from the GL into
the Account dimension and writes their descriptions and mappings as attributes. The deploy doesn't
know about this today. That causes two problems:

1. **False drift.** TM1 Git saves a dimension with its elements. After the GL load, PROD's Account
   dimension differs from what PROD last received. Review (`core/git-deploy.js` `prepare` →
   `targetDrift`) and Verify both report drift, and deploys to PROD are paused, even though nobody
   edited anything by hand.
2. **Data loss (the serious one).** If a change set touches the Account dimension on DEV (a new
   attribute, a new rollup), `core/git-release.js` `buildRelease` ships DEV's whole dimension file.
   The pull then **replaces** PROD's dimension with DEV's, and GL codes that exist only on PROD are
   removed, along with their data in every cube. The "removes N elements" warning
   (`core/git-readiness.js` `firstPullAnalysis`, `elementLoss`) only runs for the first pull, not
   for normal deploys.
3. **Attribute values overwritten.** Attribute values aren't in TM1 Git. `core/git-reconcile.js`
   copies them after the pull. When the change log only knows the dimension changed, not the exact
   element and attribute, it copies **every attribute value of every element** from DEV
   (`wholesale`). That overwrites PROD's GL-loaded descriptions and mappings with DEV's.

**Verify first:**
- Confirm on TM1_Test_DEV / TM1_Test_PROD that a TM1 Git dimension file holds its elements and
  edges, and that an element added on PROD only (by TI) shows as drift.
- Confirm that the attribute definitions are in the dimension file.

Write the results in the DONE file before building.

## The rule

**For a loaded dimension, PROD keeps what it loads, and DEV adds what it designs.**

| On a loaded dimension | The deploy |
|---|---|
| Elements PROD loaded | **Left alone**: never removed or changed |
| New elements or rollups this change set created on DEV | **Added** to PROD |
| Values of **loaded** attributes (e.g. Description, GL Mapping) | **Never copied** from DEV |
| Values of **developer** attributes (e.g. a reporting line) | **Deployed** as normal |
| A new attribute (its name and type) | **Deployed**, so PROD's load can fill it |
| Anything else that happens to be on DEV (test codes, codes from DEV's own load) | **Never sent** |
| Deleting an element or attribute | **Only** as an explicit, named delete in the change set, listed at Review and approved. Never automatic. |

Other dimensions keep today's behaviour: DEV's copy replaces PROD's.

## What to build

### 1. Element-loss check on every deploy (do this first; it stands alone)

- At Review, for **every** dimension in the plan, compare PROD's elements now with the release's
  elements. Reuse the `elementLoss` logic in `core/git-readiness.js`. Don't write a second copy.
- If any elements would be removed, show it plainly, e.g. "removes 3 elements from Product: A, B,
  C (and their data in every cube)".
- **Loaded dimension:** refuse. Approve stays blocked.
- **Other dimension:** the loss must match deletes recorded in the change set. An unexplained loss
  blocks Approve. A recorded one is shown and goes through approval.

### 2. Where "loaded" is defined

- **Kept in the target's model**, next to the deploy record, under `Applications/Governance/`.
  Add an area to `core/model-store.js`, e.g. `loadedDims: { folder: 'Deployments', doc:
  'loaded-dimensions.json' }`. It's **per target**: TEST may not run the GL load when PROD does.
- Contents: per dimension, `loaded: true`, the list of loaded attributes, who set it, when, and
  why.
- **Not** in a local config file. Then only one install would know about it.

### 3. Deploy Center → Loaded dimensions page

- A new rail item next to Baselines, admin only.
- **Suggest, then confirm** (dynamic, low admin). Read the target's processes with
  `core/process-scan.js`. Reuse it; don't write a new scanner. Then suggest:
  - a dimension that a process **scheduled in an active chore** inserts elements into
    (`DimensionElementInsert`, `DimensionElementComponentAdd`, and so on): suggest it as loaded;
  - attributes those processes write (`AttrPutS` / `AttrPutN`, `ElementAttrPutS` / `ElementAttrPutN`):
    suggest them as loaded attributes.

  Show the process and chore behind each suggestion. An admin ticks to confirm, or adds one by
  hand. Nothing is loaded until confirmed.

### 4. Build release (`core/git-release.js`)

- When the change set touches a loaded dimension, **don't** ship DEV's dimension file to replace
  PROD's. The release lists that dimension as "loaded: add only", with exactly what will be added:
  the elements, edges and attributes **this change set's log recorded**.
- If the log can't say what was added (only that the dimension changed), **refuse** with a clear
  message, rather than guessing or shipping the whole dimension.

### 5. Deploy (`core/git-deploy.js` `execute`)

- Apply the "add only" items to PROD over REST after the pull, the same way subsets and views are
  applied today (`applyReleaseComplement`). Add elements, edges and attribute definitions; never
  remove.
- `verifyRelease` checks each added item landed.
- **Attribute values** (`core/git-reconcile.js`):
  - never copy a loaded attribute;
  - never do a `wholesale` copy for a loaded dimension. Copy only the recorded element/attribute
    pairs, and refuse if there aren't any.

### 6. Drift (`core/git-drift.js`)

- For a loaded dimension, **ignore new elements and edges** under the loaded part of the
  dimension.
- Still report:
  - removed elements;
  - changed attribute definitions;
  - changes to the rollups DEV owns.
- The drift result says what it ignored ("ignored: 14 elements added by the GL load in
  Account"), so it's never silent.

### 7. Screens

- **Review:** each loaded dimension shows "loaded: add only" and what it adds.
- **Verify:** shows what drift ignored.
- **Help text and `docs/deploy/DEPLOY_LIFECYCLE.md`:** a short "Loaded dimensions" section, in
  plain English.

## Proof (on TM1_Test_DEV → TM1_Test_PROD)

1. On PROD, add 3 elements to a test dimension with a TI process, and set an attribute value on
   them.
2. Before the flag: show the false drift, and show that a release touching that dimension would
   remove the 3 elements. Item 1 must now block it.
3. Flag the dimension as loaded, with the attribute as loaded.
4. On DEV, in one change set, add a new rollup and a new developer attribute to that dimension.
   Release and deploy it.
5. Check:
   - PROD still has the 3 elements and their attribute values;
   - the new rollup and attribute are on PROD;
   - drift is clean, and lists what it ignored.
6. A normal dimension with a recorded delete still deletes, after being shown at Review.
7. Add tests in `tests/` (fakes, no live TM1) for:
   - the element-loss check;
   - the add-only release;
   - no wholesale copy for a loaded dimension;
   - drift ignoring loaded elements.

## Rules

- Read the model from the server, never from `tmp/`.
- Reuse what exists: `elementLoss`, `process-scan`, `applyReleaseComplement`, `model-store`.
- Make every model change through the MCP tools or the IDE, inside a change set.
- Don't push. Don't restart servers. Leave TM1_Test_PROD's real objects alone; use a test
  dimension for the proof.
- Questions go in `docs/ide/review/14_LOADED_DIMENSIONS_QUESTIONS.md`.

## When finished

Write `docs/ide/review/14_LOADED_DIMENSIONS_DONE.md` covering:
- the "verify first" results;
- what changed, file by file;
- the proof results;
- the tests added;
- anything not done.

A diagram of the whole deploy for the docs comes **after** this is built and proven, not before.
