# Deploy pipeline hardening — plan

## Status — 2026-09-09 (built, not yet deployed / restarted)

| Fix | State |
|---|---|
| 1 attribute values as data, every deploy | **done** — `deployer.js` replays `attribute_values` always (was `!exists` only), scoped to packaged pairs; `report.attribute_values` / `attribute_value_errors` |
| 2 dimension structure readback | **done** — `deployDimension` compares element count to package, `report.structure_gaps` |
| 3 subset change-log key includes dimension | **done** — `change_log.js` `writeLog` collapse + 3× `GROUP BY` now use `IFNULL(detail,'')` |
| 4 post-deploy hooks | **done** — `config/deploy-hooks.json` → `manifest._meta.post_deploy` → deployer runs on target before verify; `report.post_deploy` |
| 5 baseline owned by pipeline, after hooks | **done** — sequence is deploy → hooks → verify → baseline; `clean = 0 failed objects && 0 failed hooks` (verification advisory, stamped on the baseline as `verification_failed` + an `[UNVERIFIED …]` label) |
| 6 refuse to package an unreadable view | **done** — `getViewWithSubsets` flags `_unresolved` axes; `fetchView` throws → view lands in `manifest.skipped` with a clear reason instead of corrupting the target |
| 7 drift vs target baseline | **already done** (`af92b3b`) — verified: `driftCheck` loads `loadBaseline(null, targetServer)` first. Fix 5 makes the stale-baseline case self-heal (every deploy re-seeds the target baseline). |

Panel screen 3 shows post-deploy steps, structure gaps, attribute-value errors.
Frontend rebuilt (`index-ezEw0vHk.js`).

**Left:** restart IDE + MCP. Then deploy P6 as the acceptance test. Then the
separate WFP change set to delete the 3 scar-tissue processes + recreate
`Cost by Cost Centre` with a named-subset column axis.

---


**Goal:** one managed lifecycle. `package → risk gate → deploy → post-deploy steps
→ verify → baseline → archive` runs as a single flow with no manual steps wedged
in the gaps. The only human actions: approve the risk report, trigger the deploy.

**Why now:** every WFP phase (3.5, 4, 5, 6) landed clean on DEV, then the deploy
fought back with a different papercut — baseline timing, lossy view capture,
subset name collisions, a manual 5-step post-deploy list, stale-baseline drift
noise. P7/P8 will hit the same walls. Fix the pipeline before more model work.

Own change set. IDE/pipeline code only — no TM1 model changes here (the
scar-tissue process deletions are a separate WFP change set, sequenced last).

---

## The scar tissue this removes

Three WFP processes exist **only** to reconstruct state the deploy fails to
carry. They are not model logic. After this work they are deleted:

| Process | Exists because | Fixed by |
|---|---|---|
| `WFP Seed Dimension Attributes` | packager ships attribute *definitions*, not *values* | Fix 1 |
| `WFP Build YTD Hierarchy` | didn't trust the packager to carry alt-hierarchy edges | Fix 2 |
| `WFP Create Default Subsets` | change-log keys subsets by name only → `Default` on a 2nd dim is dropped | Fix 3 |

The manual post-deploy list (`Seed → Build → Load → Create Subsets → Reprocess
Feeders`) collapses to: the deployer runs the declared hooks itself. The only
thing left in human hands is `WFP Load Actuals`, which is an *operational* data
load, not a deploy step.

---

## Target lifecycle

```
package_change_set / release
   ├─ diff vs the TARGET's current baseline HEAD          (Fix 7)
   ├─ completeness gate (change-set packages)             [B2, done]
   └─ manifest._meta.post_deploy = [ordered hook list]    (Fix 4)

deploy(packageDir, target)
   1. risk gate                                           [done]
   2. deploy objects
        └─ dimensions carry structure AND values          (Fix 1, Fix 2)
   3. run manifest._meta.post_deploy on the target        (Fix 4)
   4. verify — source assertions vs target                [B3, done]
   5. baseline — seed BOTH baselines                      (Fix 5)
        clean = 0 failed objects AND 0 failed hooks
        (assertion result is advisory, recorded not gating)
   6. archive + cross-link deploy ↔ baseline ids          [B-leftover]
```

---

## Fixes

### Fix 1 — Attribute values travel as data (always, not greenfield-only)

**Where:** `tools/tm1deploy/src/packager.js` (`fetchDimension`),
`tools/tm1deploy/src/deployer.js` (`deployDimension`, line ~147-169).

**Now:** `deployDimension` replays `attribute_values` only `if (!exists)` — i.e.
only when the deploy *creates* the dimension. On a redeploy the target's seed TIs
are assumed to own them. That assumption is the scar tissue.

**Change:**
- `fetchDimension`: confirm it captures every populated `}ElementAttributes_<dim>`
  cell for every element (not a sample). Add element *format* strings too.
- `deployDimension`: replay `attribute_values` **whenever the package carries
  them**, not just greenfield. Scope: write only the (element, attribute) pairs
  the package captured — the package is the declared state; it doesn't touch
  attributes it doesn't know about.
- Keep the existing `updateCells` path; batch it.

**Risk:** a target that hand-maintains an attribute the package also carries gets
overwritten with the package's value. Acceptable — that is what "deploy the
declared state" means. Document it; `force`-style override not needed.

**Kills:** `WFP Seed Dimension Attributes` (Period Index / Days In Month / Prior /
Next / FY / Pay Index / GL Account / Capex % all ride along as captured cells).

### Fix 2 — Trust dimension structure; verify it

**Where:** `deployer.js` `deployDimension`, plus a new post-deploy check.

**Now:** `deployDimension` already applies full elements + edges from the package
(verified: P5 GL nodes, P6's 93-element WFP Period with all YTD members shipped
correctly). `WFP Build YTD Hierarchy` is belt-and-braces for a bug that may be
gone.

**Change:**
- Test `deployDimension` against a fresh target with the full YTD edge set
  (~230 edges across 3 FYs) — confirm `tm1.AddEdges` batching handles it.
- After deploying a dimension, read back element + edge counts and compare to the
  package; `report` a mismatch loudly (not just a console.warn).

**Kills:** `WFP Build YTD Hierarchy` once the fresh-target test passes.

### Fix 3 — Subset change-log key includes the dimension

**Where:** `core/change_log.js` `writeLog` (line ~196-208, the `COLLAPSIBLE_ACTIONS`
collapse), and every `GROUP BY object_type, object_name, action` in
`getSessionLog` / `getEntriesSince` / `getEntriesSinceId`.

**Now:** `SUBSET_SAVED` collapses on `session_id + object_type + object_name +
action`. `detail` (which holds the dimension for a subset, the cube for a view)
is not in the key. Two `Default` subsets on different dimensions collapse to one
row → the packager only ever sees one.

**Change:** add `detail` to the collapse-match `WHERE` and to every `GROUP BY`.
`('subset', 'Default', 'SUBSET_SAVED', 'WFP Currency')` and
`(…, 'WFP Pay Component')` become distinct entries.

**Kills:** `WFP Create Default Subsets` — `Default`-subset edits ship in the
package like any other object.

### Fix 4 — Post-deploy hooks in the manifest

**Where:** `config/deploy-hooks.json` (new), `packager.js`, `deployer.js`,
`server.js` (`/api/deploy/execute`), `DeployPanel.jsx` (results screen).

**Design:**
- `config/deploy-hooks.json` keyed by server:
  `{ "TM1_Test_DEV": { "post_deploy": ["WFP Reprocess Feeders"] } }`
- `pack()` copies the **source** server's `post_deploy` list into
  `manifest._meta.post_deploy`.
- `deploy()` — after objects land, before verify — runs each named process **on
  the target** via `client.runProcess`, in order. Result → `report.post_deploy`
  `[{ name, ok, error }]`. `report.post_deploy_failed = any(!ok)`.
- Panel screen 3 renders the hook results (green/red line, like verification).

After Fixes 1-3 the only hook WFP needs is `WFP Reprocess Feeders`. Feeder
reprocessing after a rules change is unavoidable and belongs in the deploy.

### Fix 5 — Baseline owned by the pipeline, seeded after the hooks

**Where:** `deployer.js` line ~333-350 (`clean` / auto-baseline).

**Now:** `clean = !dryRun && report.failed === 0 && !report.verification_failed`.
Verification runs *before* the (manual) seed processes → fails → baseline
skipped → the operator seeds it by hand → forgets → stale-baseline drift next
time. This is the B4 trap.

**Change:**
- Sequence: deploy objects → **run post-deploy hooks** (Fix 4) → verify → baseline.
  Verification now runs against a fully-seeded target, so it passes.
- `clean = !dryRun && report.failed === 0 && !report.post_deploy_failed`.
  Assertion failures are **recorded on the baseline meta as a warning**, not a
  gate — assertions can fail for data reasons unrelated to the deploy, and the
  operator still needs a baseline recorded for rollback reference.
- `deploy()` seeds the **target** baseline as its final act on any deploy with 0
  failed objects + 0 failed hooks. Source baseline too (the release window
  starts here).

**Kills:** manual baseline seeding, and the "re-seed PROD baseline to clear stale
drift" step.

### Fix 6 — `getView` reads a named-subset axis correctly

**Where:** `core/tm1_client.js` `getView` axis extraction (the deploy client
path), mirror the CLAUDE.md ViewEditor fix.

**Now:** a row/column axis pointing at a **named public subset** comes back as
`memberSet: "all"` instead of `subset: "<name>"`. The packager then serialises a
phantom change (`Cost by Cost Centre` → columns "all periods" instead of "2026
Quarters + FY"), which enters the release package and shows as drift.

**Change:** in axis extraction, `Rows?$expand=Subset` returns
`{ Subset: { Name: "2026 Quarters + FY", ... } }` for a named subset. Check
`placement.Subset?.Name` — **truthy** (non-empty) → `{ dimension, subset: Name }`.
Only fall to `memberSet` / `members` when `Name` is empty/falsy (inline subset).
This is the `!p.Subset?.Name` falsy-check already applied in `getSubset` /
`extractAxis` — apply it in the deploy client's `getView` too.

Then re-capture affected views. Check `Cost by Cost Centre` on DEV — recreate it
with its correct column subset to be certain (the lossy *read* may mean it was
never actually broken).

**Kills:** phantom view drift.

### Fix 7 — Drift + baseline references

**Where:** `tools/tm1deploy/src/diff.js` `driftCheck`, `deployer.js`.

- **Confirm** `driftCheck` already compares against the *target's* current
  baseline HEAD, not the package-bundled baseline (commit `af92b3b` suggests it
  does — verify and add a test).
- With Fix 5, every deploy ends with a fresh target baseline, so the "stale photo"
  drift noise stops occurring naturally.
- **One-time now:** re-seed the `TM1_Test_PROD` baseline (it is stuck at Phase 4
  because P5's deploy hit 42/43 at verify and B4 skipped). Clears the current
  false drift on the P6 release.

---

## Sequencing

1. **Fix 3** (subset key) — smallest, unblocks the cleanest test.
2. **Fix 6** (getView) — stops phantom changes entering packages.
3. **Fix 1** (attribute values as data).
4. **Fix 2** (dimension structure verify).
5. **Fix 4** (post-deploy hooks) + **Fix 5** (baseline timing) — together, they are
   the same flow change.
6. **Fix 7** — verify drift reference; one-time PROD baseline re-seed.
7. **Deploy P6** through the hardened pipeline — the acceptance test. One trigger:
   deploy → hooks → verify → baseline, no manual steps. If it is not that, keep
   fixing.
8. **Separate WFP change set:** delete `WFP Seed Dimension Attributes`,
   `WFP Build YTD Hierarchy`, `WFP Create Default Subsets`. Update the
   fresh-target run order in `WORKFORCE_MODEL_PLAN.md`.

Steps 1-6 are one pipeline-hardening change set. Restart the IDE + MCP after, per
the `core/*` / `tools/tm1deploy` restart rule.

## Out of scope (Phase C, later)

Rollback / restore-to-baseline, deployment→baseline id cross-linking in the
archive, server-side approval enforcement.
