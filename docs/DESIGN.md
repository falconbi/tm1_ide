# TM1 IDE — System Design

This document captures the conceptual design of how humans work with the IDE to build and maintain TM1 solutions. It sits above the implementation plan — the *why* and *what* before the *how*.

---

## Core Mental Model

> **The project is the primary artifact. The server is where you run it.**

A TM1 server is a canvas — a deployment target, not a source of truth. Developers author YAML files in a git repository. The server reflects what has been deployed from those files. This is a fundamental shift from how TM1 teams work today (edit directly on server, server is truth).

---

## The Structure

Four distinct layers — each with a clear owner and purpose:

```text
Template Library  (platform-wide, not tied to any solution)
  └── base library objects + approved Template Modules
  └── any solution's module can be published here
  └── any solution's developers can pull from here

Solution  (one per implementation — e.g. Finance Platform)
  └── owns shared dimensions for its modules
  └── registry of which modules belong to it
  └── manages cross-module and cross-solution data feeds

Module  (one TM1 database = one git repo)
  └── receives shared dims from its Solution (read-only)
  └── imports objects from the Template Library
  └── owns everything it builds internally
```

GitHub organisation structure:

```text
falconbi/

  tm1-template-library       ← standalone, platform-owned
    ├── templates.yaml       ← approved Template Module registry
    └── base/                ← base library objects (mandatory + optional)

  solution-finance           ← solution manifest + shared dims
  solution-hr                ← another solution, same template library

  workforce                  ← live module — also published as a template
  apportionment              ← live module
  consolidation              ← live module
```

### Solution

A Solution is a complete TM1 implementation for an organisation or division (e.g. "Finance Platform"). It:

- Owns the **shared dimensions** used across all its modules (Period, Version, Entity)
- Holds a manifest of which modules belong to it
- Manages **data feeds** between its modules and from other Solutions
- Derives its dependency map automatically by reading each module's `project.yaml`

A large enterprise may have multiple Solutions. They are treated as independent. Data flow between Solutions is handled explicitly via PULL feeds.

### Module

A Module is one TM1 database. It lives in its own git repository and contains:

- **Shared dimensions** received from the Solution (read-only — cannot be edited in the module)
- **Objects imported from the Template Library** (module owns its copy from import time)
- **Objects built internally** (fully owned by the module team)

---

## Shared Dimensions — Infrastructure, Not Content

Shared dimensions (Period, Version, Entity and any others the platform team designates) behave differently from all other objects:

- **Owned by the Solution**, not by any module
- **Read-only inside modules** — the IDE blocks edits, shows them clearly as Solution-owned
- **Auto-propagated to all modules** when updated — no opt-in

Update flow:

```text
Platform team updates period-standard (e.g. adds FY2027 elements)
        ↓
Solution auto-opens a PR in every module repo
  "shared/dimensions/period updated: v2.3 → v2.4"
        ↓
PR merges (platform-controlled or auto-merge on schedule)
        ↓
CI deploys updated dimension to each module's dev server
```

Module teams see the change in git — visible, traceable, attributed — but they did not choose it and cannot block it. Shared dimensions are infrastructure.

---

## The Template Library

The Template Library is the whole benefit of the platform model. It is a standalone GitHub repo (`tm1-template-library`) owned by the platform team, independent of any Solution. Every solution's developers pull from it. Every solution's teams can publish to it.

This is what prevents random builds, enforces standards, and compounds value over time — every approved module becomes a starting point for the next team.

### What lives in the Template Library

**Base Library** — individual certified objects, independently versioned:

```text
base/
  mandatory/          ← auto-applied to every new module
    period-standard
    version-standard
    entity-standard
    audit-log

  optional/           ← developer chooses at creation or any time after
    currency-standard
    employee-standard
    cell-security-refresh
    period-rollforward
    data-load-csv
```

**Template Modules** — complete, working, approved modules available as starting points:

```yaml
# tm1-template-library/templates.yaml

templates:
  - name: Workforce Starter
    repo: falconbi/workforce
    version: v2.1.0
    description: Headcount, salary and FTE cubes with standard load TIs

  - name: Cost Allocation
    repo: falconbi/apportionment
    version: v1.3.0
    description: Driver-based allocation with entity and cost centre dims

  - name: Consolidation
    repo: falconbi/consolidation
    version: v1.0.0
    description: Legal entity consolidation with intercompany elimination
```

A Template Module is a real, live module repo at a pinned version tag. It contains domain-specific business logic — cubes, rules, TI processes, chores — built and refined in production, then approved for reuse.

### Publishing a Template Module

Any module team from any solution can submit their module as a template. The process:

```text
Module team tags a stable version on their repo  (e.g. v2.1.0)
        ↓
Opens a PR against tm1-template-library adding their entry to templates.yaml
        ↓
Platform team reviews the module at that tagged version:
  — naming standards followed?
  — mandatory base objects present and correct?
  — TI code clean — no hardcoded servers, no temporary hacks?
  — genuinely useful as a starting point for another team?
        ↓
Approved: PR merged → appears in IDE template picker for all solutions
Rejected: PR closed with comments → module team fixes and resubmits
```

The PR to `templates.yaml` is the formal approval record. The code review happens on the module repo at the pinned tag. Merging is the gate.

### Using a Template Module

The IDE template picker reads `templates.yaml` from the Template Library — not from any solution. All approved templates are available to all solutions.

```text
New Module — Choose a template

  ○ Workforce Starter    v2.1.0   Headcount, salary and FTE cubes...
  ○ Cost Allocation      v1.3.0   Driver-based allocation...
  ○ Consolidation        v1.0.0   Legal entity consolidation...
  ○ None — start from base layer only
```

A template can be taken in full or browsed object by object. The idempotent merge rule applies — base objects already in the module are skipped. The developer owns their copy from import time.

---

## Module Creation — Three Layers

New module creation applies objects in three layers, in order:

```text
Layer 1:  Mandatory base objects          ← always applied, no choice
               ↓ (idempotent merge)
Layer 2:  Optional base library objects   ← developer picks from base library
               ↓ (idempotent merge)
Layer 3:  Template Module selection       ← optional, choose none / one / partial
               ↓ (idempotent merge)

Result: working module, deploy to dev server, begin development
```

**Idempotent merge rule:** at every layer, if an object already exists in the module it is skipped. This applies throughout — adding objects from the registry at any point in a module's life is always safe.

A developer is not limited to one moment of selection. Objects can be added from the base library or a Template Module at any time during the module's life.

---

## Dependency-Aware Object Selection

When selecting from a Template Module, choosing one object (typically a cube) automatically surfaces everything that object depends on.

```text
Developer selects:  headcount-cube
                          ↓
System walks YAML dependency graph:

  REQUIRED — auto-selected (cube will not work without these)
    ✓ headcount-cube           your selection
    ✓ employee-standard        dimension used by cube
    ✓ measure-headcount        dimension used by cube
    ✓ period-standard          already in module — skip
    ✓ version-standard         already in module — skip
    ✓ headcount-load           TI that writes to this cube
    ✓ headcount-adjust         TI that maintains this cube
    ✓ monthly-headcount-load   chore that runs those TIs

  SUGGESTED — surfaced but not auto-selected
    ~ salary-cube              referenced in headcount rules (DB call)
    ~ current-year-subset      used in TI datasource

Developer reviews, adjusts, confirms
```

The developer can deselect anything in the required list or accept any suggestion. The result is their starting selection — they can add more later.

**This uses the same engine as CubeMap.** The dependency graph that powers visual lineage in the IDE (Phase 9 of the build plan) is the same graph used here to suggest related objects. One engine, two uses — building it early pays off across the whole system.

---

## The Dependency Graph

Every feature that involves "what is connected to what" — CubeMap, rules lineage trace, impact analysis, template object selection — runs off a single shared dependency graph built from the TM1 model. This graph is the structural backbone of the IDE.

### What the graph contains

Nodes are TM1 objects. Edges are relationships between them derived entirely from the model's own code and metadata — no manual annotation required.

| Node type | Edge type | Target |
| --------- | --------- | ------ |
| Cube | DB() / DBS() call in rules | Cube (lookup source) |
| Cube | uses dimension | Dimension |
| TI Process | CellPutN / CellPutS | Cube (write target) |
| TI Process | CellGetN / CellGetS | Cube (read source) |
| TI Process | ExecuteProcess() | TI Process |
| TI Process | TM1CubeView datasource | Cube + View |
| Chore | step | TI Process |
| View | defined on | Cube |
| View | uses subset | Subset |
| Subset | defined on | Dimension |

### How it is built

The graph is constructed by static analysis — parsing the model without executing anything:

```text
1. Fetch all cube rules → parse every DB() / DBS() call → cube-to-cube edges
2. Fetch all TI process code → parse CellPut/CellGet, ExecuteProcess → process edges
3. Fetch TI datasource metadata → TM1CubeView entries → process-to-view edges
4. Fetch cube metadata → dimension lists → cube-to-dimension edges
5. Fetch chore definitions → step lists → chore-to-process edges
```

The parser for DB() calls is the same one that drives autocomplete — it already extracts the cube name from the first string argument. Reusing it here costs nothing.

The graph is built on demand when the IDE connects to a server and cached in memory. Rebuilding takes seconds on a typical model. Changes (a rule edit, a saved process) invalidate only the affected node's edges.

### What the graph powers

| Feature | How the graph is used |
| ------- | --------------------- |
| **CubeMap** | Visualise cube-to-cube DB() relationships as a directed graph |
| **Rules lineage trace** | Walk edges forward (sources) or backward (consumers) from any cube |
| **Impact analysis** | Reverse traversal — "if I change this cube/dimension, what is affected?" |
| **Template object selection** | Walk dependencies to surface required and suggested objects |
| **Global search blast radius** | Highlight every object that references the search term |
| **Chore visualiser** | Show full execution chain: chore → processes → cubes written |

### Blast radius — the practical use

Before changing anything in a live model — renaming a dimension, restructuring a cube, changing a rules formula — a developer needs to know the blast radius. With the dependency graph:

```text
Developer selects: Entity dimension
        ↓
Graph reverse-traversal:

  Cubes using Entity:
    Revenue, Cost, Headcount, Allocation (4 cubes)

  Processes reading Entity elements:
    load_actuals, load_budget, load_headcount (3 processes)

  Subsets on Entity:
    Active_Entities, Budget_Entities, Leaf_Only (3 subsets)

  Views using Entity subsets:
    Revenue_Budget_View, Cost_Summary_View (2 views)
```

This takes 2 seconds. Without it, a developer manually opens every cube and process hoping not to miss one. The graph makes impact assessment routine rather than heroic.

### Visualisation

The graph is rendered using React Flow — the same library used in CubeMap. The IDE reuses the same renderer component across the Rules Lineage panel, the CubeMap view, and the Chore visualiser. Layout, zoom, click-to-open, and node colouring by type are shared behaviour.

---

## Data Feeds — Between Modules and Between Solutions

Each module is its own isolated TM1 database. Rules are contained within their own database and cannot reference cubes in another module's database. This is a TM1 technical constraint, not a design choice.

**Data movement between modules is always an explicit PULL via TI process.** There is no other mechanism.

```text
Module connections

  Structural  →  shared dimensions from Solution
                 same definition deployed to each module's isolated DB

  Data        →  always PULL via TI process
                 TI on the consuming module reads from the source module
                 source module does not know the consumer exists
```

The TI pull can connect to the source module's server in three ways:

| Mechanism | How |
| --------- | --- |
| Server-to-server datasource | TI uses source module's TM1 server as a datasource, reads a named view |
| TM1py script | Python reads from source via REST API, writes locally |
| File intermediate | Source exports to shared location, consumer imports |

The same pattern applies whether the source is another module within the same Solution or a module in a completely different Solution. The mechanism is identical — the only difference is that within-solution modules share governance and coordination is easier.

### How a module knows it needs a refresh

The consuming module cannot know on its own — something has to tell it. Three trigger options exist, each with trade-offs:

| Trigger | How | Trade-off |
| ------- | --- | --------- |
| Schedule only | Consumer chore runs at a fixed time, checks readiness flag | Simple but fragile — if source runs late, consumer waits until tomorrow |
| Source signals directly | Source TI calls ExecuteHTTP to trigger consumer's REST endpoint | Reactive but creates coupling — Module A must know Module B exists |
| IDE server as coordinator | IDE server monitors source chore completion, triggers consumers | Reactive and decoupled — modules have no knowledge of each other |

The IDE server as coordinator is the right model. The Node.js server already knows about all modules (it reads every `project.yaml`). It becomes a lightweight orchestrator:

```text
Module A: period-close chore completes
        ↓
IDE server detects completion via TM1 REST API
        ↓
IDE server reads dependency graph: who declared a feed on this chore?
        ↓
IDE server triggers Module B and Module C pull chores via REST API
        ↓
Each consumer checks readiness flag then executes pull
```

Modules remain completely decoupled. Module A's TI has no knowledge of consumers. The IDE server is the only component that holds the full dependency graph, derived from all `project.yaml` files.

### Feed configuration

The trigger is declared in `project.yaml` alongside the feed — not hardcoded in TI code:

```yaml
# apportionment/project.yaml
data_feeds:
  - name: actuals_from_planning
    source_module: falconbi/planning
    source_cube: ActualData
    source_view: Reporting_Export
    trigger:
      type: on_completion
      chore: period-close
    readiness_check:
      type: cell_flag
      cube: }ProcessControl
      elements: [Actuals, Lock, FY2026-Q1]
```

Supported trigger types:

| Type | When it fires |
| ---- | ------------- |
| `on_completion` | When a named chore on the source module finishes |
| `schedule` | Cron expression — time-based fallback |
| `manual` | Developer triggers explicitly from the IDE |

### Feed status panel

The IDE shows each module's incoming feeds and their current state:

```text
Apportionment — Data Feeds

  actuals_from_planning    ● waiting    planning/period-close not yet run
  fx_rates_from_core       ✓ current   last pulled 2 hours ago
  budget_from_planning     ✓ current   last pulled yesterday 06:14
                                                        [Refresh now]
```

---

## Developer Scratchpad

Each developer has a personal notes and todo area within the IDE. It is private — not committed to git, not visible to other developers. Stored server-side keyed to the logged-in user.

The scratchpad is always accessible from the activity bar regardless of which module or object is open. Two areas:

```text
┌─ My Notes ──────────────────────────────────────────┐
│                                                      │
│  ☐ Check entity hierarchy with finance before push   │
│  ☑ Run reconciliation chore on dev                   │
│  ☐ Headcount rules — waiting on business sign-off    │
│                                          [+ Add todo] │
├──────────────────────────────────────────────────────┤
│  Scratch notes                                       │
│  ─────────────────────────────────────────────────  │
│  Period dim — James confirmed FY2027 structure        │
│  approved, can add elements once staging is green.   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Todos can be checked off but are never auto-deleted — the developer clears them manually. Notes are freeform text. Neither is versioned or audited — this is a personal working memory, not a formal record.

---

## Testing — A Core Feature, Not an Add-On

> **Testing is built into the development workflow. It is not optional and not an afterthought.**

The single biggest cause of TM1 project delays and low user adoption is bugs found in UAT. These bugs are almost never new — they exist in DEV from the moment the rule or TI process was written. Nobody checked. UAT becomes a bug hunt instead of a business validation.

This IDE treats testing as a first-class discipline. Tests are created *alongside* the objects being built, not after. The platform enforces this.

### What gets tested

| Object | What to test |
| ------ | ------------ |
| Rules | Given known input values, calculated cells produce correct results |
| TI processes | Given a known input dataset, data lands in the right cells |
| Consolidations | Leaf values roll up correctly to consolidated totals |
| Feeders | No missing feeders causing incorrect zero consolidations |
| PULL feeds | Data received from connected modules is correctly shaped and loaded |

### Test structure — part of every module from day one

Templates ship with test scaffolding already in place. A new module starts with a `tests/` folder, not an empty one.

```text
project/
  tests/
    fixtures/
      base_scenario.yaml     ← controlled input dataset for standard tests
      edge_cases.yaml        ← boundary conditions — zeros, nulls, negatives
    cases/
      rules/                 ← one file per rule or rule group
      processes/             ← one file per TI process
      consolidations/        ← rollup verification
      feeds/                 ← incoming PULL feed validation
    README.md                ← what the test suite covers, what it does not
```

### A test case

```yaml
# tests/cases/rules/profit_calculation.yaml
test: Profit margin calculation
fixture: base_scenario
version: }Test

given:
  - cube: Revenue
    cells:
      - [UK, Jan, Budget, Revenue]: 100
      - [UK, Jan, Budget, Cost]:    60

expect:
  - cube: Revenue
    cells:
      - [UK, Jan, Budget, Profit]:        40
      - [UK, Jan, Budget, Profit Margin]: 0.40
      - [UK, Total, Budget, Revenue]:     100
```

The `}Test` version is the safety mechanism — test data never touches real version data. Fixture loads write to `}Test`, tests read from `}Test`, cleanup wipes it. Real data is completely isolated.

### The test runner

```text
IDE loads fixture data → dev server (}Test version)
        ↓
Executes any TI processes in the scenario
        ↓
Reads back expected cells
        ↓
Compares actual vs expected (with floating point tolerance)
        ↓
Reports pass / fail per case with actual values shown
```

```text
Test Results

  ✓ Profit = 40                   actual: 40.00
  ✓ Profit Margin = 0.40          actual: 0.40
  ✓ UK Total Revenue = 100        actual: 100.00
  ✗ DE Total Revenue = 0          actual: null    ← feeder missing
  ✗ Allocation result = 25        actual: 0.00    ← rule error

  2 passed  2 failed
```

### Tests as a CI gate

Tests run automatically when a developer pushes their branch. Failing tests block promotion to the TEST Solution. This is not optional — if tests fail, the code does not move forward.

```text
Developer pushes branch
        ↓
CI runs full test suite against dev server
        ↓
All pass  →  safe to promote to TEST Solution
Any fail  →  blocked — fix before promoting
```

### The development discipline

When a developer builds a new rule, they write a test for it. When they build a TI process, they write a fixture for it. The IDE reinforces this:

- New rule saved → IDE prompts: "Add a test case for this rule?"
- New TI process saved → IDE prompts: "Add a fixture for this process?"
- Test coverage shown in the module dashboard — visible to the whole team

UAT then becomes what it should be: business users validating that the logic meets their requirements — not finding basic calculation errors that should have been caught in DEV.

---

## The Daily Developer Workflow (inside a module)

To be designed — this is the next open question.

Once a developer has a module running on a dev server, what does a work session look like? What do they open first, what does "done" look like, and how do they move from dev through to prod?

---

## MDX Builder

Cubewise Arc has an MDX builder and it is the right reference point — developers use it to build, test, and save MDX queries. This IDE builds on that concept with one significant advantage: everything is version controlled. A subset definition that changes is a commit with an author and a message. Arc does not give you that.

### Two distinct uses of MDX in TM1

MDX in TM1 serves two completely different purposes. The builder handles both in the same tool:

| Mode | What it does | Saved as |
| ---- | ------------ | -------- |
| View | Queries cube data — rows, columns, context filters | Named cube view on TM1 server + YAML |
| Subset | Selects members within a dimension dynamically | Named subset on dimension + YAML |

Subsets by MDX are as important as views. They are used everywhere — in views, in TI datasources, in PAW books — and dynamic MDX subsets are one of TM1's most powerful features.

```text
View MDX example:
  SELECT
    NON EMPTY {[Entity].[UK],[Entity].[US]} ON ROWS,
    NON EMPTY {[Period].[Jan],[Period].[Feb]} ON COLUMNS
  FROM [Revenue]
  WHERE ([Version].[Budget])

Subset MDX example (on Entity dimension):
  Filter(
    [Entity].[Entity].Members,
    [Entity].[Active] = "Yes"
  )
  → returns only active entities — dynamic, updates as data changes
```

### The builder UI

Three panels — same pattern as all builders:

```text
┌─ Axis Builder ───────────┬─ MDX (Monaco) ───────────┬─ Result ──────────────┐
│                           │                           │                       │
│  Mode: ● View  ○ Subset  │  SELECT                   │      Jan   Feb   Mar  │
│                           │   NON EMPTY               │  UK  100   120   140  │
│  Rows                     │   {[Entity].[UK],         │  US  200   210   230  │
│  ◈ Entity — UK, US, DE   │    [Entity].[US]}          │  DE   80    90   100  │
│                           │   ON ROWS,                │                       │
│  Columns                  │   NON EMPTY               │                       │
│  ◈ Period — Jan, Feb, Mar │   {[Period].[Jan]...}     │                       │
│                           │   ON COLUMNS              │                       │
│  Context                  │  FROM [Revenue]           │                       │
│  Version = Budget         │  WHERE                    │  [Save as view]       │
│                           │   ([Version].[Budget])    │  [Save as subset]     │
│  [+ dimension]            │                           │  [Execute]            │
└───────────────────────────┴───────────────────────────┴───────────────────────┘
```

Editing either the visual axis builder or the Monaco MDX panel updates the other. Execute runs against the dev server and populates the result panel.

### Saving work in progress

MDX queries are saved as files in the project — not just the result, but the query itself. A developer can build an MDX query, save it, come back tomorrow, iterate, and publish when ready.

```text
project/
  mdx/
    revenue_by_region_ytd.mdx
    headcount_active_budget.mdx
    active_entities_subset.mdx
```

These files are version controlled like everything else. The history of how a view or subset definition evolved is visible in git.

### Publishing

From the result panel, the developer chooses what to do with the finished MDX:

- **Save as named view** → writes to TM1 server AND to the cube's YAML file
- **Save as named subset** → writes to TM1 server AND to the dimension's YAML file
- **Keep as MDX file only** → stays in `project/mdx/` as a saved query, not yet a named object

---

## TI Process Debugger

True step-through debugging is not possible — TM1 does not expose a debug protocol via the REST API. A process runs on the server atomically; it cannot be paused mid-execution. However a practical debugger experience is achievable via watch-point injection and log streaming.

### How it works

```text
Developer sets watch points in the IDE (click gutter, like breakpoints)
        ↓
IDE injects LogOutput() calls at those lines before executing
        ↓
Process runs on TM1 server with injected logging
        ↓
IDE streams server log via WebSocket, parses debug lines
        ↓
Variables panel updates in near-real-time as log entries arrive
```

### UI layout — TI Builder gains a Variables panel

```text
┌─ TI Code ───────────────────┬─ Variables ──────────────────┐
│                              │                              │
│  10  !rev = DB('Rev',...)   │  Variable      Value         │
│ ●11  IF(!rev > 0)           │  ─────────────────────────  │
│  12    !result = !rev*!rate  │  !entity       "10110"       │
│  13  ENDIF                   │  !period       "2026-Jan"    │
│                              │  !version      "Budget"      │
│                              │  !rev          125000.00     │
│                              │  !rate         (not set yet) │
│                              │                              │
│                              │  Constants                   │
│                              │  ─────────────────────────  │
│                              │  #CubeName     "Revenue"     │
└──────────────────────────────┴──────────────────────────────┘
```

### The Data tab problem

The Data section loops over every datasource record — potentially thousands. Logging every iteration floods the output and is unusable. The debugger requires a filter:

```text
Data tab debug options:
  ○ First N records only     [5]
  ○ When condition is true   !entity = '10110'
  ○ On error only
```

This lets the developer target the specific record causing a problem rather than wading through thousands of log lines.

### Static analysis — free, no execution needed

The IDE parses TI code on open and immediately populates the Variables panel with all declared variables and constants — without values. Values fill in as the process executes. This makes the panel useful from the moment the file is opened, not just after a run.

### Limitations

- Watch points must be set before running — no pause/resume mid-execution
- Process must complete (or error) before all values are visible
- Constants (`#`) can be resolved statically without running; variables require execution

---

## TI and Rules Autocomplete

Monaco has a first-class autocomplete and signature help API — the same mechanism powering VS Code IntelliSense. Three features stack on each other, all fed by a single function catalog.

### Feature 1 — Function autocomplete

Type `Cell` and matching functions appear with parameter previews. Selecting one inserts a snippet with tab stops on each parameter.

```text
CellGetN(cube, e1, e2, ...)
CellGetS(cube, e1, e2, ...)
CellPutN(value, cube, e1, ...)
CellPutS(value, cube, e1, ...)
CellIsUpdateable(cube, e1, ...)
```

### Feature 2 — Signature help

As soon as `(` is typed after a function name, the parameter tooltip appears and tracks which parameter the cursor is on as the developer tabs through.

```text
!rev = DB( Revenue, !entity, !period, !version )
           ───────
           cube: String
```

### Feature 3 — Context-aware completions

Completions that are specific to the current file and connected server:

| Trigger | Completions shown |
| ------- | ----------------- |
| `!` | All variables already declared in this TI process |
| `#` | All constants declared in the Parameters section |
| `DB('` | Cube names fetched from the connected dev server |
| `ATTRS('` | Dimension names fetched from the connected dev server |

### The function catalog

The work is building a JSON catalog of every TI and Rules function — their parameters, types, and descriptions. The function set is fixed and well-documented; this is a one-time build.

```json
{
  "CellGetN": {
    "description": "Returns a numeric value from a cube cell",
    "params": [
      { "name": "cube",     "type": "String", "description": "Cube name" },
      { "name": "element1", "type": "String", "description": "Element for first dimension" }
    ],
    "returns": "Numeric",
    "variadic": true,
    "language": "tm1ti"
  },
  "DB": {
    "description": "Returns a numeric value from a cube (Rules)",
    "params": [
      { "name": "cube",     "type": "String" },
      { "name": "element1", "type": "String" }
    ],
    "returns": "Numeric",
    "variadic": true,
    "language": "tm1rules"
  }
}
```

The catalog is reused across multiple features:

- Autocomplete and signature help in the TI and Rules editors
- Static analysis in the debugger Variables panel (resolve constants without running)
- The AI explain feature in the Rules Builder (function context for the prompt)
- Future: hover documentation — mouse over any function to see its signature

---

## GitHub Authentication

Git is the foundation of this IDE — every save, every deploy, every audit trail runs through it. The auth model must be production-grade, not bolted on.

### Why not a shared token

A single org-wide GitHub token stored in `.env` is a single point of failure. If the IDE server is compromised, every repo in the organisation is exposed. IBM's PAW takes a similar raw credential approach (SSH keys or PATs per session) and carries the same risk — plus a known attribution problem where commits appear as "Admin" rather than the actual developer.

### Per-developer GitHub OAuth

Each developer authenticates with their own GitHub account via OAuth. The IDE is registered as a GitHub OAuth App.

```text
First-time setup:
  Settings → GitHub → [Connect GitHub Account]
          ↓
  Standard GitHub OAuth flow
          ↓
  Developer approves — IDE receives token scoped to their account
          ↓
  Token stored server-side in their session only
          ↓
  Transparent from that point — commit, push, PR from IDE normally
```

**What this gives:**

| | Shared token | Per-developer OAuth |
| -- | -- | -- |
| Server compromised | All repos exposed | One developer's access exposed |
| Developer leaves | Manual token revocation | Revoke GitHub access — done |
| Commit attribution | "Admin" (PAW's problem) | Developer's real GitHub identity |
| Permissions | Org-wide | Developer's actual GitHub permissions |
| Setup for developer | SSH key management | Click "Login with GitHub" |

### Token security

- Token stored server-side in the developer's session — never sent to the browser
- HttpOnly, Secure session cookies
- Session-scoped — cleared on logout, not persisted to disk
- Short-lived tokens: OAuth tokens can be refreshed — the IDE handles this transparently

### Path to GitHub App

For commercial deployment, the IDE should be registered as a **GitHub App** rather than an OAuth App. GitHub Apps use short-lived installation tokens (1-hour expiry), have fine-grained per-repo permissions, and appear as a named integration in GitHub's audit log. This is how professional integrations (Linear, Jira, Vercel) handle GitHub auth. The OAuth App approach above is the right starting point; GitHub App is the production-hardened upgrade.

---

## SQL Query Editor

When a TI process has an ODBC datasource, the SQL query is stored in metadata and edited through a form field in most TM1 tools. This IDE treats it as code — because it is.

### The problem with form-based SQL editing

A single-line text input or basic textarea for SQL has no syntax highlighting, no formatting, no error feedback. Developers write the query elsewhere, paste it in, and hope it works. Errors only surface when the process runs — which may load thousands of rows before failing.

### The approach — code-first in Prolog

The most practical approach for experienced TM1 developers is to define the datasource entirely in Prolog code:

```ti
DataSourceType = 'ODBC';
DataSourceNameForServer = 'SalesDB';
DataSourceNameForClient = 'SalesDB';
DataSourceQuery = 'SELECT CostCentre, Account, Amount FROM actuals WHERE year = ' | pYear;
```

This makes the datasource visible, version-controlled, and dynamic — parameters can drive the query, the DSN, or both. The IDE adds completions for all `DataSource*` system variables in Prolog to support this pattern.

### Monaco SQL editor for the query field

For processes where the SQL query is stored in metadata (not built in Prolog), the IDE provides a dedicated **SQL tab** in the process editor — a full Monaco editor with:

- SQL syntax highlighting and formatting
- The query editable directly, saved via PATCH to the process DataSource
- Ctrl+S saves like any other tab

This tab is only shown when `DataSource.Type === 'ODBC'`.

### The feedback loop problem

The biggest cost of SQL in TI is the iteration cycle:

```text
Write query → save process → run process → 50,000 rows load → error on row 12,847
→ find the bad row → fix query → repeat
```

A **Preview** button runs the query against the ODBC DSN and returns the first 50 rows as an inline table — before the process runs at all. Spot the wrong date format, the missing join, the null column on row 3 — in seconds rather than minutes.

Implementation requires the `odbc` npm package and unixODBC available on the server host (standard on Linux TM1 environments). The DSN name comes directly from `DataSource.dataSourceNameForServer`.

### Pilot run — process without writes

Beyond SQL preview, the IDE offers a **pilot run** — execute the full TI process against a capped row count with all cube write operations suppressed. The developer sees exactly what the process does without touching any data.

```text
Run options:
  ● Full run          — normal execution
  ○ Pilot run         — first [100] rows, no CellPut writes
  ○ Syntax check      — parse only, no execution
```

Implementation: before executing, the IDE injects a `pPilotRun` flag and wraps write operations in a conditional, or simply sets `DataSourceType = 'NULL'` after the data section filter to stop execution after N records. The process log still streams — the developer sees every variable assignment, every IF branch taken, every error — just no data lands in cubes.

This closes the feedback loop for the full TI lifecycle:

| Stage | Tool |
| ----- | ---- |
| SQL correct? | Preview — first 50 rows from DSN |
| Logic correct? | Pilot run — first N records, no writes |
| Ready to load? | Full run |

---

## MDX Editor and Live Preview

MDX in TM1 is used in two places that waste significant developer time: **subsets** (dynamic member selection) and **views** (cube data queries). The feedback loop in both cases is the same problem — write MDX, save, open in TM1 or PAW, rebuild, check result, find the error, repeat. Each cycle takes 5–10 minutes.

The IDE collapses this to seconds.

### The core insight

MDX errors are cheap to find if you can see the result immediately. A filter expression that returns zero members, a crossjoin that explodes to 10,000 rows, a typo in a dimension name — all of these are invisible until you see the output. Live preview surfaces them instantly.

### Subset editor

A dimension's subsets are accessible from the Explorer. Opening a subset shows:

```text
┌─ MDX (Monaco) ──────────────────────┬─ Members ──────────────────┐
│                                      │                            │
│  Filter(                             │  10110  Sales UK           │
│    [CostCentre].[CostCentre].Members,│  10120  Sales US           │
│    [CostCentre].[Active] = "Yes"     │  10130  Sales DE           │
│  )                                   │  ── 3 members ──           │
│                                      │                            │
│                          [Execute]   │               [Save]       │
└──────────────────────────────────────┴────────────────────────────┘
```

Execute hits the TM1 REST API and returns the member list. Edit the MDX, hit Execute, see the new result. No context switching.

### View editor

Opening a cube view shows the same pattern — MDX on the left, result grid on the right. Execute populates the grid. Save writes the view back to the server and to the cube's YAML file.

### MDX autocomplete

Monaco completion providers supply:

- Dimension names → `[DimensionName]`
- Hierarchy members → `[DimensionName].[ElementName]`
- MDX functions: `Filter`, `CrossJoin`, `TopCount`, `Order`, `Descendants`, `Ancestors`, `NonEmpty`
- TM1-specific MDX: `TM1FILTERBYLEVEL`, `TM1FILTERBYPATTERN`, `TM1SORT`, `TM1MEMBER`, `TM1DRILLDOWNMEMBER`

Dimension and element names come from the connected server — the same source used for TI and Rules completions.

### Why this matters

No TM1 tool offers live MDX preview. Arc has a visual subset builder (form-based, checkbox lists) that breaks down for anything non-trivial. A Monaco editor with live results is faster for developers who know MDX and accessible for those who are learning it — the result is immediate feedback either way.

---

## Global Search

A single search box that queries across all rules, all TI process code, and all object names on the connected server simultaneously.

### What developers search for

| Query | Governance value |
| ----- | ---------------- |
| Dimension name | Blast radius before restructuring — every cube and process that references it |
| Cube name | All DB() lookups into it, all CellPut writes to it |
| Element name | Every hardcoded reference — rules, TI string literals, parameter defaults |
| `CellPutN` / `CellPutS` | All write operations across the model — audit trail |
| `pYear` or any parameter | Every process that accepts or passes that parameter |
| Hardcoded year e.g. `2024` | Technical debt scan before year-end rollover |
| `ExecuteProcess` | All process orchestration chains |

### How search works

On search, the IDE fetches all cube rules and all process code sections (Prolog, Metadata, Data, Epilog) from the server, indexes them client-side, and returns results with:

- Object name and type (cube rule / TI prolog / TI data etc.)
- Line number and the matching line in context
- Click to open directly in the editor at that line

Results are cached for the session — subsequent searches are instant.

### Find and Replace

Beyond search, the IDE supports find-and-replace across all objects simultaneously:

- **Plain text replace** — rename a variable, path, or element reference everywhere it appears
- **Regex replace** — pattern-based replacements (e.g. update all `DB('OldCube'` to `DB('NewCube'`)
- **Scoped replace** — limit to rules only, or a specific TI section (Data tab only etc.)
- **Preview before commit** — diff view showing every affected line across every object before a single change is written
- **Confirmation log** — summary of what was changed, written to the session history

> Arc v5.0 ships find-and-replace as a developer convenience tool. Our implementation adds regex, scoped filtering, and a preview diff — making it safe enough for production use without a separate review step.

### Why this matters for governance

In Arc, finding every reference to a dimension means opening 50 cubes and 200 processes manually. A full day's work. Global search makes it a 2-second query. This directly supports:

- **Pre-change impact assessment** — know what breaks before you touch anything
- **Compliance audits** — produce a full list of write operations to a cube on demand
- **Onboarding** — a new developer can map an unfamiliar model in hours not weeks
- **Year-end rollover** — find every hardcoded year across the entire model instantly

---

## Rules Lineage Trace

When a rule references another cube via `DB()` or `DBS()`, and that cube itself has rules that reference further cubes, the developer has no way to see the full chain. This is one of the most common sources of confusion in complex TM1 models — a value is wrong and no one knows where it originates.

### The feature

Click any `DB()` call in the rules editor. A side panel opens showing the full dependency chain as a directed graph:

```text
Revenue
  └─ DB('Rates', !Time, 'Currency')
       └─ Rates has rules:
            └─ DB('FX', !Time, !Currency, 'Rate')
                 └─ FX — leaf (no further DB references)
```

### Two modes

**Trace forward** (default) — starting from the current cube, follow all `DB()` references downstream to their sources. Shows where values come from.

**Impact analysis** — flip the direction. Starting from any cube, show which cubes reference it upstream. Shows blast radius before changing a rule.

### Implementation

- The same `DB()` parameter parser used for autocomplete extracts the cube name from the first argument
- Rules for referenced cubes are fetched recursively (max 5 hops, lazy expansion beyond that)
- Rendered as a directed graph using React Flow (already in the stack)
- Inline in the rules editor as a toggleable side panel — no context switch required

### Python script lineage

TM1py scripts that write to or read from cubes create data dependencies that are completely invisible to rules-based lineage. They don't appear in TM1's own model metadata — they exist only in `.py` files on a file system somewhere.

Two common patterns the IDE needs to track:

**Direct TM1py writes** — Python scripts calling the REST API:

```python
tm1.cells.write_values('RevenueCube', cellset, ...)
tm1.processes.execute('load_actuals', parameters={...})
tm1.cubes.cells.execute_mdx_dataframe('SELECT ... FROM [RevenueCube]')
```

**TI-invoked Python** — a TI process shells out to Python which writes back to TM1. The TI process looks clean but the Python has hidden write targets.

The lineage graph handles this by adding Python scripts as a distinct node type. The IDE scans `.py` files in the project for `tm1py` call patterns, extracts cube and process references, and adds them as `[Python] script_name → CubeName` edges alongside the native TM1 edges.

This requires:

- A project directory for Python scripts (tracked in the git repo alongside YAML)
- A parser for common TM1py patterns (`write_values`, `execute_mdx`, `execute`, `get_value`)
- Python nodes rendered differently in the graph (distinct colour/icon) so the origin is clear

Without this, lineage in a mixed TM1+Python environment is incomplete — and most production TM1 environments are mixed.

### Why lineage matters

No TM1 tool — Arc, Architect, PAW — has this. In large enterprise models with 50+ cubes and complex lookup chains, lineage is invisible. This single feature justifies the IDE for senior developers who maintain complex models.

---

## What the IDE Must Enforce

| Rule | How IDE enforces it |
| ---- | ------------------- |
| Shared dimensions are read-only in modules | Dims received from Solution shown as locked, edit blocked |
| New modules must start from an approved base | No blank canvas — wizard requires mandatory base layer |
| Template Modules must be approved before publishing | Publish flow requires platform team review/merge |
| Object changes are always attributed | All saves, commits, deploys carry the logged-in developer's identity |
| Dev server is the only direct-write target | IDE blocks writes to staging/prod — those go through CI only |
