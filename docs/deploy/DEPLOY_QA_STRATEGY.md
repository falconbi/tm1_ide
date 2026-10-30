# Deploy and QA strategy — testing a planning model on a nightly Prod clone

**Status:** proposal (25 Oct 2026). For discussion before build.
**Scope:** how a TM1/Planning Analytics model (including new Lenses and new apps
such as Workforce) is tested before it reaches Prod, what blocks a deploy, and where
assertions run.
**Related:** `docs/lenses/LENS_FRAMEWORK_IMPROVEMENT.md`, `docs/models/WORKFORCE_MODEL.md`,
`docs/models/BUILDING_MODELS.md`, `tools/tm1deploy/`,
`core/assertions.js`, `tools/tm1mcp/tools/changeset.js`.

---

## 1. What this is for

A planning tool can usually be offline for a day. It cannot be silently wrong for a
month.

So the purpose of QA here is **not availability** — it is:

- the numbers are still right after a change;
- an upgrade does not corrupt data or break loads;
- the existing model still works when a new app is added;
- there is a clean rollback;
- someone can prove all three before the business sees it.

Downtime tolerance is an advantage: it gives a real maintenance window for snapshots,
restores and QA deploys.

---

## 2. Today

- There is **no separate QA environment**. Changes are tested on the same DEV server,
  using whatever state it happens to be in.
- Assertions are stored on the source server and run against the deploy target, but
  they are **advisory** — they do not block a deploy or a baseline.
- A metadata-only Prod has **no data**, so data assertions either fail or pass
  vacuously ("no over-filled seats = 0" because there are no seats).
- The deploy package carries **metadata, not cells**. A new app arrives empty.
- Tests and live scripts share the same runner: `npm test` once executed live
  integration scripts that deleted a model employee (E10003) and created a phantom
  employee. That is now fixed, but it shows the failure mode: test tooling with write
  access and no separation.
- There is no routine model regression: “did the existing numbers move?” is answered
  by comparing against a stored cost/headcount baseline, not by a QA gate.

---

## 3. Target model

### 3.1 Environments

| Environment | Purpose | Data |
|---|---|---|
| **DEV** | build, fix, author Lenses, run logic tests | working data, may be reset |
| **QA (nightly Prod clone)** | deploy rehearsal, regression, coexistence, first-load proof | a clean copy of Prod, disposable |
| **PROD** | live planning | real |

All apps share one TM1 server (licence reality); a new app is new cubes/dimensions/
processes inside that server, not a new server.

### 3.2 The QA clone

- Taken **nightly** from Prod, restored **clean** before use.
- Never reused for two deploys without a reset — test residue makes the next run lie.
- Test data may be loaded **into the clone only** (for a new app or a first-load test).
- Treated as disposable: after the test, it is thrown away.
- PII: masked or subset if required; access restricted.

### 3.3 The rule

**No deploy to Prod without a QA pass on a clean clone, using the same package.**

The clone is the gate, not a nice-to-have.

### 3.4 UAT and QA are different

- **UAT (DEV):** business sign-off that the flow and outcomes are right, on DEV data.
- **QA (clone):** deploy fidelity — the same package against a clean copy of Prod's
  data, plus coexistence, regression, first-load counts and a rollback point.

Neither replaces the other. Strong UAT lets the QA gate stay lean (structure, invariants,
regression, loads) rather than a second UAT. A green QA run does not replace business
sign-off either.

---

## 4. What is tested, and where

Assertions and tests are tagged by **scope**, so each runs where it is meaningful.

| Scope | What it proves | Expected value from | Runs on |
|---|---|---|---|
| **Structure** | objects exist, dimensions/cubes match, rules compile, processes/views/services exist, Lens services/versions compatible | none | clone, Prod |
| **Invariant** | totals tie, no negative, end ≥ start, no duplicate, no over-filled seat, no assignment on a closed position, referential integrity | none — must always hold | any data |
| **DEV behaviour** | the logic produces the approved numbers | DEV known-good | DEV |
| **Fixture** | a specific calculation on a fixed dataset | a small frozen fixture | wherever the fixture is loaded |
| **Clone regression** | the change did not move existing numbers unexpectedly | the clone's own pre-deploy state | the clone, before/after deploy |
| **Prod DQ** | real data is complete, consistent, reconciled | data-quality rules | Prod, after load |

Rules:

- **Do not run DEV's absolute numbers on a Prod clone.** Different data.
- **Do not let deploy generate expected values** from the target. That blesses whatever
  the model returns.
- **Controls/invariants may pass vacuously on empty data.** Never treat that as proof;
  structure checks and a fixture are needed for a new app.
- Assertion definitions **travel with the release**; they are not read from a live
  server that may be older than the code under test.

---

## 5. The deploy pipeline

```
Prod ──nightly──▶ QA clone (clean)
                     │
       1. capture regression baseline (key totals/queries)
                     │
       2. deploy the release package
                     │
       3. structure + invariants + contract tests
       4. clone regression (before vs after)
       5. fixture / service / first-load tests
       6. UI smoke (Lens app, headless)
                     │
              pass ──┴──▶ deploy the SAME package to Prod
                     │
       7. Prod: structure + smoke
       8. after load: Prod DQ / invariants
```

### 5.1 Regression baseline

On the fresh clone, before deploying, capture:

- the cost/headcount control totals and the existing assertion queries;
- row counts and checksums for key extracts;
- the existing Lens service outputs (if services exist).

After deploying, compare. Expected = the **before** state on the same data. Differences
must be explained by the release; anything else is a failure.

### 5.2 First deploy of a new app (e.g. Workforce)

The clone has Prod's data but **no WFP data**. On the clone:

1. Deploy the WFP package (metadata only).
2. Run **structure**: cubes, dimensions, rules compile, processes, views, Lens
   services, security groups.
3. Run **coexistence**: existing Prod regression still passes; no name collisions,
   no chores changed, no performance regression.
4. **Load a test dataset into the WFP cubes** (seed + a real or recent HR extract).
5. Run:
   - fixture/behaviour assertions for WFP on that loaded data;
   - the real load process, checking counts and control totals;
   - Lens service/contract tests;
   - UI smoke.
6. Pass → deploy to Prod and run the first real load there (counts/ties verified).

### 5.3 Later deploys

The clone includes the app **and its data**, so the full pattern applies:
structure + invariants + regression + package assertions + service tests. Absolute
expected values are recorded from the clone snapshot, or kept on DEV/fixture.

### 5.4 What blocks a deploy

| Check | Blocks? |
|---|---|
| Package completeness / risk check | **yes** (already) |
| Structure preflight | **yes** |
| Invariants on the clone | **yes** |
| Clone regression with unexplained differences | **yes** |
| Service/contract tests for deployed Lenses | **yes** |
| DEV behaviour assertions | no (they ran in DEV) |
| Fixture assertions | yes where the fixture is loaded |
| Prod DQ | no — it runs after load and alerts |

This is a policy change: today even block-severity assertions are advisory.

---

## 6. Rollback

- **Before** deploying to Prod: snapshot the target (or rely on the nightly backup).
- **After** a failed Prod load or smoke test: restore the snapshot; do not repair live.
- **Drill it** on the clone: restore from the snapshot and prove the model opens,
  totals match, and users can sign in. A rollback that has never been tested is a plan,
  not a capability.
- Keep the package and the baseline so the same release can be redeployed.

---

## 7. Ownership and ritual

QA fails when nobody owns it. Minimum:

- **One owner** for QA: refresh, test runs, triage, keeping tests alive.
- **Scheduled refresh** of the clone (nightly) and a reset before each deploy.
- **A release checklist**: package built, QA pass attached, rollback point recorded,
  deploy window agreed.
- **Test health**: a failing test is fixed or deleted with a recorded reason; expected
  values never change silently.
- **No QA pass, no deploy** — the same way no change set closes without a diff review.

---

## 8. Tooling

- **Extend the existing pipeline** (`tools/tm1deploy`) rather than build a second one:
  package, baseline, diff, risk, deploy.
- **Assertions** stay in the model and travel with the release; add scope tags.
- **Regression capture** can be a small script over key cubes/queries (the existing
  `compare-consol.js` pattern), stored with the release.
- **Lens service tests** live with the service catalog
  (`docs/lenses/LENS_FRAMEWORK_IMPROVEMENT.md`).
- **Commercial tools**: Arc (tests inside TM1) and Pulse (backup, migration/compare,
  scheduling, monitoring) can replace parts of the custom ops layer. They do not define
  business assertions or Lens contracts. Verify current feature names before relying on
  them.
- **Do not** let live integration scripts run from the unit-test runner. Live scripts
  are `live-*.js` and require `LIVE=1`.

---

## 9. What this is not

- Not a promise of zero downtime — downtime is acceptable; wrong numbers are not.
- Not “run Prod's assertions on an empty target”.
- Not auto-generating expected values at deploy.
- Not a reason to skip DEV logic tests; QA proves the deploy, DEV proves the logic.
- Not a replacement for UAT. QA proves the package works on Prod-like data; UAT proves
the business accepts it.
- Not a separate TM1 server per app (licence); it is a clone/QA database on the shared
  server plus a fixture for new apps.

---

## 10. Phasing

1. **QA clone + structural preflight + regression baseline.** No policy change yet;
   prove the clone and the compare.
2. **Make structure, invariants and regression block a deploy.** Keep data assertions
   advisory on Prod.
3. **New-app path**: fixture load into the clone, first-load proof, coexistence.
4. **Lens service/contract tests** once the service catalog exists.
5. **Prod DQ suite** after load, scheduled, with alerts.
6. **Rollback drill** on the clone.

---

## 11. Open decisions

1. **Clone cadence and retention**: nightly only, or keep N days of clones?
2. **PII**: mask, subset, or restrict access and accept the copy?
3. **Expected values for regression**: store a compact snapshot (totals + hashes) or
   full query outputs?
4. **Blocking policy**: which assertion scopes may block; who can override and how is
   it recorded?
5. **Where the QA ownership sits**: platform/admin, model developer, or shared rota?
6. **Commercial tooling**: is Pulse/Arc already licensed? If not, is the custom path
   cheaper than the licence?

---

## 12. The one-line version

**Clone Prod nightly, deploy to the clone first, prove the logic on a fixture and the
deploy on the clone's real data, then promote the same package to Prod — and only treat
a green run as proof if it had data to check.**
