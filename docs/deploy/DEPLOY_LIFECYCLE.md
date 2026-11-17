# Deploy lifecycle — model-owned, TM1 Git transport (design record, 5 Oct 2026)

Plain-English record of the agreed end-to-end deployment model. Source decisions:
`docs/deploy/TM1_GIT_EVALUATION.md`, `docs/ide/IMPROVEMENTS.md` 10.1 (hybrid) + 10.2 (readiness).

## Known gaps (16 Nov 2026) — being fixed in review area 07

Found by code review, not by a failed deploy. Each line moves to **Fixed** as the fix lands.

**Fixed**
- Step 2 — the approval's linked change set now supplies the authoritative `source`; source mismatch is refused, source is required in release-only mode, and reconcile errors/skips make `controlOk` false with reasons.
- Step 3 — attribute-value writes are logged as `ATTRIBUTE_VALUE_SET`; the manifest carries dimension/element/attribute pairs and subset/view/chore deletes, and a blank value clears the target value.
- Step 4 — an unrecognised pull-plan operation now refuses instead of being ignored.
- Step 5 — first pull records the pulled commit as the target's deploy anchor.
- Step 6 — readiness findings now block the Git push route, and the setup screen disables Link/Commit while blockers remain.
- Step 7 — standalone drift checks take the target's deploy lock; a concurrent check returns busy instead of racing the `prod-live` push.
- Step 8 — change sets are owner-managed (case-insensitive); admins may also close/resume/edit. The UI hides those controls for another user's set.
- Step 9 — single-assertion runs record to `}TestResults`; assertion writes use `gateWrite`; finite numeric fields are validated and client-supplied identity/change-set fields are ignored.
- Step 10 — one deploy surface (the step-by-step wizard); Deploy History shows model deploy records first and keeps package archives collapsed; Release opens the wizard.

**Still open**

- First-pull element-loss analysis (`firstPullAnalysis`) is still not wired into the setup screen (round 2).
- Round 2 — a fresh IDE cannot yet read model-owned governance without local migration markers.

## The rules

1. **A release ships exactly its change set's objects.** A deploy never carries
   whatever else happens to be on DEV. The release is a commit built on the
   target's last deployed state plus ONLY the change set's files; the target's
   pull plan lists those objects and skips the rest. If the plan shows anything
   else, including an operation the parser cannot classify, the deploy refuses. Attribute values are logged as change-set entries
   and reconciled as element/attribute pairs; a blank value clears it. Subset,
   view and chore deletes are part of the manifest; dimension/cube deletes that
   need more context stay explicitly flagged.
2. Nothing reaches a target without a recorded **approval** bound to the exact
   commit — non-optional, enforced server-side.
3. Every deploy runs **control checks** on the target and records the result. The approved change set supplies the source used for reconcile/assertions; a caller cannot substitute another source, and reconcile errors or skipped deletes make the deploy not-clean.
4. **Drift** is measured against what the target last received (the IDE-recorded
   commit), never TM1's own `DeployedCommit`. The first pull records that anchor so
   the first release and the first drift check have a base.
5. **Drift pauses deploys** — the fix is to **re-apply the change on DEV in a change
   set and release it**. There is **no automated Revert or Promote** anymore (both
   were retired 10 Oct 2026): the wizard no longer offers them, the routes and
   `git-drift.revert` / `git-drift.promote` are gone, and the drift **check** + the
   deploy pause stay.

## The architecture in one line

**TM1's own Git integration moves and versions the model; the IDE governs it and handles the three things TM1 Git can't (attribute values, deletes, drift). The model owns all of its data — the IDE stores none of it.**

| Layer | Owns | Where it lives |
|---|---|---|
| The model | objects, tests, change sets, run history, lenses | the TM1 server + its git repo |
| TM1 Git | structure + history + the deploy + the drift check | the model's repo (customer-owned, IBM format) |
| The IDE | governance (change sets, risk, approval, readiness, Model Health) + the three gaps | no model data — connections, secrets, preferences, cache only |

## Proven end to end (5 Oct 2026)

Proven on the happy path from one IDE and one user; the gaps below were found by code review, not by a failed deploy.

The full single-developer loop was exercised on the lab WFP pair (TM1_Test_DEV → TM1_Test_PROD),
unaided, with one attribute value and one delete (the two parts TM1 Git doesn't do):

1. **Build** — change set on DEV (process comment + attribute value + a created-then-deleted process); closed; behaviour+control ran (2 pre-existing forecast failures recorded, non-blocking).
2. **Push** — DEV → repo (`dev`); comment verified in the committed `.ti`, throwaway absent.
3. **Deploy-pull + reconcile** — PROD pulled; the attribute value was applied by `syncAttributeValues`, and the delete round proved **airtight**: the pull leaves the orphan on PROD, `reconcileDeletes` removes it.
4. **Verify** — control set 2/2 on PROD, recorded to `}TestResults`.
5. **Approve** — recorded (the deploy gate).
6. **Drift** — `prod-live` diff **clean (0 entries)**.

Two real bugs surfaced and fixed:

- **`execute()` ordering** — control checks ran *before* reconcile, contradicting the loop (pull → apply values/deletes → assertions). Reconcile now runs first.
- **`driftCheck` never executed its push** — it created the `prod-live` push plan but plans expire in seconds, so `prod-live` stayed stale and the diff false-positived on a clean-but-changed PROD. It now creates **and executes** the plan atomically.

## Gates enforced — proven (6 Oct 2026)

The approval and close gates are **server-side and non-optional**; a client cannot bypass them. Both were re-proven
after the fix, at two levels:

**Engine level** (core modules driven directly):
| Check | Result |
|---|---|
| Deploy without an approval | **refused** (`executed:false, refused:true`) |
| Deploy after a recorded approval | **succeeds** (records `approvedBy`) |
| Drift after the deploy | **clean (0 entries)** |
| Revert after DEV moved on (new unapproved commit) | **refused** — "DEV has moved on since the last deploy — reverting would ship unapproved changes…" *(retired 10 Oct 2026)* |
| Revert with an approved commit (genuine revert) | **proceeds** — a genuine revert passes the normal gate *(retired 10 Oct 2026)* |
| Git identity | from `TM1_GIT_USER` / `TM1_GIT_EMAIL` env (no hardcoded identity) |

**Route level** (HTTP routes, authenticated):
| Check | Result |
|---|---|
| `POST /api/deploy/git/execute` without an approval for the exact commit | **refused** (`refused:true`, message names the commit) |
| `POST /api/sessions/close` while a `block`-severity assertion is failing | **409 refused** — message names the failing assertion(s) |
| Close after the block failure is resolved | **succeeds** |

Notes:
- The approval is bound to **(target, exact commit)** — a new commit invalidates the old approval; `execute()`
  re-creates the plan and checks `plan.Commit.ID`. There is **no `requireApproval` escape hatch**.
- `/api/sessions/close` **never trusts client-sent test results** — it runs the assertions server-side and refuses to
  close on a failing block-severity assertion.
- `data/deploy-approvals.json` and `data/git-deploy-state.json` are **local runtime state — gitignored and
  untracked**.

## Reconcile is change-set-scoped — proven (6 Oct 2026)

The reconcile never infers deletes or values from the whole source — only from the change set's manifest
(`change-log.getSessionManifest`: what it deleted, the element/attribute pairs it changed, and which dimensions it
touched). The manifest is taken **from the approval's recorded change set, server-side** — a client cannot supply a
different session to skip or misapply the reconcile; a missing session is reported, never silently skipped.
Proven on the lab pair:

| Check | Result |
|---|---|
| A **change-set delete** reaches PROD (its own delete, in the manifest) | **deleted on PROD** |
| A **PROD-only process** (never in a change set, never in the manifest) **survives a deploy** | **still present** after deploy |
| A **PROD-maintained attribute** (dimension the change set did not touch) is **untouched** | **unchanged** after deploy (value sync is scoped to the manifest's dims; numeric vs string respected) |
| **Revert after a drift** (a direct PROD edit) | restore: the drifted object comes back to the repo state *(retired 10 Oct 2026 — drift now just pauses deploys)* |

Notes:
- Attribute sync copies **only the recorded element/attribute pairs** when the change log has them; a dimension
  known only by name is copied **wholesale and surfaced** (Review warning + "Copied wholesale" in the result) — scoping
  is never silent.
- The **legacy `/api/deploy/execute` and `/api/deploy/approve` routes are retired** — the step-by-step wizard is the
  only IDE deploy path. The classic DeployPanel/Import package UI and their routes were removed in area 07; the
  `tm1deploy` CLI remains an admin-only path.
- The **`tm1deploy` CLI's `deploy` command** writes to a target **outside** the IDE's approval gate and change-set
  reconcile scope — treat it as **admin-only** (run a drift check after).
- **Static-subset hazard (7 Oct):** PROD's `WFP Period` Default subset lost its 36 YTD members while the dimension
  stayed intact. Pulls never touched WFP Period (always "Skip"; dev = 93), so **no deploy caused it** — the prod-live
  diff for the window shows other out-of-band PROD activity (a new "Test Process", a `WFP Tax Type` dimension change,
  a `Position Input` view change), i.e. **direct model edits/rebuild on PROD during the walkthrough**. TM1 drops
  members from a **static** subset when its elements are removed and does not restore them on re-add. Any rebuild of a
  dimension on a target has this effect; nothing in the deploy pipeline did it here.
- **Revert/Promote retired (10 Oct 2026):** the drift Revert (restore from the approved commit's repo file) and
  Promote (merge `prod-live` → dev) features below are **no longer available** — the buttons, routes
  (`/api/git/drift/revert`, `/api/git/drift/promote`) and `git-drift.revert` / `git-drift.promote` are removed.
  **Drift pauses deploys**; the fix is to re-apply the change on DEV in a change set and release it. The drift
  **check** (`prod-live` diff, IDE-recorded base) stays.

The second drift-check reading in the revert proof briefly showed entries — those were the proof's own PROD-only
test process, cleaned up immediately; with it removed, drift is **clean** and the drifted object is confirmed restored.

## Part 2 — model-owned governance + deploy lock — proven (7 Oct)

**What moved and where** (all live on the TM1 server; the IDE is a window):
- **Change sets** → `Applications/Governance/ChangeSets/<id>.json` (mirrored on write).
- **Approvals** → `Applications/Governance/Deployments/approvals.json`.
- **Deploy history** → `Applications/Governance/Deployments/state.json`.
- **Deploy lock** → `Applications/Governance/Deployments/_lock-<server>.json` (ephemeral coordination).

One storage layer — the same Application-document mechanism assertions use (v11 `.blob` / `/Document/Content`, the 226/278/409 "already exists" handling). On a migrated server the model is the truth; a missing document **throws** (the migrated-marker pattern — never a silent gap). The local files stay as the read fallback until the migration is proven, then retire.

**The deploy lock:** one deploy at a time per target, held in the target's own model, acquired before the pull, released on finish or failure, and shown to everyone in the wizard ("TM1_Test_PROD is being deployed by admin since HH:MM"). A second deploy to the same target is refused. Standalone drift checks take the same lock (a deploy's internal drift check skips it because the deploy already holds it). The lock is also the model-writability gate — if the target's model can't be written, the deploy stops with a clear message. A lock older than ~30 min is treated as **stale** (a deploy that died with a backend, or a failed release) and can be **cleared** from the IDE, recording who/when in the deploy history — a stale lock can no longer block a target forever. **Caveat:** `acquire` is check-then-write, so two simultaneous deploys to the same target could both pass the check before either writes — accepted for small teams; a compare-and-swap would close the race if it ever matters.

**Proof (round 2, plain English):**
- A change set that deleted the dummy **"Test Process"** → committed → **deploy without approval refused** → approved (recorded in the model) → deployed → **Test Process deleted on PROD** by the change-set-scoped reconcile.
- A **subset drifted** on PROD (a member removed) → **Revert restored it** (93 members, drift clean) from the approved commit *(revert path since retired 10 Oct 2026)*.
- **Deploy record survives** (read back from the model on a fresh session) and the approvals/deploy state are readable by any IDE pointed at the same server — a fresh install sees the same records.

**Honest limitation:** Revert restores **subsets** (proven) and flags processes/"apply manually" — full process (and dimension/view/rules) restore from the commit is not implemented yet; that stays a surfaced skip, never a silent one.

## The model's tests (two layers, environment-aware)

Every model is built with two kinds of checks, stored in the model
(`Applications/Governance/Tests/assertions.json`), each with a `severity` (`block`/`warn`):

| Layer | Tag | What it proves | Runs where |
|---|---|---|---|
| Known-behaviour | `behaviour` | the calcs produce the expected numbers on the build data | **DEV** (change-set close + risk check) |
| Control | `control` | the model reconciles — invariants hold under **any** data (balance = 0, ties, YTD = sum of periods, cross-cube) | **DEV and PROD** (post-deploy; scheduled runs are a plan, not built) |

- Run history goes to a `}TestResults` control cube per server (newly-failing vs always-failing).
- **DEV** runs `behaviour` + `control`. **PROD** runs `control` only (its data differs, so fixed-number checks are meaningless there).

## Lifecycle — blank server start

1. **Setup** — GitInit DEV to a repo; build the model (house standards: Default view per cube, Default subset per dim; behaviour + control checks built in).
2. **First deploy (blank → blank target)** — gate on DEV (readiness + behaviour + control) → push → **first pull on PROD is a full overwrite** (nothing to lose on blank; readiness first-pull safety analysis confirms) → reconcile the change set's deletes/values → **control checks on PROD** → baseline established.
3. **Second deploy** — change set → gate on DEV → push (one commit, only the change) → **pull plan shows only the change** (baseline exists) → execute → control on PROD → reconcile scoped to the change set's deletes / attribute dims.
4. **Mark PROD read-only last** — a server must be linked and first-pulled **while writable**: `init` and `first-pull` refuse on read-only servers. Mark it read-only only after the first pull (or temporarily remove it from `readOnlyServers`, set it up, then add it back).

## Lifecycle — template start

Same shape, two differences:
- The new server **inherits the template's tests** (behaviour + control) and repo — the control layer comes built in.
- A **populated** target's first pull is where control checks earn their keep: they prove the model holds together on **real data the model has never seen**.

## The deploy sequence (as implemented)

A deploy is `execute()` on the target, and it runs, in order:

1. **Plan** — create the pull plan; check the exact commit is **approved** for the target (non-optional gate; refuses otherwise).
2. **Pull** — apply the approved `dev` commit.
3. **Reconcile (change-set-scoped)** — only what the change set's manifest says: its recorded deletes and the attribute values for the dimensions it touched. A PROD-only object or a PROD-maintained attribute the change set didn't touch survives.
4. **Verify** — control checks on PROD; record to `}TestResults`.
5. **Anchor** — the received commit is recorded (the next drift check compares against it).

**Drift is not a pre-step of every deploy** — it is the Verify step of the wizard and its own standalone check. You run it to decide whether the target is safe to deploy onto and to confirm after.

## The drift loop (over time)

Auto-deploy doesn't keep DEV and PROD converged over months — a **recurring drift check + reconcile cadence** does. The drift diff surfaces DEV-ahead (pending deploy) and out-of-band PROD edits. **Drift pauses deploys**; the fix is to re-apply the change on DEV in a change set and release it (there is no automated Revert/Promote anymore). Each drift is a deliberate decision; the pair converges over time.

## The three gaps (what the IDE keeps)

| Gap | Evidence | How it's handled |
|---|---|---|
| **Attribute values** | don't travel (they're cube data — a value change produced an empty commit) | `tm1project` pre/post-pull task exporting/importing values to a flat file in the repo; or the IDE's value-writer |
| **Deletes** | don't propagate (repo removes, target keeps — zero Delete ops) | reconcile step (repo vs target) or the IDE delete path |
| **Drift** | the pull plan is a commit diff, not live-state — out-of-band PROD change wasn't flagged | drift-through-git (`prod-live` diff) as the IDE's check |

## The readiness check (IMPROVEMENTS 10.2)

A blocker before any push: member-less view titles, stale member references in views/subsets, names TM1 Git won't round-trip, `tm1project` Ignore. The Git push route runs the scan and refuses on blockers; warnings still travel with a successful push. It also runs on demand and cross-server (Model Health). The separate first-pull element-loss analysis is not yet wired into the setup screen.

## What stays where (the "no model data on the IDE" rule)

- **In the model / its repo:** tests, change sets, baselines (retired into git), deploy history, approvals, hooks, lenses, run history.
- **On the IDE only:** connections (`servers.json`), secrets, preferences (`forge.json`), and a **disposable cache** (rebuildable; losing it loses nothing).
- Missing model data must **fail loudly** (the migrated-marker pattern) — never silently start fresh.

## Governance documents in git — **DECIDED 5 Oct: the IDE mirrors them into the repo**

`tm1project Files` does **not** carry Application-managed documents (tested — see `TM1_GIT_EVALUATION.md`), so tests,
change sets, deploy records and Lenses under `Applications/Governance/` don't travel through TM1 Git. **Decision:**
the IDE mirrors the governance documents into the model's repo — on push it commits `Applications/Governance` content
into a `governance/` folder in the same repo (git history and review for tests, and later change sets, deploy records
and Lenses). On deploy, the IDE writes them to the target with a **per-target rule** (e.g. PROD gets health checks
only, never test payloads). **The server stays the runtime truth**; the repo is the history/review layer.

## First-time setup (once per model) — GAP, to build

Before any of this can run, a model has to be linked to GitHub. **Today nothing detects that or explains it** — the
wizard assumes the repo is already set up, so a new user is stuck with no clue, and it's not obvious who should do it.

**Who:** an admin / lead, once per model. They need a GitHub account (a token) and TM1 admin rights.

**What's needed:** when you open a server that isn't linked to a repo, the tool should say so and walk through it:

1. **Choose the GitHub repo** — create one, or paste its address.
2. **Link this server** — say whether it is DEV or PROD (its deployment).
3. **Add a GitHub token** — so the server can read and write the repo.
4. **Defer read-only** — link and run the first pull while the server is still writable, then mark PROD read-only (`init` and `first-pull` refuse on read-only servers).

Link **both** servers to the **same** repo — one as DEV, one as PROD. After that, the normal process works.

**Where it shows:** on opening an unlinked server ("this model isn't backed by GitHub yet — set it up"), and in Model
Health as a readiness flag. Plus a short one-page setup guide.

## Planned — direct PAW edits need a reconcile workflow

Today a direct edit on a model (for example someone changing a cube or process in PAW) is detected by
the drift check and pauses deploys, but the only documented response is to re-apply the change on DEV
in a change set and release it. That is not enough when the PAW edit is legitimate and should be kept,
or when a target must be restored to its approved state.

Add an explicit, object-level **Reconcile** flow (not an automatic reset):

1. **Detect** — use the existing drift check plus transaction-log evidence to show object, user and time.
2. **Snapshot first** — preserve the current target state before changing anything, so the PAW edit is recoverable.
3. **Offer three decisions per object:**
   - **Adopt** — bring the PAW change back into a DEV change set and rebase the target baseline;
   - **Restore** — put the last approved commit/release back;
   - **Acknowledge** — leave the change, recording who accepted the drift and why.
4. **Require approval and audit** for Restore, because it overwrites someone else's work; never auto-revert.
5. **Refresh the anchor** after Adopt/Restore so drift is clean and the next release compares against the new truth.

This turns direct PAW edits from an invisible hazard into a reviewed exception. It is a later deploy-area
round, not part of the current fix brief.

## Out of scope / later phases

- `}TestResults` run history (phase 2), change-set documents in the model (phase 2), deploy history/approvals/hooks into the model (phase 4), migration of existing RIG history (phase 5). Set by the maker; single runs and history read failures are surfaced now.
- The mirror of `Applications/Governance` into the repo (the decided mechanism above) — to implement with the deploy work.
- The first-time GitHub setup flow above (admin, once per model).