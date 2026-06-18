# TM1 IDE

A browser-based IDE for IBM Planning Analytics (TM1). Edit rules, TI processes, dimensions, subsets, views, chores, and cube data directly from your browser — no TM1 Architect or Perspectives required.

All TM1 communication routes through Planning Analytics Workspace (PAW), so there is no direct TM1 connection, no per-server port config, and no SSL to manage.

---

## Features

### Editors

| Editor | What it does |
|--------|-------------|
| **Rules Editor** | Monaco editor with TM1 rules syntax highlighting, live validation (CheckRules API) + static analysis (arg counts, keyword validity, line-accurate squiggles), **Check Now** button with green/red pass/fail glow, code formatter (3 structure presets), **#Region/#EndRegion folding**, lineage trace panel, **cell calculation trace** (shows full rule chain for any cell), snippet library |
| **TI Editor** | Four-tab editor (Prolog / Metadata / Data / Epilog), parameter editor, datasource editor with CSV file upload to TM1 server, run with output log, **error log viewer** (reads TM1 `.log` file inline after errors), static analysis (IF/WHILE/FOR/NEXT block structure, arg counts), **block folding**, debugger, snippets, pattern generators |
| **TI Debugger** | Set breakpoints in any section, capture variable values at each breakpoint, watch panel, section-by-section execution |
| **Dimension Editor** | Hierarchy tree with drag-style CRUD, attribute grid, element search, bulk CSV import, attribute definition management |
| **Subset Editor** | MDX code view + visual element tree, static/MDX save, MDX preview, ghost children |
| **View Editor** | Native and MDX view builder, cell grid with inline writeback, save/save-as, **auto-refreshes when rules for the same cube are saved**, **cell right-click context menu** — write value inline, rule trace (RULE/CONSOLIDATED/BASE/FEEDER badge + rule chain), transaction log for the intersection, cell annotations (add/delete), copy intersection as MDX tuple, open rules editor |
| **Guided MDX Builder** | Axis-by-axis view builder, subset filter builder, MDX execution |
| **Chore Editor** | Schedule editor, step list, activate/deactivate/execute on demand |
| **Cube Editor** | Create and delete cubes, dimension assignment |
| **SQL Editor** | External database queries (SQL Server, PostgreSQL, MySQL, SQLite), schema browser, saved queries, post SQL as TI datasource |
| **MDX Sandbox** | Ad-hoc MDX execution with result grid |
| **Deploy Panel** | Change set → diff vs Prod baseline → package → risk check → deploy to target server |
| **Deploy History** | Archive log of past deployments with timestamps and object counts |

### Explorer (Left Sidebar)

Browse and manage all TM1 objects: cubes, dimensions, subsets, views, processes, chores. Full CRUD for every object type — create, rename, delete. Inline `+` buttons to add objects without leaving the explorer.

### Tab System & Split Panes

- **Drag to reorder** tabs within a group
- **Right-click context menu** on any tab: Split Right, Split Down, Move to other pane, Close others, Close to right, Close
- **Arrow button** on tab hover — instantly send a tab to the other pane
- **Split Right** (`⊟`) — side-by-side panes; **Split Down** (`⊞`) — stacked panes
- **Toggle layout** button when 2+ panes are open — switch between horizontal and vertical without closing panes
- Split direction is persisted across sessions
- Useful pattern: open a view in one pane, rules in the other (stacked) — save rules and the view auto-refreshes below

### Cross-Object Search

`Ctrl+Shift+F` opens a full-text search across all rules files and TI process code on the connected server simultaneously.

### Autocomplete

Context-aware Monaco autocomplete in both Rules and TI editors:
- **Cube name** — lists server cubes, expands to full snippet with dimension tab stops for cell functions (`DB()`, `CellPutN()`, etc.)
- **Dimension name** — lists server dimensions for dimension-first functions (`DimensionElementInsert()`, `ELCOMP()`, etc.)
- **Function keywords** — snippet completions for ~40 verified TI functions and 6 Rules functions with correct parameter signatures (sourced from IBM TM1 Reference)

### Function Catalog Maintenance

Three catalogs control autocomplete, signature help, and syntax validation across Rules, TI, and MDX. **All relevant catalogs must be updated when adding a new function.**

| Catalog | File | Language | Purpose |
|---------|------|----------|---------|
| `RULES_CATALOG` | `client/src/lib/tm1-completion.js` | Rules | Param-context autocomplete + arg count info for `rules-validator.js` |
| `TI_CATALOG` | `client/src/lib/tm1-completion.js` | TI | Param-context autocomplete + arg count info for `ti-validator.js` |
| `TM1_FUNCTIONS` | `client/src/lib/tm1-functions.js` | Rules + TI | Name completions, signature help, Monarch highlight, metadata |
| `MDX_CATALOG` / `MDX_FUNCTIONS_FLAT` | `client/src/lib/tm1-mdx-catalog.js` | MDX | Function autocomplete, signature help, arg count info for `mdx-validator.js` |

**Rules of thumb:**
- `RULES_CATALOG` / `TI_CATALOG` use param type arrays: `['cubename', 'element*']` where `*` = "1 or more"
- `TM1_FUNCTIONS` uses structured objects with `description`, `params[]`, `returns`, `variadic`, `language`
- Every `TM1_FUNCTIONS` entry with `language: 'rules'`/`'both'` must also be in `RULES_CATALOG`
- Every `TM1_FUNCTIONS` entry with `language: 'ti'`/`'both'` should also be in `TI_CATALOG`
- `MDX_FUNCTIONS_FLAT` is derived from `MDX_CATALOG` via `.flatMap(c => c.fns)` — add entries there

**Validator wiring:**
- `rules-validator.js` imports `RULES_CATALOG` + `TM1_FUNCTIONS` — validates functions/args in AST
- `ti-validator.js` imports `TI_CATALOG` + `TM1_FUNCTIONS` — validates functions/args per section
- `mdx-validator.js` imports `MDX_FUNCTIONS_FLAT` — validates functions/args client-side

All three feed into their respective editor components via Monaco `setModelMarkers`.

---

## Prerequisites

- Node.js 20+
- IBM Planning Analytics Workspace (PAW) — V11 (native auth) or V12 (Authentik SSO)
- One or more TM1 databases registered in PAW

---

## Setup

### 1. Install

```bash
git clone git@github.com:falconbi/tm1_ide.git
cd tm1_ide
npm install
cd client && npm install && cd ..
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PAW connection
PAW_HOST=http://192.168.x.x
PAW_USERNAME=admin
PAW_PASSWORD=your_password
PAW_AUTH_MODE=native          # "native" (PAW V11) or "authentik" (PAW V12)

# The TM1 server configured as the PAW Login Server in the PAW admin console.
# All PAW logins are validated against this server's }Clients — users must
# exist here to log into PAW. Check PAW Admin Console → Configuration →
# TM1 Login Server URI to find yours.
PAW_LOGIN_SERVER=24Retail

# Server port
PORT=8083

# Optional: AI-powered MDX generation
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Authentik SSO (PAW V12 only)
AUTHENTIK_HOST=http://192.168.x.x:9000
AUTHENTIK_USERNAME=akadmin
AUTHENTIK_PASSWORD=...
```

Add your TM1 servers to `config/servers.json`:

```json
[
  { "name": "Production" },
  { "name": "Development" }
]
```

### 3. Run

```bash
npm start
```

Open **http://localhost:8083**

### Development mode (with Vite HMR)

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — frontend with hot reload
cd client && npm run dev
```

Open **http://localhost:5173** for the Vite dev server.

After making client changes in development, rebuild for production:

```bash
cd client && npm run build
cp dist/assets/index-*.js ../static/assets/
cp dist/assets/index-*.css ../static/assets/
cp dist/index.html ../static/index.html
```

---

## Keyboard Shortcuts

### Global
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+F` | Global search across rules + TI code |
| `Ctrl+Shift+K` or `F1` | Keyboard shortcuts help |

### All Editors
| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+Enter` | Execute / Run / Refresh |
| `Ctrl+Shift+F` | Format document |
| `Ctrl+/` | Toggle comment |
| `Ctrl+D` | Select next occurrence |
| `Alt+↑ / ↓` | Move line up / down |
| `Ctrl+=` | Increase editor font size |
| `Ctrl+-` | Decrease editor font size |
| `Ctrl+0` | Reset editor font size |
| `Ctrl+F` | Find & Replace |

### Rules Editor
| Shortcut | Action |
|----------|--------|
| `Ctrl+K Ctrl+0` | Collapse all regions |
| `Ctrl+K Ctrl+J` | Expand all regions |
| `Ctrl+Shift+O` | Go to symbol (#Region) |

---

## Project Structure

```
tm1_ide/
├── server.js                     # Express backend — all API routes
├── core/
│   ├── tm1_client.js             # TM1 REST client (proxies through PAW)
│   ├── paw_connect.js            # PAW session auth + CSRF caching
│   ├── sql_client.js             # External SQL connections
│   └── mdxBuilder.js             # MDX query construction helpers
├── client/                       # React + Vite frontend
│   └── src/
│       ├── App.jsx               # Root layout, global keyboard handlers
│       ├── store/                # Zustand: tabs, server selection, UI state
│       ├── hooks/useApi.js       # All TanStack Query data hooks
│       ├── components/           # One file per editor/panel
│       └── lib/                  # Monaco languages, completions, formatters
├── static/                       # Built frontend (served directly)
├── config/
│   ├── servers.json              # TM1 server list
│   ├── forge.json                # Workspace state (open tabs, server)
│   ├── sql-connections.json      # External SQL connections
│   └── sql-queries.json          # Saved SQL queries
└── docs/
    ├── Planning Analytics.postman_collection.json   # IBM REST API reference
    └── STATUS.md                 # Current development status
```

---

## Architecture

```
Browser  ←→  Express (server.js)  ←→  PAW  ←→  TM1 Server
```

- The backend never connects to TM1 directly — all calls go through PAW at `/api/v0/tm1/{server}/api/v1/`
- PAW handles TM1 authentication; the IDE authenticates with PAW using the credentials in `.env`
- `core/tm1_client.js` wraps every TM1 API call — routes call client methods, never the API directly
- The frontend uses TanStack Query for all server state — all cache keys include the server name

---

## Multi-User Login

The IDE supports multiple simultaneous users, each authenticating through PAW with their own credentials.

### How It Works

```
User  →  IDE Login Page  →  POST /api/auth/login  →  PAW session cookie  →  TM1 REST API calls
```

- Each login creates a **per-user PAW session** stored in `core/paw_connect.js` (keyed by UUID token, auto-refreshed on expiry)
- All subsequent TM1 API calls use that user's session — TM1 authorizes operations based on the authenticated user's `}Clients` group membership
- Each user gets their own **active change set** per server — no audit trail collisions

### PAW Authentication Mode

The IDE adapts to your PAW configuration:

| `PAW_AUTH_MODE` | PAW Config | Login Flow |
|-----------------|-----------|------------|
| `native` | Authentication Mode = **TM1** | PAW validates credentials against TM1 `}Clients` via the TM1 REST API (HTTPPortNumber). Works with PAW V11. |
| `authentik` | Authentication Mode = **Authentik SSO** | PAW delegates auth to an external Authentik provider. Used with PAW V12. |

When PAW is in **TM1 authentication mode**, all user accounts come from the TM1 `}Clients` dimension — there is no separate PAW user store.

### PAW Login Server

PAW validates all logins against one specific TM1 server — the **TM1 Login Server** — configured in the PAW Admin Console under **Configuration → TM1 Login Server URI**. Users must exist on that server's `}Clients` to log into PAW. Users created on any other TM1 server are invisible to PAW authentication.

Set `PAW_LOGIN_SERVER` in `.env` to the name of that server (must match exactly how it appears in `config/servers.json`). All User Management operations in the IDE always target this server regardless of which workspace server is currently selected.

### Creating Users

Open the **User Management** panel (shield icon in the header). Create users with:

- Username + Password
- Display name (optional)
- Group membership (defaults to `ADMIN`)

Under the hood, the IDE uses the TM1 REST API (`POST /Users`) to create the account with a password set against `PAW_LOGIN_SERVER`.

### Workspace Activation

New users **must log into the PAW workspace directly** (`http://paw-host`) at least once before they appear in the PAW Admin Console. PAW creates a workspace profile on first login. After that, the user can log into the IDE or PAW interchangeably with the same credentials.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Authenticate with PAW, returns session token |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/users` | List TM1 users |
| `POST` | `/api/users/provision` | Create user with password + groups |
| `PATCH` | `/api/users/:name` | Update user (enable/disable, friendly name) |
| `DELETE` | `/api/users/:name` | Delete user |
| `POST` | `/api/users/:name/password` | Reset password |
| `GET` | `/api/groups` | List TM1 groups |

---

## Provisioning a New TM1 Server Instance

To set up a new Dev or Test TM1 instance on Windows, use the included PowerShell script:

```powershell
.\tools\provision-tm1-server.ps1
```

The script prompts for the instance name, port numbers, and directory paths, generates a `tm1s.cfg` from an existing server's config, and creates the required directory structure (`Data\`, `Logs\`, `Files\Scripts\`, `Files\Import\`, `Files\Export\`). After running it, open Cognos Configuration, point it at the new root directory, and start the instance.

See [docs/provision-tm1-server.md](docs/provision-tm1-server.md) for full instructions.

---

## Deployment Pipeline (tm1deploy)

The IDE includes a built-in CI/CD pipeline for promoting changes from Dev to Prod. The full workflow is available in the browser — no CLI required.

### Concept

Every save in the IDE is logged to a **Change Set** (named work session). When you're ready to deploy, the pipeline compares your changes against a baseline snapshot of **Prod** (the target), not Dev. This ensures that only objects which have actually changed relative to Prod are packaged — and that nothing is deployed if Prod has drifted since the baseline was taken.

### Flow Overview

```
           ①                           ②                        ③
  ┌─────────────────┐         ┌──────────────────┐       ┌─────────────────┐
  │  Seed baseline   │         │  Align Dev        │       │  Work in Dev     │
  │  from Prod       │────────→│  to match Prod    │──────→│  via change set  │
  │  (snapshot)      │         │  (provision)      │       │  (IDE tracks)    │
  └─────────────────┘         └──────────────────┘       └────────┬────────┘
                                                                  │
                                                                  ▼
           ④                           ⑤                           ⑥
  ┌─────────────────┐         ┌──────────────────┐       ┌─────────────────┐
  │  Diff Dev vs     │         │  Drift re-check   │       │  Risk + Deploy   │
  │  Prod baseline   │────────→│  Prod hasn't      │──────→│  to Prod         │
  │  (package)       │         │  changed?         │       │                  │
  └─────────────────┘         └──────────────────┘       └─────────────────┘
```

### Step ① — Provision Dev from Prod

Before starting work, align Dev to match Prod's current state:

```powershell
.\tools\provision-tm1-server.ps1 -TemplateCfg "\\prod-server\tm1s.cfg"
```

This creates a Dev instance with the same config and provisions all TM1 objects
(cubes, dimensions, rules, processes, subsets, views). **This script does not
exist yet — it needs to be built.** Currently Dev is set up manually or from
a template config.

### Step ② — Seed the Baseline from Prod

Seed by running the deploy CLI against your Prod server:

```bash
node tools/tm1deploy/bin/tm1deploy.js seed Production
```

This snapshots Prod's entire object state into `.tm1baseline/snapshot.json`.
Every diff from this point forward compares against this reference.

Best practice: re-seed after every successful deployment to Prod so the
baseline always reflects what's live.

### Step ③ — Work in a Change Set

Click the **Clock** icon in the header → name the change set → **Start**.

Everything saved in the IDE while the change set is active gets logged.
Green indicator dots appear in the Explorer sidebar on every changed object.
Close the change set when your work is done.

Each developer with their own PAW login gets their **own active change set**
per server — no collision in the audit trail.

### Step ④ — Diff & Package

Open the **Change Sets** panel → hover the change set row → click the green
**Rocket**. The Deploy Panel opens. Step 1 (Diff) compares your session's
logged changes against the Prod baseline:

| Outcome | Meaning |
|---------|---------|
| `MATCH` | Changed in Dev, verified against Prod baseline — ready to deploy |
| `NEW` | Object exists on Dev but not in Prod baseline (e.g. new cube) |
| `DRIFT` | Dev's current state differs from the last IDE save — re-save or investigate |
| `UNCHANGED` | Object in the session is the same as the Prod baseline — nothing to deploy |
| `MISSING` | Object in baseline but not found on Dev — possibly deleted |
| `ERROR` | Fetch failed |

Step 2 (Package) fetches `MATCH` + `NEW` objects from Dev and writes them to
a `packages/` folder with a manifest. Drift and missing objects are skipped.

### Step ⑤ — Drift Re-check (not yet implemented)

Before the package can proceed to deployment, a **drift re-check** runs against
the Target server (Prod). For each object in the package, Prod's current state
is fetched and compared against the baseline snapshot:

- **All match** → Prod hasn't changed since seeding → proceed to risk/deploy
- **Any differ** → Prod has drifted. Those objects are flagged as
  `TARGET_DRIFT` and **block deployment**. The developer must:
  1. Re-seed the baseline from Prod
  2. Re-align Dev to match the new baseline
  3. Re-apply their changes on top

This prevents silent overwrites of Prod changes.

> **Drift check between any environment pair.** The same drift comparison can
> validate that Test is still aligned to the Prod baseline before running
> user acceptance testing. If Test has drifted from Prod, passing tests there
> doesn't guarantee Prod behaves the same way. A drift check between Test
> and the baseline tells you whether Test is a faithful copy of Prod.

### Step ⑥ — Risk & Deploy

Step 3 (Risk): Select the target server (Prod). Automated checks run:
rules syntax errors → broken dependencies → chore conflicts (running chores
containing changed processes) → structural impact (elements removed).

Returns `BLOCKER` / `WARNING` / `INFO`. Blockers prevent deployment.

Step 4 (Deploy): Confirm and push. Objects are written in dependency order:
attributes → dimensions → cubes → rules → subsets → views → processes.

### CLI (optional)

The same pipeline is available as a CLI for scripting and CI use:

```bash
node tools/tm1deploy/bin/tm1deploy.js seed <prod-server>
node tools/tm1deploy/bin/tm1deploy.js diff <session-name>
node tools/tm1deploy/bin/tm1deploy.js package <session-name>
node tools/tm1deploy/bin/tm1deploy.js risk <package-dir> <target-server>
node tools/tm1deploy/bin/tm1deploy.js deploy <package-dir> <target-server>
```

---

## IBM REST API Reference

The full IBM Planning Analytics REST API is documented in `docs/Planning Analytics.postman_collection.json`. This covers all endpoint groups: Dimensions, Cubes, Processes, Chores, Views/MDX, Subsets, Sessions, Transactions, Jobs, ErrorLogFiles, Metrics, Configuration, File Management, GIT integration, and PAW Workspace management.

---

## Status

Active development. Core IDE features are complete and production-stable. In-progress work tracked in `docs/STATUS.md`.
