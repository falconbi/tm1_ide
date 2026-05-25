# TM1 IDE — Concept

## The Problem

TM1 models live inside the server. There is no version control, no way to reproduce a model on a new server, no code review before a change goes live, and no history of who changed what. Every TM1 shop either has no version control or a manual export discipline that breaks down.

---

## The Idea

Build TM1 models as code — YAML files in a git repository — and deploy them to TM1 servers via the REST API. The IDE is the tool you use to author and manage those files.

---

## Models as Code

Every TM1 object is defined in a YAML file:

```yaml
# dimensions/entity.yaml
dimension: entity
hierarchy: entity
elements:
  - name: Total Entity
    type: Consolidated
    children:
      - name: "10110"
        type: Numeric
      - name: "10120"
        type: Numeric
attributes:
  - name: currency
    type: String
  - name: region
    type: String
```

```yaml
# cubes/revenue.yaml
cube: revenue
dimensions:
  - entity
  - time
  - measure
rules: rules/revenue.rules
```

```
# rules/revenue.rules
SKIPCHECK;

['Profit'] = N: ['Revenue'] - ['Cost'];

FEEDERS;
['Revenue'] => ['Profit'];
```

YAML is what you write. JSON is what the TM1 REST API speaks. The deploy tool converts YAML to API calls automatically.

---

## Module Architecture

All modules live on a **single TM1 server per environment** — not one server per module.

```
tm1-dev.company.com
  ├── APR_CostPool        (apportionment module)
  ├── APR_Allocation      (apportionment module)
  ├── FIN_Budget          (finance module)
  ├── FIN_Actuals         (finance module)
  ├── HR_Headcount        (hr module)
  ├── Period              (core — shared)
  ├── Entity              (core — shared)
  └── Currency            (core — shared)
```

Module separation is a **naming convention and package boundary**, not a server boundary.
Shared dimensions (`Period`, `Entity`, `Currency`) are owned by the `core` package.
Cross-module `DB()` rules, shared chores, and shared dimensions all work naturally
because everything is on the same server.

Each module is a **package** — a folder with a manifest declaring what it owns and what
it modifies on shared objects owned by other packages:

```yaml
# packages/apportionment/tm1package.yaml
name: apportionment
version: 1.0.0
dependencies:
  core: ">=1.0.0"    # Period and Entity must exist first

owns:
  dimensions: [APR_CostPool, APR_Driver]
  cubes: [APR_Allocation]
  processes: [APR_LoadDrivers, APR_RunAllocation]

modifies:
  - object: Entity
    type: attribute
    name: APR_DriverGroup    # attribute added to shared dimension
```

The deploy tool resolves dependencies and checks they exist on the target before applying.

---

## CICD Pipeline

```
Edit YAML files locally
  → git commit
    → git push
      → CI pipeline runs tm1_deploy --diff   (show what changes)
      → CI pipeline runs tm1_deploy --apply  (deploy to server)
        → TM1 REST API
```

Different branches point to different environments:

```
branch: dev     → planning_dev server
branch: staging → planning_staging server
branch: main    → planning_prod server
```

Rollback is just `git revert`.

---

## The IDE

Modelled on VS Code. Three panels:

**Explorer** — object tree
```
planning_db
  ├── Cubes
  │     └── plan_BudgetPlan   ← click to open rules
  ├── Dimensions
  │     └── entity            ← click to open editor
  ├── Processes
  │     └── LoadActuals       ← click to open TI editor
  └── Chores
```

**Editor** — context-sensitive
- Dimensions: visual hierarchy tree + YAML side by side, both editable, both in sync
- Rules: Monaco code editor with TM1 syntax highlighting
- TI Processes: Monaco editor with Prolog / Metadata / Data / Epilog tabs
- Cube Viewer: interactive data grid, leaf cell editable
- MDX Scratchpad: write MDX, execute, see results

**Panel** (bottom)
- Terminal: execute TI processes, stream log output
- Problems: rule syntax errors, process run errors, model validation issues
- Diff: what would change if you deploy now

---

## What Makes It Better Than Architect

| Architect / PAW | TM1 IDE |
|-----------------|---------|
| Edit directly on server | Edit locally, deploy explicitly |
| No version control | Full git history |
| One window at a time | Multiple tabs open, compare side by side |
| No search across objects | Search across all rules and processes |
| Manual promotion to prod | CI pipeline deploys on push |
| No dependency tracking | Module system with declared dependencies |
| No model templates | Reusable module templates in git |

---

## Build Order

1. **tm1_deploy CLI** — YAML to TM1 REST API, diff + apply, module dependencies
2. **Explorer + Rules Editor** — browse objects, edit rules, save back to server and YAML
3. **TI Process Editor** — four code tabs, execute, terminal output
4. **Cube Viewer** — read/write grid for any view
5. **Dimension Editor** — visual hierarchy builder synced to YAML
6. **Subset Editor** — member picker, MDX subsets
7. **MDX Scratchpad** — ad hoc queries
8. **CICD templates** — GitHub Actions / GitLab CI starter configs
