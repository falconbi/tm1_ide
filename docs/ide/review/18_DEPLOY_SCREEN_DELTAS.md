# 18 — Deploy screens vs the design: delta list

**Date:** 26 Nov 2026 · **Sources:** `16_DEPLOY_AGAIN.md` (design), `16_DEPLOY_AGAIN_DONE.md` (build log), current code.

A row is a **contradiction** only where a screen or the flow does something the design says it must
not, or leaves out something the design says it shows. Priorities: **P1** breaks a stated rule;
**P2** misstates or omits; **P3** same brief, not a screen.

## P1 — contradicts the design's core rule

| # | Screen | Design says | Code does | Fix |
|---|---|---|---|---|
| **D1** | Pre-deploy, step 2 **"Refresh from PROD"** | Part D header: *pre-deploy check (writes nothing to PROD or DEV)*. Process list: 4 steps — check → tests & close → build → review. E.4: *`applyRefresh` is no longer called from the deploy flow.* | 5 steps. Step 2 plans **and applies** PROD's changes to DEV via `/api/deploy/refresh/apply`. | Delete step 2 and its state/handlers. Pre-deploy = 4 steps. The check stays a notification. |
| **D2** | Same screen: **"Attributes PROD has that DEV does not"** (ticks) | D.3: attribute definitions are *"kept in the release"* + *"DEV is behind — run the sync"*. No create option in pre-deploy. | Ticks create definitions on DEV and log `DIMENSION_UPDATED`, which turns the dimension into a whole-file change. | Remove with D1. Show as a notification only. |
| **D3** | Same screen: subsets/views copied with **no tick**, and they enable the Refresh button | E: copy is Sync's job, default *take PROD's* with an **untick** per item. | `doRefresh` sends every listed subset/view with choice `take`; the button is enabled even with the dimension unticked. | Remove with D1. |
| **D4** | Same screen: **green button** is `Refresh into DEV`; `Continue` is an underlined text link | D: *Runs first in every deploy; Continue only once it has run.* Continue is the path. | Visual primary is the writer; the skip is secondary. | Make `Continue` primary; any copy action secondary and count-labelled. |
| **D5** | Deploy phase: **"When was PROD last backed up?"** (typed date/time, required) | I.3: *Refuse unless a backup process is set… The IDE provides the backup process… The typed-in time is gone: it proved nothing.* | Backend already installs and runs `}IDE.Backup` by default and **ignores** the `backupAt` value (`core/git-deploy.js:285,632`). The UI still blocks Deploy until a time is typed, and `deploy-settings.json` has `backupProcess: null`. | Remove the field; show *"`}IDE.Backup` will run"*; `canDeploy` no longer needs `backupAt`. |

## P2 — screen misstates or omits what the design requires

| # | Screen | Design says | Code does | Fix |
|---|---|---|---|---|
| **D6** | Pre-deploy "kept / DEV is behind" list | D.2–D.3: compare Last Deployed with Live **for objects and attributes**; attribute definitions/values show as kept + run the sync. | `preDeployCheck` writes `attrs-<target>` but `driftCheck` compares **objects only** — attr files never enter `out.diff`. So PROD attribute changes are never named. | Diff `attrs-<target>` against the last deploy's attrs commit; fold into kept/sync. |
| **D7** | Sync DEV (nav item and the pre-check button) | E.1: **admin** action. | Shown to every user; `POST /api/deploy/sync` and `/sync/plan` require admin on **both** servers. A non-admin gets a refusal. | Hide/gate by admin, or label *"ask an admin"*. |
| **D8** | Change Sets header + Release list | The change set is the unit; the release ships **objects**. | `entry_count` counts distinct log rows: `Contractor rollup` reads **5 changes** while the release ships **1 object**. | Count objects (or show *"5 edits · 1 object"*). |
| **D9** | Deploy → **Baselines** | The design's baseline is Git: Last Deployed commit + `attrs-<target>`. Nothing seeds a snapshot. | Screen reads `.tm1baseline` and the old REST seed route. Seeding there does not affect a Git deploy. | Remove from nav, or label *legacy / REST-pipeline diagnostics*. |

## P3 — same brief, no screen

| # | Item | Design | State |
|---|---|---|---|
| **D10** | MCP | N.1 retire `check_deploy_risk`, `check_target_drift`, `seed_baseline`, `list_baselines`, `set_baseline_head`, `diff_change_set`, `package_change_set`; N.2 add read-only `pre_deploy_check`, `show_release`, `show_review`. | Not done (DONE log). |
| **D11** | Setup wording | C: no first pull; TEST/PROD writes its own objects. | UI is correct (Fix 9), but `NO_BASE_ERROR` still says *"init + first pull"* (`core/git-release.js:27`), and the step-0 walkthrough still describes a confirming overwrite. |

## Build-log claims the code does not support

- **Fix 9** says the pre-deploy screen is the check (stop / kept / carry-back / sync lines, two
  buttons, Continue gated). That part is built — but it did not remove the older step 2, which
  still writes and directly contradicts E.4.
- **Part C** says *"UI uses the old flow"*; Fix 9 later changed it, so that line is stale.
- The first build log's **"Not done yet"** list (E, F, G, H unbuilt) is superseded by the second
  log. Read alone it says the core is missing; read together, only the rows above remain.

## Suggested order

1. **D1–D4** — delete pre-deploy step 2 (attributes, covers, header numbering, green button). One
   file: `DeployFlow.jsx`, then rebuild the client.
2. **D5** — remove the typed backup time; show `}IDE.Backup`.
3. **D7, D8** — admin gate for Sync; count objects in the change-set labels.
4. **D6** — attribute comparison in the pre-deploy check (core + screen).
5. **D9** — decide Baselines: remove or relabel.
6. **D10–D11** — MCP surface and the first-pull wording.

## Status — 26 Nov (after the first alignment pass)

| Item | State |
|---|---|
| **D1–D4** | **Fixed.** `DeployFlow.jsx` now has 4 pre-deploy steps; the Refresh step, the attribute ticks and the implicit subset/view copy are gone; `Continue` is the green action. Client rebuilt into `static/`. |
| **Label bug (found in the browser while fixing D1)** | **Fixed.** `fileObject` named a dimension's files `WFP Employee.hierarchies`; it now returns the dimension (`WFP Employee`) and the subset's own name (`Test_New_Adds`). `tests/pre-deploy-check.test.js` asserts it. **Needs a backend restart** to show — `core/pre-deploy.js` is cached in the running server. |
| **D12 (new)** | **Fixed.** "Ready for" starts empty (`Select the target…`); opening Deploy no longer queries a default target, so no unrelated sign-in prompt. Confirmed in the browser. |
| **D5** | **Fixed.** The typed "When was PROD last backed up?" field and `backupAt` are gone; the Deploy screen names the backup (`}IDE.Backup`, or a configured process) and Deploy only needs the approval. |
| **D7** | **Fixed.** The Sync nav item is admin-only (the routes already were). The pre-check no longer offers a Sync button at all: it is a notification only, and says Sync is a separate action in the Deploy tab — not part of a deploy. |
| **D8** | **Fixed.** `entry_count` now counts objects, not rows: the SQL list count and the open-set header use one rule (`core/change-log.js` `changeObjectCount`). `Contractor rollup` reads **1 change** (5 rows kept in the audit). `tests/change-set-object-count.test.js` asserts SQL and JS agree. **Needs a backend restart.** |
| **D9** | **Fixed (removed from the nav).** *Baselines* was the pre-Git snapshot pipeline; the Git baseline is Last Deployed + `attrs-<target>`. `DeployBaselines.jsx` and `/api/deploy/baseline|seed` remain for legacy/diagnostics until N.1 retires the matching MCP tools. |
| **D6** | **Fixed.** The pre-check compares `attrs-<target>` with the last deploy's attrs commit and adds a kept/sync row per changed dimension ("attribute WFP Employee"). `fileKind`/`fileObject` understand `attributes/…`; new tests cover changed and unchanged. **Needs a backend restart.** |
| **D13 (new)** | **Fixed.** The check names what PROD has that DEV lacks, per changed object (`not on DEV: ZZ_TEST_EMP_A, ZZ_TEST_EMP_B`; `not in DEV` for a subset), not just the drift summary. Only PROD's **additions** are compared, so an edge DEV deliberately removed is not a false gap. Verified directly against the servers. **Needs a backend restart.** |
