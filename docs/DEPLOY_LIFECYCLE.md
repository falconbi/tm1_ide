# Deploy lifecycle — model-owned, TM1 Git transport (design record, 5 Oct 2026)

Plain-English record of the agreed end-to-end deployment model. Source decisions:
`docs/TM1_GIT_EVALUATION.md`, `docs/IMPROVEMENTS.md` 10.1 (hybrid) + 10.2 (readiness).

## The architecture in one line

**TM1's own Git integration moves and versions the model; the IDE governs it and handles the three things TM1 Git can't (attribute values, deletes, drift). The model owns all of its data — the IDE stores none of it.**

| Layer | Owns | Where it lives |
|---|---|---|
| The model | objects, tests, change sets, run history, lenses | the TM1 server + its git repo |
| TM1 Git | structure + history + the deploy + the drift check | the model's repo (customer-owned, IBM format) |
| The IDE | governance (change sets, risk, approval, readiness, Model Health) + the three gaps | no model data — connections, secrets, preferences, cache only |

## Proven end to end (5 Oct 2026)

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

## The model's tests (two layers, environment-aware)

Every model is built with two kinds of checks, stored in the model
(`Applications/Governance/Tests/assertions.json`), each with a `severity` (`block`/`warn`):

| Layer | Tag | What it proves | Runs where |
|---|---|---|---|
| Known-behaviour | `behaviour` | the calcs produce the expected numbers on the build data | **DEV** (change-set close + risk check) |
| Control | `control` | the model reconciles — invariants hold under **any** data (balance = 0, ties, YTD = sum of periods, cross-cube) | **DEV and PROD** (post-deploy + on a schedule) |

- Run history goes to a `}TestResults` control cube per server (newly-failing vs always-failing).
- **DEV** runs `behaviour` + `control`. **PROD** runs `control` only (its data differs, so fixed-number checks are meaningless there).

## Lifecycle — blank server start

1. **Setup** — GitInit DEV to a repo; build the model (house standards: Default view per cube, Default subset per dim; behaviour + control checks built in).
2. **First deploy (blank → blank target)** — gate on DEV (readiness + behaviour + control) → push → **first pull on PROD is a full overwrite** (nothing to lose on blank; the readiness first-pull safety analysis confirms) → PostPull tasks → **control checks on PROD** → baseline established.
3. **Second deploy** — change set → gate on DEV → push (one commit, only the change) → **pull plan shows only the change** (baseline exists) → execute → control on PROD → reconcile deletes / attribute values if in the change set.

## Lifecycle — template start

Same shape, two differences:
- The new server **inherits the template's tests** (behaviour + control) and repo — the control layer comes built in.
- A **populated** target's first pull is where control checks earn their keep: they prove the model holds together on **real data the model has never seen**.

## The deploy sequence (the push-then-pull)

At every deploy, in order:

1. **Drift-push (the check)** — PROD pushes its live state to `prod-live`; `git diff <PROD deployed commit>..prod-live` = what's drifted on PROD (out-of-band edits, PROD-only objects).
2. **Decide** — if PROD is clean, proceed. If drifted, **reconcile first** (promote `prod-live` → DEV, or revert the drifted object) — never deploy onto a drifted PROD.
3. **Deploy-pull (the action)** — PROD pulls the approved `dev` state and applies it.
4. **Verify** — control checks on PROD; record to `}TestResults`.
5. **New anchor** — PROD's deployed commit advances, so the next drift check compares against the fresh baseline.

## The drift loop (over time)

Auto-deploy doesn't keep DEV and PROD converged over months — a **recurring drift check + reconcile cadence** does. The drift diff surfaces DEV-ahead (pending deploy), PROD-only objects (promote or remove), and out-of-band PROD edits (reapply to DEV or revert). Each is a deliberate decision; the pair converges over time.

## The three gaps (what the IDE keeps)

| Gap | Evidence | How it's handled |
|---|---|---|
| **Attribute values** | don't travel (they're cube data — a value change produced an empty commit) | `tm1project` pre/post-pull task exporting/importing values to a flat file in the repo; or the IDE's value-writer |
| **Deletes** | don't propagate (repo removes, target keeps — zero Delete ops) | reconcile step (repo vs target) or the IDE delete path |
| **Drift** | the pull plan is a commit diff, not live-state — out-of-band PROD change wasn't flagged | drift-through-git (`prod-live` diff) as the IDE's check |

## The readiness check (IMPROVEMENTS 10.2)

A blocker before any push: member-less view titles, stale member references in views/subsets, names TM1 Git won't round-trip, `tm1project` Ignore — plus the first-pull safety analysis on a populated target. Runs in the deploy risk check, on demand, and cross-server (Model Health).

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

## Out of scope / later phases

- `}TestResults` run history (phase 2), change-set documents in the model (phase 2), deploy history/approvals/hooks into the model (phase 4), migration of existing RIG history (phase 5).
- The mirror of `Applications/Governance` into the repo (the decided mechanism above) — to implement with the deploy work.