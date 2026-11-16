# 07 — Change sets, assertions, deploy: checked verdict

Claude checked OpenCode's `07_DEPLOY_FINDINGS.md` against the code on 16 Nov 2026. Nothing fixed
yet. James decides — and this area needs his decision more than the others, because several
fixes change deploy behaviour (what is refused, what is required).

## What was checked

| Claim | Result |
|---|---|
| `execute()` reconciles and runs control checks only `if (source)`; the route requires `target` but not `source` (`core/git-deploy.js:289-318`, route) | **Confirmed** — Rule 3 ("every deploy runs control checks") is not enforced server-side |
| Attribute-value writes are never logged to the change set (`server.js:1278-1283`, bulk import) | **Confirmed** — no `ATTRIBUTE_VALUE` action exists anywhere; the route gates and writes, no `writeLog`. The reconcile has nothing to copy. Rule 1's attribute gap is not closed. |
| `firstPull` never records the deployed anchor (`core/git-setup.js:48-57`); `recordDeploy` is called only from `execute()` | **Confirmed** |
| Governance reads are gated by a **local** marker file (`core/model-store.js:27-34`); approvals fall back to a local file; `lastDeployed` reads only the local JSON | **Confirmed** — a fresh IDE sees none of the model-owned records. Matches the "model owns its history — not started" note in project memory. |
| Session close/resume/description have no owner check (`server.js:376-414`) | **Confirmed** — `req.user` is recorded as `closedBy`, never compared to the owner |
| DeployCenter "New Deploy" opens the retired `DeployPanel`, which ends in a "retired" note; DeployHistory reads `config/archives` from the old package pipeline | **Confirmed** |
| Git push route does not run the readiness scan | **Confirmed** |

Not re-verified line by line but consistent with the code read: 2.3 (reconcile errors don't
clear `controlOk`), 2.5 (unparsable plan ops ignored), 2.6 (cleared attribute not synced),
4.2 (drift check pushes `prod-live` with no lock), 8.1 (`runOne` doesn't record), 8.3
(assertion writes use `gateReadOnly`), 1.4, 2.2, 3.2, 3.3, 6.3, 6.4, 7.2, 8.2, 8.4, 9.x.

## The honest position

`DEPLOY_LIFECYCLE.md` says five rules are enforced and "proven end to end". After this review:
Rule 5 holds. Rules 1–4 each have a real gap. The loop *was* proven once, by one person, on the
happy path with the IDE that did the first pull; the gaps are in what happens off that path
(no `source`, a second IDE, an attribute edit from the grid, an unknown plan op, a delete that
was skipped). None of them was hit because nobody has run it from a second machine or a second
user yet. That's the same pattern as every other area, but here the doc and the public article
make promises, so the first fix is to the doc.

## Ranked recommendations

### Round 1 — make the guarantees true (behaviour changes; James to confirm each)

1. **Doc first.** Add a dated "Known gaps" section to `DEPLOY_LIFECYCLE.md` listing items 2–9
   below, today, before any code. Honest docs are the standard; the article links here.
2. **Rule 3: `source` is not optional.** `execute()` requires `source`; derive it from the
   approval's linked change set and refuse if the caller's `source` disagrees. Reconcile and
   control checks always run. Reconcile errors, skipped deletes and attribute-sync errors make
   `controlOk` false (2.3). *Small/medium.*
3. **Rule 1: attribute values in the change set.** New log action `ATTRIBUTE_VALUE_SET`
   (dimension, hierarchy, element, attribute, old, new) written by `/api/element/attribute`,
   the bulk importer, and the MCP `set_attribute_values` tool; `getSessionManifest` includes
   them; `syncAttributeValues` also clears blanks (2.6). The manifest also covers subset / view /
   chore deletes (2.2). *Medium.*
4. **Rule 1: unknown plan operations refuse** (2.5). `parsePlanOp` returns `{ unknown: true }`
   for anything it can't classify, and `execute()` refuses with the raw op in the error. *Small.*
5. **Rule 4: the first pull records the anchor** (1.3). `firstPull` calls `recordDeploy` with
   the pulled commit. *Small.*
6. **Readiness gates the push** (3.1). The push route runs `scan()`; blockers refuse, warnings
   pass through to the response. GitSetup disables Link / Commit on blockers. *Small.*
7. **Drift check takes the deploy lock** (4.2) around its `prod-live` push. *Small.*
8. **Change-set ownership** (7.1). Close, resume and description: owner or admin only; all
   three gated on read-only posture. *Small.*
9. **Assertions.** `runOne` records to `}TestResults` (8.1); writes use `gateWrite` (8.3);
   validate numbers and ignore client-supplied identity fields (8.2); read failures surface
   (8.4). *Small.*
10. **One deploy surface.** Delete `DeployPanel` and DeployCenter's package/import views;
    "New Deploy" opens `DeployWizard`; `DeployHistory` reads the model's deploy records
    (`Deployments/state.json` + approvals), with the old archives list kept as a collapsed
    "earlier REST pipeline" section (6.1, 6.2, 6.4). Reset the built release when the target
    changes (6.3). *Medium.*

### Round 2 — finish model-owned governance (design work; its own brief)

11. **Rules 2 and 4: a fresh IDE reads the model** (1.1, 1.2, 4.1, 7.2, 9.1). Discovery comes
    from the server: on connect, read `Applications/Governance/*`; the local marker becomes a
    cache hint, not the source of truth; `lastDeployed` reads the model with local as fallback;
    `/api/sessions` merges model change sets; `session.deployed` comes from the deploy record;
    the governance mirror runs as a deploy step or is deleted. This is the "model owns its
    history" decision of 2 Oct, still unbuilt. *Large.*
12. **Re-close of a resumed change set** must not overwrite the immutable record (1.4): write a
    new version or refuse resume after close. Decide which. *Small once 11 is designed.*

## Keep as the model (agreed)

The approval gate inside `execute()` (Rule 2 holds there), Rule 5 fully retired, the
`safety-*` tests, one git runner in `git-repo.js`, the deploy lock, and the evidence-style
manifest. The design is right; the gaps are in coverage, not shape.
