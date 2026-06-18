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

### Re-seeding During Development

Re-seeding at any point during development is safe and recommended. The session log is
completely independent of the baseline — re-seeding replaces `snapshot.json` but never
touches the log.

**Recommended pattern:**

```
1. Seed from Prod at project start        → establishes reference point
2. Develop freely                         → session log captures everything
3. Re-seed from Prod immediately before packaging → baseline now reflects current Prod state
4. Run diff                               → accurate against what is actually on Prod today
5. Package and deploy
```

Re-seeding before deploy is particularly valuable when other changes have been deployed to
Prod during your development window (hotfixes, other teams' packages). The updated baseline
gives you an accurate diff and avoids packaging changes that are already on Prod.

**Effect on diff outcomes after a re-seed:**

| Situation | Diff outcome |
| --- | --- |
| Your Dev version matches the new Prod baseline | UNCHANGED — already on Prod, nothing to package |
| Your Dev version differs from the new Prod baseline | MATCH — goes in package as normal |

DRIFT is not caused by re-seeding. DRIFT means the Dev server was modified outside the IDE
after the session log recorded a save — it is always about Dev server state vs the last IDE
save, never about Prod or the baseline.

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

---

## Test Data Seeding

The package system deploys **model only** — structure, rules, processes, views. Test data
is seeded separately using TI processes built as part of each module.

### Two types of seed data

**Attribute data** — element attribute values in `}ElementAttributes_*` control cubes:

- TI process using `AttrPutS` / `AttrPutN` to write known attribute values per element
- Example: set `APR_DriverGroup` values for all Entity elements

**Cube data** — cell values in regular cubes:

- TI process that reads a CSV file and loads values using `CellPutN` / `CellPutS`
- Example: load test budget amounts into `APR_Allocation`

### Seed package structure

Seed processes live in a dedicated seed package per module, deployed to Dev and Test only:

```
packages/
  apportionment/          ← model package (all environments)
  apportionment-seed/     ← data seed package (dev + test only)
    tm1package.yaml
    processes/
      APR_Seed_Attributes.yaml   ← loads attribute values via AttrPutS/AttrPutN
      APR_Seed_CubeData.yaml     ← loads cube values from CSV
    data/
      APR_Seed_CubeData.csv      ← test data file
```

The `tm1package.yaml` for seed packages carries an environment restriction:

```yaml
name: apportionment-seed
environments: [dev, test]    # never deploy to prod
deploy_after: [apportionment] # model must exist before seeding
```

### Seed execution order

Attributes must be seeded before cube data (cube processes may depend on attribute values):

```
1. APR_Seed_Attributes    ← AttrPutS/AttrPutN for all relevant dimensions
2. APR_Seed_CubeData      ← CellPutN/CellPutS from CSV
```

A seed chore chains all seed processes in the correct order and can be run on demand
from the IDE.

### CSV file placement

Seed CSV files need to be present on the server's Files directory before the TI processes
run. On Dev and Test, place them manually or via the IDE Files panel (PA v12+). The CSV
files are version-controlled in Git alongside the seed package — the deployer copies them
to the server's Files directory as part of `tm1deploy apply`.

### CLI

```bash
# Deploy seed package to Test (model package must already be deployed)
tm1deploy apply --package apportionment-seed --target test

# Run seed chore via IDE or:
tm1deploy seed-run --package apportionment-seed --target test
```

---

## Deployment Scenarios

Working through each object type to define exactly what the packager must capture and what the deployer must apply. These scenarios inform the `owns` / `modifies` split and the risk checker dependency rules.

---

### Dimension Changes

#### owns vs modifies

| Situation | Diff outcome | Classification |
|---|---|---|
| New dimension created this session | `NEW` | `owns` — deploy wholesale |
| Elements added to existing dimension | `MATCH` | `modifies` — apply delta only |

For `modifies`, the deployer must **add** elements — never replace the whole dimension. Replacing would delete data in cubes that use that dimension.

---

#### Elements Added to an Existing Dimension

The diff captures element count delta (e.g. `+3 elements from baseline`). The packager must identify the specific new elements by comparing current server state against the baseline element list per hierarchy.

**What the package must carry (per hierarchy):**

```yaml
modifies:
  dimension: Entity
  hierarchies:
    - name: Entity
      elements_added:
        - { name: LatAm_New,       type: Leaf }
        - { name: Americas_Region, type: Consolidated }
      edges_added:
        - { parent: Americas, child: LatAm_New }
        - { parent: Americas, child: Americas_Region }
    - name: Region
      edges_added:
        - { parent: Americas, child: LatAm_New }
```

**Element deletions** — treated as BLOCKER in the risk checker if the element has data in any cube on the target. TM1 will reject the delete; must be resolved manually.

---

#### Element Formats

Stored in the `}ElementFormats_{Dim}` control cube — per-element format strings (e.g. `#,##0.0`).

**Current gap:** the snapshot's `fetchAttributeValues` reads `}ElementAttributes_{dim}` only. `}ElementFormats_{dim}` is a separate control cube and is not currently read by the snapshot, not included in the diff, and not packaged.

**What needs to be added:**

- **Snapshot** — second pass per dimension to read `}ElementFormats_{dim}` and store format strings per element alongside attribute values
- **Diff** — compare current format strings against baseline per element; flag changed elements as MATCH and include the delta
- **Package** — deploy as cell writes to `}ElementFormats_{dim}` on the target, scoped to elements that changed
- **No external dependencies** — self-contained, no risk checker validation needed

---

#### Picklist Attributes

The Picklist attribute is a string-type attribute on the dimension (typically on measures dimensions). Its value defines the valid value list for that element when entering data. Stored in `}ElementAttributes_{Dim}`.

Already captured in `snapshot.json` via `fetchAttributeValues`. Packaged as attribute value writes.

**Format strings:**

| Type | Format | Example |
|---|---|---|
| Static | `static:Val1:Val2:Val3` | `static:Yes:No:Maybe` — use `::` for blank option at start |
| Dimension | `dimension:DimName` | `dimension:Department` — all elements |
| Subset | `subset:DimName:SubsetName` | `subset:Department:Base` |
| Hierarchy-aware (PA 2.0+) | `dimension:DimName:HierarchyName` | `dimension:Department:Sales` |
| Hierarchy + subset (PA 2.0+) | `subset:DimName:HierarchyName:SubsetName` | `subset:Department:Sales:Base` |

Use `\` to escape colons in complex hierarchy names.

**Risk checker dependencies per type:**

| Type | Dependency to assert on target |
|---|---|
| Static | None |
| Dimension | Referenced dimension must exist |
| Subset | Referenced dimension + named public subset must exist |
| Hierarchy-aware | Referenced dimension + hierarchy must exist |
| Hierarchy + subset | Referenced dimension + hierarchy + subset must exist |

The risk checker parses the picklist string (split on `:`, first token is the type) to extract and validate dependencies.

---

#### Picklist Cubes

When a picklist needs dynamic or conditional logic, a control cube is created via right-click → **Create Pick List Cube** in Architect / PAW.

**Naming convention:** `}Picklist_<OriginalCubeName>` (case-insensitive prefix — TM1 may show as `}PickList_`)

**Structure:**

- Same dimensions as the original cube
- One additional dimension: `}Picklist` — a shared control dimension containing a single consolidated element that holds picklist definitions
- Rules on this cube return picklist format strings (same `static:`, `dimension:`, `subset:` syntax) per cell combination — enabling cascading / conditional picklists

**What is and is not deployed:**

| Object | Deployed | Notes |
|---|---|---|
| `}Picklist_<CubeName>` cube structure | Yes | Travels with its parent cube |
| Rules on `}Picklist_<CubeName>` | Yes | Core model — defines valid values |
| `}Picklist` dimension | Dependency only | Shared across all picklist cubes; assert it exists on target, do not create |

**Package treatment:** the picklist cube is not a separate manifest entry — it is bundled with its parent cube:

```yaml
owns:
  cubes:
    - Budget          # includes }Picklist_Budget automatically
```

**Identification in snapshot:** any cube matching `}Picklist_*` (case-insensitive). Parent cube name = suffix after `}Picklist_`. The snapshot must make a second pass outside `ModelCubes()` to capture these.

**Risk checker:** verify `}Picklist` dimension exists on target before deploying any picklist cube.

**IDE gap (current):** the rules editor only surfaces `ModelCubes()`. Picklist cube rules edited outside the IDE (in Architect) show as DRIFT. Surfacing `}Picklist_*` cubes in the Explorer tree under their parent cube is the long-term fix.

---

#### Deleting an Element from a Dimension

**Classification:** always `modifies` — changing an existing dimension.

**Core principle for the risk checker:**

By the time a session is packaged, the developer has already done the cleanup work in Dev — fixed the rules, updated the TI, removed the element from subsets. All of that is in the session log and therefore in the package.

The risk checker's job is **not** to re-validate Dev work. It checks the **target server** for references to the deleted element that the package does not cover:

```
For each reference to DeletedElement found on the target:
  → Is the referencing object also in this package?
      YES → covered, no flag
      NO  → flag it — gap between package scope and target state
```

**Why the target may have uncovered references:**

- A process exists on Test/Prod that was never in Dev (deployed separately or created directly)
- Rules on Test/Prod were patched outside the IDE, outside a session
- A cube on Test/Prod uses the dimension but doesn't exist in Dev

---

**Hard constraint — element with data:**

TM1 will reject deletion of any element that has non-blank/non-zero values in a cube on the target. This is a BLOCKER that cannot be resolved by the package — it requires manual action on the target before deployment can proceed.

The risk checker queries all cubes that use the dimension on the target and checks for data presence for the element.

---

**What the risk checker scans on the target:**

| What | Scope | How | Risk if not in package |
| --- | --- | --- | --- |
| Data in cubes | All cubes using the dimension | Cell value query per cube | BLOCKER — manual cleanup required |
| TI processes — creates element | All processes | Text scan for `DimensionElementInsert` + element name | BLOCKER — element will be recreated next run |
| TI processes — reads/writes element | All processes | String literal scan for element name | WARNING |
| Rules — references element | Cubes using the dimension only | String literal scan on rules text | WARNING |
| Static subsets — contains element | All subsets on dimension | Element membership check | INFO — TM1 auto-removes on delete |

Text scan for TI and rules classifies each hit by statement type (DimensionElementInsert → BLOCKER, CellPutN/CellGetN → WARNING, comment line → ignore).

---

---

**IDE Pre-Delete Check (Dev — at delete time):**

Before the IDE deletes an element, it must run the same checks scoped to the **Dev server**. The developer gets an immediate warning and can cancel or proceed. This catches problems early — at the point of intent — rather than at package time hours or days later.

The IDE shows a confirmation dialog with findings:

```
Delete element OldRegion from Entity?

WILL BLOCK (resolve before deleting)
  ✖ OldRegion has data in Budget — 14 cells have values
  ✖ DimensionMaintenance (Prolog line 14) creates this element

WILL BREAK (fix after deleting)
  ⚠ Budget rules reference OldRegion (line 23)
  ⚠ LoadFromERP (Data line 47) writes to OldRegion

WILL BE CLEANED UP AUTOMATICALLY
  ✓ 2 subsets contain OldRegion — TM1 will remove it

  [ Cancel ]   [ Delete Anyway ]
```

The developer cannot accidentally delete something that has data. Processes that create the element are flagged as blockers — the developer knows they must update those processes as part of the same body of work (same session), which means the fixes will be in the session log and therefore in the deployment package.

**Implementation:** the IDE's `DimensionEditor` delete action calls a pre-delete check route before issuing the REST delete. Same scan logic as the deploy risk checker but scoped to Dev.

---

**Deploy sequence (once no blockers):**

```
1. Apply subset updates that include changes beyond just removing the deleted element
2. Remove consolidation edges for the deleted element
3. Delete the element
   → TM1 auto-removes element from any remaining static subsets
```

Subset cleanup of purely the deleted element is handled by TM1 automatically — no need to package a subset update unless the subset has other changes.

---

**Blocker report format:**

```
BLOCKER — MANUAL REQUIRED BEFORE DEPLOYMENT
─────────────────────────────────────────────────────────────
✖ OldRegion has data in Budget on target
  → Zero out or archive Budget[OldRegion,...] data before deploying
  → Cannot automate — resolve manually then re-run risk check

✖ Process DimensionMaintenance (Prolog line 14) creates OldRegion
  → DimensionElementInsert('Entity', '', 'OldRegion', 'N')
  → This process is NOT in the package — element will be recreated on next run
  → Either update DimensionMaintenance and add it to this package,
    or remove the element deletion from this package

WARNING — OBJECTS ON TARGET NOT COVERED BY PACKAGE
─────────────────────────────────────────────────────────────
⚠ Process LoadFromERP (Data section line 47) writes to OldRegion
  → CellPutN(val, 'Budget', !Month, 'OldRegion', ...)
  → This process is NOT in the package — will fail at runtime after deletion

⚠ Rules on SalesCube (line 23) reference OldRegion
  → DB('Budget', !Period, 'OldRegion', !Measure)
  → This cube is NOT in the package — rules will error after deletion
```

---

## Reference Integrity Checks

Neither PAW nor Architect perform reference integrity checks. You can delete an element that is hardcoded in a dozen TI processes and both tools will let you do it without a word. You can save rules that reference a non-existent element, save a TI that calls a deleted subset, delete a process that a chore depends on — no warnings, no errors, no indication anything is wrong. The breakage surfaces at runtime, often in production, often traced back to a change made days earlier.

The IDE treats this as a solved problem. TM1 objects reference each other by name — elements in rules, subsets in TI datasources, processes called by other processes — and every save and every delete is an opportunity to check those references immediately. The cost of checking is low. The cost of a broken reference reaching production is high.

The IDE adds reference integrity checking at three points in the development lifecycle:

```
1. On TI Save      → check all references in the saved code against Dev server
2. On Rules Save   → check element references + run CheckRules API
3. Pre-delete      → check Dev server before deleting any element
4. Deploy risk check → check all references in the package against the target server
```

Each check is non-blocking — the developer can proceed — but findings are surfaced immediately in the relevant panel so problems are caught at the point of creation, not at deploy time.

---

### On TI Save

When a TI process is saved, the IDE scans all four sections (Prolog, Metadata, Data, Epilog) plus the process DataSource definition for references to named TM1 objects, and validates each against the Dev server.

**What is scanned and how:**

| Reference type | Where found | TM1 functions / patterns | Validated against |
| --- | --- | --- | --- |
| Element names | String literals in all sections | `CellPutN`, `CellGetN`, `DimensionElementInsert`, `IF` comparisons, etc. | Element exists in the named dimension |
| Subset names | String literals in all sections | `SubsetExists`, `SubsetGetSize`, `SubsetAliasSet`, `SubsetToTempSubset`, `ExecuteProcess` params | Public subset exists in the named dimension |
| Subset as datasource | Process DataSource definition | `DataSourceType = 'Subset'` | Subset exists in the named dimension |
| Dimension names | String literals in all sections | `DimensionExists`, `DimensionElementInsert`, `SubsetExists`, etc. | Dimension exists on server |
| Cube names | String literals in all sections | `CellPutN`, `CellGetN`, `CellValue`, `DB`, `CELLVALUE`, etc. | Cube exists on server |
| Process names | `ExecuteProcess` calls | `ExecuteProcess('ProcessName', ...)` | Process exists on server |

**Classification of findings:**

| Finding | Severity | Example |
| --- | --- | --- |
| `DimensionElementInsert` for an element deleted this session | BLOCKER | Recreating what you just deleted |
| Element/subset/cube/process referenced but does not exist | WARNING | Dead reference — will fail at runtime |
| Element/subset in a dimension that doesn't exist | WARNING | Orphaned reference |
| Comment line (`#`) matches — false positive | Ignored | |

**Where findings appear:** TI error log panel (same panel used by the debugger and run results). Shown as a separate "Reference Check" block below any compile/run errors.

---

### On Rules Save

Two layers of validation run when rules are saved:

**Layer 1 — TM1 CheckRules API**
Already implemented. TM1 validates syntax, DB() references, and rule logic. Errors returned by TM1 are shown in the rules validation panel.

**Layer 2 — Element existence scan**
Scans rules text for string literals that match element names in dimensions the cube uses. Flags references to elements that no longer exist on the server. Shown alongside CheckRules errors.

TM1's CheckRules API does not always catch deleted element references (the rule may still parse as valid syntax) — the IDE scan catches what CheckRules misses.

---

### Pre-Delete Check (Element Deletion)

Documented in full under [Deleting an Element from a Dimension](#deleting-an-element-from-a-dimension) in the Deployment Scenarios section.

Summary: before deleting an element the IDE checks Dev for data presence (BLOCKER), TI processes that create the element (BLOCKER), TI processes that reference the element (WARNING), rules that reference the element (WARNING), and subsets containing the element (INFO). Developer sees a confirmation dialog with all findings before proceeding.

---

### Deploy Risk Check — Reference Scope

At deploy time the same checks run against the **target server**, scoped to objects not covered by the package:

```
For each reference found on the target:
  → Is the referencing object also in this package?
      YES → covered, the fix deploys together with the change
      NO  → flag it — gap between package scope and target state
```

This means the deploy risk check is not re-validating work done in Dev. It is specifically checking whether the target has **additional references** that Dev does not have and that the package does not address — processes deployed separately, rules patched directly on target, cubes that exist on target but not in Dev.

**Full reference scan at deploy time:**

| Object being deployed | What to scan on target | Risk if not in package |
| --- | --- | --- |
| Element deleted | TI processes (all), rules on cubes using dim, data in cubes | BLOCKER (data, recreate), WARNING (reference) |
| Subset deleted | TI processes referencing subset, views using subset | WARNING |
| Dimension deleted | All cubes using it, all TI processes referencing it | BLOCKER |
| Process deleted | Chores that include it, TI processes that `ExecuteProcess` it | BLOCKER (chore), WARNING (process) |
| Cube deleted | Rules on other cubes that `DB()` into it, TI processes referencing it | WARNING |

---

## Control Object Disclosure Panel

The deploy diff shows objects in the session log scope. But control cubes and control dimensions also change during development — attribute values, element formats, security settings, picklist rules — and these changes are invisible to the standard diff unless they were explicitly tracked.

The Control Object Disclosure Panel is a separate, collapsed section in the deploy UI that shows **all control object changes between the current Dev server and the baseline**, regardless of session scope. It is informational by default — nothing in it is packaged unless the developer explicitly opts in.

**Why it matters:**

- Provides a complete picture of what changed in the Dev environment during the session window
- Surfaces gaps — control objects that changed but aren't yet supported by the packager
- Aids post-deploy diagnosis — "here's everything that was different at the time of deploy"
- Acts as a gap tracker — items appearing here that should be packageable are candidates for future packager support

### UI Behaviour

Collapsed by default in the Step 1 (Diff) view. Expandable per control object to show specific diffs.

```
▶ Control Object Changes  (14 changes across 5 objects — not included in package)

  ☐ }ElementFormats_Account       3 format strings changed
  ☐ }ElementAttributes_Entity     12 value changes
  ☐ }Picklist_Budget              rules changed
  ─ }CubeSecurity                 2 access changes     [disclosure only]
  ─ }ElementSecurity_Entity       1 change             [disclosure only]
```

### Checkbox Opt-In

Control objects that are model data (not environment-specific) can be opted into the package via checkbox. When checked, they are included in Step 2 (Package) alongside the session objects.

| Control object | Checkbox? | Reason |
| --- | --- | --- |
| `}ElementFormats_{dim}` | Yes | Model data — format strings are part of the model |
| `}ElementAttributes_{dim}` | Yes | Model data — attribute values are part of the model |
| `}Picklist_*` cubes | Yes | Model data — picklist rules are part of the model |
| `}CubeSecurity` | No — disclosure only | Environment-specific — goes to the Security Checklist instead |
| `}ElementSecurity_{dim}` | No — disclosure only | Environment-specific — goes to the Security Checklist instead |
| `}ProcessSecurity` | No — disclosure only | Environment-specific — goes to the Security Checklist instead |

Security objects always appear in the disclosure panel and always flow to the Security Checklist — never to the package.

### Gap Tracker Role

As packager support is added for new control object types, items graduate from disclosure-only to checkbox-enabled. The presence of a non-checkable item in the panel is an explicit signal that packager support is not yet built for it.

`}Picklist_*` cubes are currently a gap — they appear in the disclosure panel, not yet checkbox-enabled. Once picklist cube support is added to the snapshot and packager, they become checkable.

---

## Security Settings Deployment

### What is and isn't deployed

| Object | Deployed | Reason |
|---|---|---|
| `}Clients` (users) | Never | Environment-specific. Dev has test accounts, Prod has real users. |
| `}Groups` | Yes | Group structure must be consistent across environments. |
| `}CubeSecurity` | Yes | Access rights travel with the cube. |
| `}ElementSecurity_{Dim}` | Yes | Element access travels with the dimension. |
| `}ProcessSecurity` | Yes | Process access travels with the process. |
| `}ViewSecurity` | Yes | View access travels with the view. |
| `}ChoresSecurity` | Yes | Chore access travels with the chore. |

### Why manual, not automated

Security changes in Prod are high-risk — a mistake can expose or lock out data for real users. Automated deployment of security settings is explicitly out of scope. Instead the pipeline generates a checklist, the admin applies it manually, and the result is verified and logged.

### The Security Checklist

At deploy time the pipeline reads the relevant control cubes from Dev and generates a **Security Actions Required** report alongside the deployment package. Example:

```
SECURITY ACTIONS REQUIRED — apportionment-v1
─────────────────────────────────────────────
New cube: SalesForecast
  → }CubeSecurity:  ADMIN=Write, DataEntry=Write, ReadOnly=Read

New dimension elements: Month (Jan-26, Feb-26, Mar-26)
  → }ElementSecurity_Month:  DataEntry=Read for new elements

New process: }Generate_Forecast
  → }ProcessSecurity:  ADMIN=Execute

New group: Forecasters
  → Create group in Prod first, assign users manually
```

The developer reviews the checklist and ticks **"I confirm these security settings will be applied"** in the Deploy Panel. This confirmation is timestamped and logged against the deployment record. Deployment is not blocked — it proceeds on confirmation regardless.

### Security Verification

After the admin has applied the security settings in Prod/Test, a **Verify Security** action is available in the Deploy Panel. It connects to the target server, reads the relevant control cube cells, and compares against the checklist:

```
✓ }CubeSecurity SalesForecast — ADMIN=Write     MATCH
✓ }CubeSecurity SalesForecast — ReadOnly=Read   MATCH
✗ }ProcessSecurity }Generate_Forecast           MISSING
```

This is a manual trigger — not a deployment gate. The result is logged against the deployment record for audit and compliance. All green = deployment fully verified.

---

## Compliance and Audit Trail

TM1 models in finance, planning, and consolidation are subject to audit and compliance requirements — SOX, internal audit, change management processes. The deployment pipeline is designed to produce a complete, tamper-evident record of every change from development through to production.

### Why This Matters

Without a structured deployment pipeline, TM1 changes are effectively unauditable. A developer opens Architect, edits a rule, saves it — no record of what changed, who changed it, what it was before. Auditors ask "what changed in Q3?" and the answer is a manual process of asking developers, reading email threads, hoping someone kept notes.

The IDE changes this. Every action is logged. Every deployment is a structured event with a named actor, a verified payload, and a recorded outcome. The audit trail is a by-product of the development process, not an additional overhead.

---

### The Complete Audit Lifecycle

Each event in the lifecycle is a timestamped, attributed record. Together they form an unbroken chain from the initial baseline through to post-deployment verification.

```
1.  SEED          Who seeded, from which server, when, object counts
2.  SESSION       Who opened the session, when, session name
3.  CHANGES       Every save: who, when, object, before-state, after-state
4.  SESSION CLOSE Who closed the session, when, total entry count
5.  DIFF          When run, what was compared, outcomes per object
6.  PACKAGE       Who built it, when, manifest content, package hash
7.  RISK CHECK    When run, target server, findings (blockers, warnings, safe)
8.  APPROVAL      Who approved, when, explicit sign-off statement
9.  DEPLOY        Who triggered, when, target, dry-run or real
10. PRE-SNAPSHOT  State of target immediately before package applied
11. RESULT        Per-object outcome — deployed / failed / skipped
12. POST-SNAPSHOT State of target immediately after package applied
13. SECURITY      Who applied manual security settings, when
14. VERIFY        Security verification result per checklist item, when
```

---

### Approval Step

The current deploy UI has a single "I confirm this will modify target" checkbox — sufficient for development workflows but not for formal change management.

For compliance the approval step separates the **developer** (who built and packaged the change) from the **approver** (who authorises it to go to production). The approver sees the package manifest, the risk report, and explicitly signs off before the deploy button becomes active.

```
APPROVAL REQUIRED — apportionment-v1  →  Prod

Package:    14 objects  (manifest hash: a3f9c2...)
Risk check: SAFE — 0 blockers, 2 warnings (reviewed)
Requested:  jdlove  2026-06-18 09:14

Approver sign-off:
  [ Approved by: _____________ ]   [ Date: _______ ]
  [ I have reviewed the package manifest and risk report ]
  [ Approve ]   [ Reject ]
```

The sign-off is recorded against the deployment record with the approver's username and timestamp. Deployment is blocked until approval is recorded.

---

### Deployment Record

Each deployment produces a persistent deployment record stored in the change log database alongside the session entries. The record links every step of the lifecycle together.

```json
{
  "deployment_id":   "dep_2026-06-18_001",
  "session_id":      "apportionment-v1",
  "source_server":   "dev",
  "target_server":   "prod",
  "package_hash":    "a3f9c2e8...",
  "seeded_at":       "2026-06-01T09:00:00Z",
  "diff_run_at":     "2026-06-18T09:10:00Z",
  "packaged_at":     "2026-06-18T09:12:00Z",
  "packaged_by":     "jdlove",
  "risk_checked_at": "2026-06-18T09:13:00Z",
  "risk_outcome":    "SAFE",
  "approved_at":     "2026-06-18T09:20:00Z",
  "approved_by":     "msmith",
  "deployed_at":     "2026-06-18T09:22:00Z",
  "deployed_by":     "jdlove",
  "dry_run":         false,
  "result":          "SUCCESS",
  "objects_deployed": 14,
  "objects_failed":   0,
  "pre_snapshot_ref":  "snapshots/pre-dep_2026-06-18_001.json",
  "post_snapshot_ref": "snapshots/post-dep_2026-06-18_001.json",
  "security_applied_by": "msmith",
  "security_verified_at": "2026-06-18T10:05:00Z",
  "security_result":  "PASS"
}
```

---

### Pre and Post Deployment Snapshots

Immediately before applying the package, the deployer takes a targeted snapshot of the affected objects on the target server — not a full server snapshot, just the objects in the package. This is stored as the pre-deployment state.

Immediately after applying, the same objects are read again as the post-deployment state.

Together these prove:

- What the target looked like before the change (pre)
- What it looked like after (post)
- That the deployed content matches the package manifest (diff pre vs post)

These snapshots are stored alongside the deployment record and are available for audit review.

---

### Before and After State in the Change Log

The change log's `before_state` and `after_state` per entry are the most granular level of audit evidence. For every save action in the IDE, the system records exactly what the object contained before and after the save.

This means an auditor can answer:

- What did the Budget rules look like before jdlove's change on 18 June?
- What exactly changed between the two versions?
- Was the change consistent with what was deployed?

No other TM1 tool captures this. PAW and Architect have no before/after state — once a save happens, the previous version is gone. The IDE change log is the only source of this evidence.

---

### Audit Report

The IDE can generate a deployment audit report on demand for any historical deployment — a single document covering the complete lifecycle from seed to verification.

```
DEPLOYMENT AUDIT REPORT
═══════════════════════════════════════════════════════
Session:     apportionment-v1
Source:      dev        Target: prod
Deployed:    2026-06-18 09:22  by jdlove
Approved:    2026-06-18 09:20  by msmith

CHANGE SUMMARY (14 objects)
──────────────────────────────────────────────────
  rules     APR_Allocation       changed from baseline
  rules     APR_Driver           changed from baseline
  process   APR_LoadDrivers      new
  process   APR_RunAllocation    new
  dimension APR_CostPool         new
  ...

RISK REPORT
──────────────────────────────────────────────────
  SAFE — 0 blockers  2 warnings  12 safe
  Warnings reviewed and accepted by msmith

RESULT
──────────────────────────────────────────────────
  14 deployed  0 failed

SECURITY
──────────────────────────────────────────────────
  Applied by msmith  2026-06-18 09:45
  Verified           2026-06-18 10:05  PASS

PRE/POST STATE
──────────────────────────────────────────────────
  Pre-snapshot:   snapshots/pre-dep_2026-06-18_001.json
  Post-snapshot:  snapshots/post-dep_2026-06-18_001.json
═══════════════════════════════════════════════════════
```

---

### What Is and Is Not Audited

| Activity | Audited | Notes |
| --- | --- | --- |
| Every IDE save | Yes | Full before/after state, user, timestamp |
| Session lifecycle | Yes | Open, close, entry count |
| Diff, package, risk check | Yes | Timestamps and outcomes |
| Deployment approval | Yes | Approver name and timestamp |
| Deployment execution | Yes | Per-object result |
| Pre/post target state | Yes | Targeted snapshots |
| Security settings applied | Yes | Who, when, verify result |
| Changes made outside the IDE | No | PAW/Architect edits not logged — appear as DRIFT |
| Direct server access (REST/API) | No | Outside IDE scope |

Changes made outside the IDE are not captured in the change log and cannot be audited through this system. DRIFT detection surfaces these gaps at deploy time — an object showing as DRIFT means it was changed outside the IDE and has no audit trail. This is a signal to the compliance team that a change occurred through an uncontrolled channel.

---

### Archive — Post-Deployment Storage

Once a session is successfully deployed and verified, its audit data is archived out of the live SQLite database. The live DB retains only a lightweight reference row (session name, deployed date, archive path). The full audit data moves to the packages repository alongside the package it produced.

**Folder structure:**

```
packages/
  apportionment/
    tm1package.yaml
    dimensions/
    cubes/
    processes/
    audit/
      apportionment-v1.audit.json
  finance/
    tm1package.yaml
    ...
    audit/
      finance-q2.audit.json
      finance-q3.audit.json
```

Each `.audit.json` file is a complete, self-contained record of the deployment lifecycle — session entries with full before/after state, diff outcomes, risk report, approval, deployment result, pre/post snapshots, and security verification. It is committed to git alongside the package at deploy time, making the audit trail version-controlled and co-located with the package it describes.

**Archive file structure:**

```json
{
  "deployment":    { ...deployment record, approver, timestamps, result... },
  "session":       { "entries": [ ...every save with before/after state... ] },
  "diff":          { ...diff outcomes per object... },
  "risk_report":   { ...blockers, warnings, safe items... },
  "pre_snapshot":  { ...targeted snapshot of target before apply... },
  "post_snapshot": { ...targeted snapshot of target after apply... },
  "security":      { ...checklist items, applied by, verified by, result... }
}
```

---

### Archive History Panel

The IDE includes a read-only **Archive History** panel that browses the packages folder and surfaces all past deployments without leaving the tool.

**Panel behaviour:**

- Lists all archived deployments across all packages, sorted by date
- Filterable by package, session name, target server, user, date range
- Click any deployment to open its full audit report as a read-only tab

**What you can see per deployment:**

```
apportionment-v1  →  prod   2026-06-18  jdlove  (approved: msmith)
──────────────────────────────────────────────────────────────────
Session entries    14 changes  ← click any to see before/after diff
Diff               14 objects  MATCH:8  NEW:4  UNCHANGED:2
Risk report        SAFE  0 blockers  2 warnings
Deployment result  14 deployed  0 failed
Security           PASS  verified 2026-06-18 10:05 by msmith
```

Clicking a session entry opens the same side-by-side diff viewer used during active development — showing exactly what changed in that save, pulled from the archived before/after state.

**The archive folder is also directly readable** — the `.audit.json` files are plain JSON, human-readable in any text editor or git viewer. Auditors who need a document can use the IDE's export to generate a formatted PDF audit report from any archived deployment.
