# TM1 IDE — Build Plan

## Vision

A browser-based IDE for TM1 model development where:
- Every TM1 object is defined in YAML files in a git repository
- The IDE edits those files, not the TM1 server directly
- Changes are reviewed via GitHub pull requests before deployment
- CI/CD deploys on merge — TM1 becomes a deployment target, not a source of truth

---

## The Workflow

```
Developer opens IDE
  → browses live TM1 server or local YAML files
  → makes changes (rules, dimensions, processes)
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
  ├── core/tm1_client.js     → TM1 REST via PAW proxy
  ├── core/git_client.js     → local git operations (simple-git)
  ├── core/github_client.js  → GitHub API (Octokit)
  ├── core/fs_model.js       → read/write YAML model files
  └── tm1_deploy/            → diff + apply engine

Local git repo (on IDE server machine)
  └── models/
        ├── module.yaml          ← module definition + dependencies
        ├── dimensions/
        ├── cubes/
        ├── rules/
        ├── processes/
        └── chores/

GitHub
  ├── remote repo
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

The IDE has two modes for any object:
- **Live view**: shows what is currently on the TM1 server
- **Code view**: shows the YAML definition in the repo

Diff between them shows what would change on next deploy.

---

## Build Phases

### Phase 1 — Foundation ✅
- Express server, PAW auth, TM1 client
- Explorer tree, Monaco rules editor
- Save rules back to TM1

### Phase 2 — Model Export (next)

Pull existing TM1 objects into YAML files:

```
IDE → Export → YAML
```

Endpoints needed:
- `GET /api/model/export?server=` — pull all objects, write YAML to repo
- `GET /api/model/export?server=&type=dimension&name=` — export one object

File system layer (`core/fs_model.js`):
- `readModel(dir)` — load all YAML from `models/`
- `writeModel(dir, objects)` — write YAML files
- `readRules(cube)` — read `models/rules/{cube}.rules`
- `writeRules(cube, text)` — write rules file

### Phase 3 — Git Integration

Local git operations via `simple-git`:

```
GET  /api/git/status          → which files changed
POST /api/git/stage           → git add file(s)
POST /api/git/commit          → git commit -m "message"
POST /api/git/push            → git push origin branch
GET  /api/git/diff            → diff vs HEAD
GET  /api/git/branches        → branch list
POST /api/git/branch          → create + checkout branch
```

IDE sidebar gains a **Source Control** panel (like VS Code):
- Changed files list with diff indicators (M, A, D)
- Stage/unstage
- Commit message box + commit button
- Push button
- Branch selector

### Phase 4 — GitHub Integration

GitHub API via Octokit:

```
POST /api/github/pr           → open pull request
GET  /api/github/prs          → list open PRs
GET  /api/github/pr/:id       → PR detail + status
```

`.env` additions:
```
GITHUB_TOKEN=ghp_...
GITHUB_REPO=falconbi/tm1_apportionment
```

PR creation flow from IDE:
1. Push branch
2. Click "Open PR" → IDE posts to GitHub API
3. PR body auto-includes a `tm1_deploy diff` summary

### Phase 5 — Complete Editors

Build remaining object editors in priority order:

**TI Process editor**
- 4 Monaco tabs: Prolog / Metadata / Data / Epilog
- Parameters panel (name, type, default value)
- Execute button → run process → stream output to terminal
- Save → writes process back to TM1 AND updates YAML

**Dimension editor**
- Visual hierarchy tree: drag-drop parent/child, add/remove elements
- Attribute table: define attributes, set values per element
- YAML panel: synced with visual editor, both editable
- Save → updates dimension on TM1 AND writes YAML

**Cube viewer**
- Server → Cube → View dropdowns
- Execute view → render grid (rows/columns from axis tuples)
- Editable leaf cells → PATCH back to TM1
- Read-only for consolidated cells

**Subset editor**
- Element picker: checkbox tree of hierarchy members
- MDX input for dynamic subsets
- Save as named subset on server

### Phase 6 — CI/CD

GitHub Actions workflow template committed to every model repo:

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: self-hosted   ← runs on RIG, has PAW network access
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: node -e "require('./tm1_deploy').diff('$SERVER')"
      - run: node -e "require('./tm1_deploy').apply('$SERVER')"
    env:
      PAW_HOST:     ${{ secrets.PAW_HOST }}
      PAW_USERNAME: ${{ secrets.PAW_USERNAME }}
      PAW_PASSWORD: ${{ secrets.PAW_PASSWORD }}
```

Branch strategy:
```
feature/add-entity-rollup  → dev server
staging                    → staging server
main                       → production server
```

### Phase 7 — Diff Panel

IDE shows pending changes at all times:

```
┌─────────────────────────────────┐
│ PENDING CHANGES                 │
│                                 │
│ ~ dimension  entity             │
│   add elements: [10140, 10150]  │
│                                 │
│ ~ cube  plan_BudgetPlan         │
│   rules file differs            │
│                                 │
│ [Deploy Now]  [Open PR]         │
└─────────────────────────────────┘
```

---

## New npm Packages Needed

| Package | Purpose |
|---------|---------|
| `simple-git` | Local git operations |
| `@octokit/rest` | GitHub API |
| `js-yaml` | Already installed |
| `chokidar` | Watch YAML files for external changes |

---

## File Structure (target)

```
tm1_ide/
├── server.js
├── core/
│   ├── paw_connect.js
│   ├── tm1_client.js
│   ├── git_client.js       ← Phase 3
│   ├── github_client.js    ← Phase 4
│   └── fs_model.js         ← Phase 2
├── tm1_deploy/
│   ├── loader.js
│   ├── diff.js
│   ├── apply.js
│   └── __main__.js
├── static/
│   └── ide.html
├── models/                 ← exported TM1 model YAML
└── config/
    └── servers.json
```

---

## Build Order Summary

| Phase | What | Value unlocked |
|-------|------|----------------|
| 1 | Foundation | Browse + edit rules live ✅ |
| 2 | Model export | Pull TM1 → YAML, start a repo |
| 3 | Git integration | Track changes, commit, push |
| 4 | GitHub integration | PR workflow, review before deploy |
| 5 | Complete editors | TI, dimensions, cube viewer |
| 6 | CI/CD | Auto-deploy on merge |
| 7 | Diff panel | Always-visible pending changes |
