# TM1 IDE — Build Plan

## Vision

A browser-based IDE for TM1 model development where:
- Every TM1 object is defined in YAML files in a git repository
- The IDE edits those files, not the TM1 server directly
- Changes are reviewed via GitHub pull requests before deployment
- CI/CD deploys on merge — TM1 becomes a deployment target, not a source of truth
- Full data audit trail via DuckDB time travel
- TM1py Python scripts managed alongside model definitions
- All users have admin rights — attribution not restriction is the security model

---

## The Workflow

```
Developer opens IDE
  → opens a project (one TM1 module = one git repo)
  → browses live TM1 server or local YAML/script files
  → makes changes (rules, dimensions, processes, Python scripts)
  → IDE shows diff vs git HEAD
  → commits to a branch
  → pushes to GitHub
  → opens PR — CI runs diff/validate as PR comment
  → merge to main → GitHub Action deploys to TM1
```

---

## Architecture

```
Browser (IDE)
  ↓ HTTP / WebSocket
Node.js/Express server
  ├── core/paw_connect.js    → PAW V11 session auth
  ├── core/tm1_client.js     → TM1 REST via PAW proxy
  ├── core/git_client.js     → local git (simple-git)
  ├── core/github_client.js  → GitHub API (Octokit)
  ├── core/fs_model.js       → read/write YAML + scripts
  ├── core/db_client.js      → DuckDB in-process
  └── tm1_deploy/            → diff + apply engine

Projects (each is a separate git repo)
  └── my_apportionment/
        ├── project.yaml         ← module definition
        ├── models/
        │     ├── dimensions/
        │     ├── cubes/
        │     ├── rules/
        │     ├── processes/
        │     └── chores/
        ├── scripts/             ← TM1py Python scripts
        ├── data/
        │     └── snapshots.duckdb  ← time travel + audit
        ├── docs/
        ├── tests/
        └── .github/
              └── workflows/
                    └── deploy.yml

GitHub
  ├── remote repo per module
  ├── PR reviews
  └── Actions CI → deploy on merge
```

---

## Source of Truth

**YAML files are the source of truth — not the TM1 server.**

```
Bootstrap (one-time): TM1 server → export → YAML files → git commit
Day-to-day:           edit YAML → commit → deploy → TM1 server
```

The IDE shows two views for any object:
- **Live**: what is currently on the TM1 server
- **Code**: what the YAML definition says

Diff between them shows what would change on next deploy.

---

## Project Structure

Each TM1 module is a project. A project is a git repository with a `project.yaml`:

```yaml
name: apportionment
version: 1.0.0
description: Cost apportionment module

server:
  dev:     apport_dev
  staging: apport_staging
  prod:    apport_prod

depends_on:
  - repo: falconbi/tm1_core
    objects:
      - dimensions/entity
      - dimensions/time

python:
  version: "3.11"
  packages:
    - tm1py
    - pandas

deploy:
  branch_map:
    develop: dev
    staging: staging
    main:    prod
```

The IDE sidebar shows all open projects with their active environment:

```
PROJECTS
▾ apportionment    ● dev
  ├── Models
  ├── Scripts
  ├── Data
  ├── Docs
  └── Tests

▾ tm1_core         ● prod
  └── Models

[+ New Project]  [⊕ Open Project]
```

---

## Authentication and Audit

### Security model — attribution not restriction

All IDE users get full admin access to all TM1 servers. There are no per-user permissions. The security model is a complete audit trail — every action is attributed to a named user.

**Login:**
- Each developer has their own username and password
- Simple login form + server-side session cookie (8 hour expiry)
- Credentials stored in `.env` as `IDE_USERS=james:pass1,dev2:pass2`
- No password reset, no MFA, no user management UI

**Three audit layers:**

| Layer | What it tracks | Where stored |
|-------|---------------|-------------|
| Git commits | Every model change with author, timestamp, diff | GitHub — immutable |
| DuckDB changes | Every TM1 data write, old/new value, user | `}TransactionLog` → DuckDB |
| IDE session log | Every action taken — save, deploy, execute, export | Server log file |

**User identity flows through everything:**
- Login session tags all actions with the developer's name
- Git commits use their name: `git commit --author "James <james@...>"`
- DuckDB change records include IDE username
- TI process executions logged with who triggered them

The result: a complete immutable record of who changed what and when — at both the model structure level (git) and the data level (DuckDB).

---

## Build Phases — Recommended Order

### Why this order?

Each phase unlocks the next. Project structure is the container everything lives in — nothing else can be built cleanly without it. Model export seeds the container with real content. Git makes that content versionable. Everything else builds on top of that foundation.

---

### Phase 1 — Foundation ✅
- Express server, PAW auth, TM1 client
- Explorer tree, Monaco rules editor
- Save rules back to TM1

**Value:** Browse and edit rules live on any TM1 server.

---

### Phase 2 — Project Structure

**Why first:** Everything else lives inside a project. Without this we're building on shifting ground — files have no home, git has no repo, the deploy pipeline has no target.

Define `project.yaml` schema, file system layout, and the Projects panel in the IDE sidebar:
- New project wizard: name, server targets, GitHub repo
- Open existing project from local path or GitHub URL
- Project switcher in sidebar
- Active environment indicator (dev / staging / prod)

New file: `core/fs_project.js` — read/write `project.yaml`, resolve project paths.

**Value:** Projects have a defined structure. Everything else can be built inside them.

---

### Phase 3 — Model Export

**Why second:** You can't version control nothing. Export seeds each project with real content from the live TM1 server — dimensions, cubes, rules, processes — all as YAML files.

```
IDE → [Export from server] → YAML files in project/models/
```

Export one object or the whole server. Writes clean YAML that the deploy engine can read back.

New file: `core/fs_model.js` — read/write YAML model files, generate from TM1 API responses.

**Value:** Project has real content. Ready to version control.

---

### Phase 4 — Git Integration

**Why third:** Once files exist, track them. This is the core of models-as-code — every change is a commit with a message and an author.

Local git operations via `simple-git`:

```
GET  /api/git/status     → changed files
POST /api/git/stage      → git add
POST /api/git/commit     → git commit
POST /api/git/push       → git push
GET  /api/git/diff       → diff vs HEAD
GET  /api/git/branches   → branch list
POST /api/git/branch     → create + checkout
```

IDE gains a **Source Control** panel:
- Changed files with M / A / D indicators
- Stage / unstage individual files
- Commit message input + commit button
- Branch selector + push button

**Value:** Full git workflow from inside the IDE. No terminal needed.

---

### Phase 5 — Complete Editors

**Why fourth:** With project structure, content, and git in place — the editors become genuinely useful. Every save writes to both TM1 and the YAML file. Every change is trackable.

**TI Process editor** (highest value — used daily)
- 4 Monaco tabs: Prolog / Metadata / Data / Epilog
- Parameters panel
- Execute button → stream output to terminal panel
- Save → writes to TM1 AND updates YAML

**Dimension editor**
- Visual hierarchy tree (drag-drop, add/remove elements)
- Attribute table (define + set values)
- YAML panel synced with visual editor
- Save → updates TM1 AND writes YAML

**Cube viewer**
- Server → Cube → View dropdowns
- Execute view → render grid
- Editable leaf cells → PATCH to TM1
- Read-only consolidated cells

**TM1py Script editor**
- Monaco Python editor
- Run button → spawns Python subprocess → streams output to terminal
- venv per project with TM1py installed

**Value:** IDE covers all TM1 object types. Full read/write for everything.

---

### Phase 6 — DuckDB Data Layer

**Why fifth:** Once the model is stable and version controlled, add data versioning on top. Requires the project structure to know where `data/snapshots.duckdb` lives.

```javascript
const db = new Database('project/data/snapshots.duckdb')
```

**Snapshot table** — cube data over time:
```sql
CREATE TABLE snapshots (
    server       VARCHAR,
    cube         VARCHAR,
    view         VARCHAR,
    snapshot_date DATE,
    captured_at  TIMESTAMP,
    elements     VARCHAR,   -- JSON array
    value        DOUBLE
)
```

**Changes table** — from `}TransactionLog`:
```sql
CREATE TABLE changes (
    server      VARCHAR,
    cube        VARCHAR,
    user        VARCHAR,
    changed_at  TIMESTAMP,
    elements    VARCHAR,
    old_value   DOUBLE,
    new_value   DOUBLE,
    change_type VARCHAR    -- INPUT, SPREAD, PROCESS
)
```

IDE gains a **Data** panel per project:
- Time travel query: pick cube + date → see historical data
- Change audit: pick cube + cell → see who changed it and when
- Delta view: compare two dates side by side

**Value:** Complete audit trail. Who changed what data and when — permanently archived, TM1 transaction log never rolls over.

---

### Phase 7 — GitHub Integration

**Why sixth:** Git works locally first, then extend to GitHub. Adds PR workflow and remote collaboration.

```
POST /api/github/pr      → open pull request
GET  /api/github/prs     → list open PRs
GET  /api/github/pr/:id  → PR detail + CI status
```

`.env` additions:
```
GITHUB_TOKEN=ghp_...
```

PR creation from IDE:
1. Push branch
2. Click "Open PR"
3. PR body auto-includes `tm1_deploy diff` output

**Value:** Changes require review before hitting prod. Full team workflow.

---

### Phase 8 — CI/CD

**Why last:** Depends on everything above. GitHub Actions runs the deploy engine on merge.

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: node tm1_deploy/cli.js diff  --server $SERVER
      - run: node tm1_deploy/cli.js apply --server $SERVER
    env:
      PAW_HOST:     ${{ secrets.PAW_HOST }}
      PAW_USERNAME: ${{ secrets.PAW_USERNAME }}
      PAW_PASSWORD: ${{ secrets.PAW_PASSWORD }}
```

Branch → server mapping from `project.yaml`:
```
develop → dev server
staging → staging server
main    → prod server
```

**Value:** Zero-touch deployment. Merge PR → TM1 updated automatically.

---

### Phase 9 — CubeMap + PAW Tree Integration

**Why last:** Both tools already work standalone. Folding them in is additive — by this phase auth, projects, git, and DuckDB are all in place, making the integration much richer than the standalone versions.

**Activity bar gains two new tabs:**

```
⬜ Explorer        ← live server browse
📁 Projects        ← models as code
⎇  Source Control
▦  CubeMap         ← folded in here
🌳 PAW Tree        ← folded in here
```

**CubeMap — two modes:**

```
Live mode:  reads from TM1 server → shows what is deployed now
Code mode:  reads from YAML files → shows what will be deployed
```

Code mode renders the full dependency graph — cubes, dimensions, rules, feeders — directly from the YAML files in the project. No server connection needed.

**Visual diff — code vs live side by side:**

```
grey nodes   = unchanged
green nodes  = added in YAML, not yet deployed
red nodes    = removed in YAML, still on server
yellow nodes = modified — YAML differs from live
```

A PR reviewer sees exactly what the model change does to the dependency graph — visually — before approving the merge.

**CubeMap as pre-deploy validator:**

Reading from YAML enables validation before anything touches TM1:
- Cube references a dimension that doesn't exist in the model → error
- Rules file references a cube not defined in YAML → warning
- Circular feeder dependencies → error
- Dimension referenced by multiple cubes — shows impact of changing it

**Cross-tool links (the real value):**

| From | To | Action |
|------|----|--------|
| CubeMap node (cube) | Editor | Click cube → opens rules file in Monaco |
| CubeMap node (dimension) | Editor | Click dimension → opens YAML in dimension editor |
| PAW Tree book | CubeMap | Click book tab → highlights referenced cube in CubeMap |
| PAW Tree book | Editor | Click book tab view → jumps to rules file |

These connections don't exist anywhere in IBM's tooling today.

**PAW Tree inside IDE:**

- Same session, no separate login
- Activity tracking writes to the project's DuckDB instance
- Click a PAW book → shows which YAML file defines the view it uses
- Governance dashboard integrated with project diff — orphaned books that reference objects not in any YAML

**Value:** Complete picture of the TM1 system — structure, code, content, and data — in one tool with full cross-navigation.

---

## Build Order Summary

| Phase | What | Why this order | Value unlocked |
|-------|------|----------------|----------------|
| 1 | Foundation | Starting point | Browse + edit rules ✅ |
| 2 | Project structure | Container for everything else | Projects have a home |
| 2b | Auth + audit | Before opening to a team | Named users, full attribution |
| 3 | Model export | Seeds the container with content | Real YAML from TM1 |
| 4 | Git integration | Makes content versionable | Full git workflow |
| 5 | Complete editors | Useful now that git tracks saves | All object types covered |
| 6 | DuckDB data layer | Model stable, add data versioning | Time travel + audit trail |
| 7 | GitHub integration | Local git works, extend to remote | PR review workflow |
| 8 | CI/CD | Everything in place | Auto-deploy on merge |
| 9 | CubeMap + PAW Tree | All foundations ready | Visual lineage, pre-deploy validation, cross-tool links |

---

## npm Packages Needed

| Package | Phase | Purpose |
|---------|-------|---------|
| `simple-git` | 4 | Local git operations |
| `@octokit/rest` | 7 | GitHub API |
| `duckdb` | 6 | In-process analytical DB |
| `chokidar` | 3 | Watch YAML files for external changes |
| `js-yaml` | ✅ | Already installed |
| `ws` | ✅ | Already installed (WebSocket for terminal) |
