# TM1 IDE — Deployment Architecture

## Core Philosophy

**The Dev server is the model during development. YAML is the model at deployment time.**

TM1's strength is live, interactive, testable development. Forcing a YAML-first workflow
fights that strength. Instead the IDE works directly against the Dev server as normal —
and crystallises the model to YAML only when a package is ready to promote to Test or Prod.

---

## Development Workflow

```
1. Refresh baseline  →  seed Dev from Prod copy + git tag
2. Start session     →  named work context in IDE ("apportionment-v1")
3. Build freely      →  work directly on Dev server, no tagging, no friction
   IDE logs every save → change log entry tagged to session
4. Package           →  when ready, generate YAML + manifest from log + targeted diff
5. Pre-deploy check  →  risk report against Test server (targeted scope only)
6. Deploy to Test    →  apply package, git tag updated
7. Deploy to Prod    →  same package, same check, same apply
```

---

## Why the Change Log — Design Reasoning

Three approaches were considered for scoping what a package contains:

**Option 1 — Naming convention / prefix scan**
Scan the Dev server for objects matching a prefix (`APR_`, `FIN_` etc.) and treat those
as the package. Simple, but fundamentally broken — it misses every modification made to
a shared object. Adding an attribute to the `Entity` dimension, adding a subset, adding a
view to an existing cube — none of these carry the module prefix. A prefix scan would
silently exclude them and the deployment would be incomplete.

**Option 2 — Manual tagging as you go**
Developer explicitly tags each object to a module during development. Reliable but adds
friction to every single action. In practice developers skip it, especially under time
pressure, and the tags fall out of sync with reality.

**Option 3 — Change log (chosen)**
The IDE already processes every save through server routes. The log intercepts what was
already happening and writes it down — before-state, after-state, session context. Zero
additional friction for the developer. At package time the log defines the scope exactly:
every object touched during the session, regardless of naming, regardless of whether it
was a new object or a modification to a shared one.

The session concept is what makes the log useful rather than just noise. Without sessions
the log is a raw event stream with no meaningful grouping. With sessions each unit of work
has a name, a scope, and a clear boundary — a coherent story of what was built and why.

The log also turned out to solve several other problems for free: micro-level version
control with before/after state at every save, surgical rollback without touching git,
cross-developer conflict detection, and a complete audit trail of every change made to
every object across the entire development history.

---

## The Change Log

Every save action in the IDE writes a structured log entry. This is the backbone of the
entire deployment system.

```json
{
  "timestamp": "2026-05-24T09:18:00Z",
  "user": "jdlove",
  "server": "dev",
  "session": "apportionment-v1",
  "action": "RULES_SAVED",
  "object": { "type": "rules", "cube": "APR_Allocation" }
}
```

```json
{
  "timestamp": "2026-05-24T09:22:00Z",
  "user": "jdlove",
  "server": "dev",
  "session": "apportionment-v1",
  "action": "ATTRIBUTE_CREATED",
  "object": {
    "type": "attribute",
    "dimension": "Entity",
    "attribute": "APR_DriverGroup",
    "datatype": "String"
  }
}
```

**Storage:** SQLite database alongside `server.js` — queryable, fast, no external dependency.

**What the log enables:**

| Capability | How |
|---|---|
| Package scope | Log defines exactly which objects to check |
| Targeted diff | Check only logged objects, not full server scan |
| Audit trail | Who changed what, when, which session |
| Impact analysis | What packages touched a given object |
| Conflict detection | Two sessions that touched the same object |
| Rollback | Log recorded before-state — restore exactly those objects |

---

## Targeted Diff — The Key Insight

Instead of comparing full server state (expensive, noisy), the diff is scoped to only
the objects the session log touched.

```
Change Log  →  defines SCOPE    (which objects to check)
Targeted Diff →  verifies REALITY (what is actually on the server now)
```

```
tm1deploy diff --session apportionment-v1 --server dev
```

Three outcomes per object:

**Match** — log and server agree → goes straight into the package manifest.

**Drift** — server has more than the log recorded:
```
⚠ Entity / APR_DriverGroup
  Log: attribute created
  Server: 847 values populated (not via IDE)
  → include attribute values in package? Y/N
```

**Missing** — log says it happened, server disagrees:
```
✖ APR_AllocationEntities subset — logged as CREATED, not found on server
  → was it deleted? renamed? resolve before packaging.
```

---

## The Baseline

The baseline is a separate JSON snapshot store — **not** in the main git repository.
It is used only for comparison, not for version history.

```
.tm1baseline/
  snapshot.json    ← compact, not pretty-printed, replace-on-seed
```

The baseline is refreshed from Prod at the start of each project:

```
tm1deploy seed --server prod
git tag baseline-from-prod-2026-05-24
```

After every successful deployment to Test or Prod:
```
git tag test-deployed --force
git tag prod-deployed --force
git tag test-deployed-2026-05-24   # dated archive
```

The baseline is intentionally NOT tracked with full git history. It is a reference point,
not a version-controlled artifact. Keeping it separate prevents large Prod snapshots from
bloating the packages repository.

---

## TM1 Metadata in Control Cubes

TM1 stores metadata in two places — both must be captured in packages:

**REST API endpoints** — object structure:
- Dimension elements, hierarchy, consolidations
- Attribute definitions (name, type)
- Cube dimension list
- Process code + parameters + variables + datasource
- View definitions
- Subset definitions (MDX or static element list)

**Control cubes** — populated values:
- `}ElementAttributes_DimensionName` — attribute values per element
- `}ElementAnnotations_DimensionName` — element notes
- `}CellAnnotations_CubeName` — cell-level comments

The package only captures **columns introduced by the session** — not the full control cube.

```yaml
# modifications/Entity.APR_DriverGroup.yaml
object: Entity
type: attribute
name: APR_DriverGroup
datatype: String

values:
  Europe:       Direct
  Americas:     Indirect
  Asia-Pacific: Direct
  Corporate:    Overhead
  # blank values omitted — missing entry = leave as blank on target
```

---

## Package Structure

```
packages/
  core/
    tm1package.yaml
    dimensions/
      Period.yaml
      Entity.yaml
      Currency.yaml

  apportionment/
    tm1package.yaml
    dimensions/
      APR_CostPool.yaml
      APR_Driver.yaml
    cubes/
      APR_Allocation.yaml
      APR_Allocation/
        rules/
          APR_Allocation.rules
        views/
          AllocationByEntity.yaml
    processes/
      APR_LoadDrivers.yaml
      APR_RunAllocation.yaml
    modifications/
      Entity.APR_DriverGroup.yaml       ← attribute added to shared dimension
      Entity.APR_AllocationEntities.yaml ← subset added to shared dimension
      FIN_Budget.APR_AllocationView.yaml ← view added to existing cube
```

---

## Package Manifest — `tm1package.yaml`

```yaml
name: apportionment
version: 1.0.0
description: Cost apportionment module
author: jdlove
session: apportionment-v1

dependencies:
  core: ">=1.0.0"    # Period, Entity must exist on target before deploying this

# Objects fully owned by this package — create or replace on deploy
owns:
  dimensions:
    - APR_CostPool
    - APR_Driver
  cubes:
    - APR_Allocation
  processes:
    - APR_LoadDrivers
    - APR_RunAllocation

# Changes to objects owned by other packages
modifies:
  - object: Entity
    type: attribute
    name: APR_DriverGroup
    file: modifications/Entity.APR_DriverGroup.yaml

  - object: Entity
    type: subset
    name: APR_AllocationEntities
    file: dimensions/Entity/subsets/APR_AllocationEntities.yaml

  - object: FIN_Budget
    type: view
    name: APR_AllocationView
    file: modifications/FIN_Budget.APR_AllocationView.yaml

deploy_order:
  - dimensions
  - cubes
  - rules
  - subsets
  - views
  - processes
```

---

## Pre-Deploy Risk Report

Before any deployment the tool compares the package against the target server —
scoped to package objects only, not a full server scan.

```
PRE-DEPLOY CHECK  apportionment-v1  →  Test  (2026-05-24)
══════════════════════════════════════════════════════════

BLOCKED (1)  — will not deploy, manual action required
──────────────────────────────────────────────────────
✖ APR_Allocation  cube — dimension list differs from package definition
  Server has 5 dimensions, package defines 6
  Cannot change cube dimensions without data loss — resolve manually

RISKY (2)  — requires --include-risky flag
──────────────────────────────────────────
⚠ Entity / APR_DriverGroup  [attribute values]
  147 elements have different values on Test vs package
  23 elements in package not on Test

⚠ Entity  [element list]
  3 elements removed since last deployment
  → may affect APR_Allocation cube data

SAFE (12)  — will deploy automatically
────────────────────────────────────────
✔ APR_CostPool      dimension  (new)
✔ APR_Driver        dimension  (new)
✔ APR_Allocation    cube       (new — post BLOCKED resolution)
✔ APR_LoadDrivers   process    (new)
✔ APR_RunAllocation process    (new)
✔ Entity / APR_AllocationEntities  subset  (new)
✔ FIN_Budget / APR_AllocationView  view    (new)
  ...

Run with --apply to deploy SAFE items
Run with --apply --include-risky to also apply RISKY items
BLOCKED items require manual resolution before any deploy
```

---

## Deployment Order — Always

Dependencies must be applied in this sequence regardless of package:

```
1. Dimensions       (cubes depend on them)
2. Cubes            (views and rules depend on them)
3. Rules            (per cube)
4. Attribute values (control cube data)
5. Subsets          (depend on dimensions existing)
6. Views            (depend on cubes + subsets)
7. TI Processes     (may reference all of the above)
8. Chores           (depend on processes)
```

---

## Deployment CLI

```bash
# Seed baseline from Prod
tm1deploy seed --server prod

# Start a named development session
tm1deploy session start "apportionment-v1"

# View change log for current session
tm1deploy log --session apportionment-v1

# Targeted diff — verify session changes against Dev server
tm1deploy diff --session apportionment-v1 --server dev

# Generate package YAML from verified diff
tm1deploy package --session apportionment-v1

# Pre-deploy risk report against Test
tm1deploy check --package apportionment --target test

# Deploy SAFE items to Test
tm1deploy apply --package apportionment --target test

# Deploy SAFE + RISKY items to Test (after reviewing report)
tm1deploy apply --package apportionment --target test --include-risky

# History for a specific object across all sessions
tm1deploy history --object Entity

# Impact analysis before touching a shared object
tm1deploy impact --object Entity
```

---

## What Git Holds

Git holds **only the packages** — not the full server snapshot, not the baseline.

```
packages/
  core/           ← shared infrastructure (Period, Entity, Currency)
  finance/        ← FIN_* objects
  apportionment/  ← APR_* objects + modifications to shared objects
  hr/             ← HR_* objects

.tm1baseline/     ← in .gitignore — baseline snapshot, not version controlled
```

Every commit in the packages repository is meaningful project work.
The baseline is a disposable reference store, refreshed from Prod at project start.

---

## Server Architecture

Single TM1 server per environment — not one server per module:

```
tm1-dev.company.com    ← all modules, all developers, free to build
tm1-test.company.com   ← deployed via packages, controlled
tm1-prod.company.com   ← deployed via packages, gated by pre-deploy check
```

Module separation is a **naming convention and package boundary**, not a server boundary.
Objects are prefixed by module (`APR_`, `FIN_`, `HR_`). Shared dimensions (`Period`,
`Entity`, `Currency`) live in the `core` package and are owned once.

Cross-module `DB()` references, shared chores, and shared dimensions all work naturally
because everything is on the same server.

---

## Tool Implementation

Node.js — same runtime as the IDE server, same REST patterns already established.

```
tools/
  tm1deploy/
    bin/
      tm1deploy.js     ← CLI entry point
    src/
      client.js        ← thin TM1 REST wrapper (reads + writes only what deployer needs)
      snapshot.js      ← read server state into memory
      diff.js          ← compare snapshot to package or to another snapshot
      report.js        ← format pre-deploy risk report
      packager.js      ← generate tm1package.yaml from session log + verified diff
      deployer.js      ← apply a package to a target server
      log.js           ← read/write SQLite change log
    config/
      servers.yaml     ← connection configs per environment
    package.json
```

The same diff and report logic is exposed as IDE server routes — the IDE can show the
targeted diff and pre-deploy report inline without leaving the browser.
