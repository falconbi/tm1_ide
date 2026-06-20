# TM1 IDE

A browser-based IDE for IBM Planning Analytics (TM1). Edit rules, TI processes, dimensions, subsets, views, chores, and cube data directly from your browser — no TM1 Architect or Perspectives required.

All TM1 communication routes through Planning Analytics Workspace (PAW), so there is no direct TM1 connection, no per-server port config, and no SSL to manage.

---

## Features

### Editors

| Editor | What it does |
|--------|-------------|
| **Rules Editor** | Monaco editor with TM1 rules syntax highlighting, live validation (CheckRules API) + static analysis (arg counts, keyword validity, line-accurate squiggles), **Check Now** button with green/red pass/fail glow, code formatter (3 structure presets), **#Region/#EndRegion folding**, lineage trace panel, **cell calculation trace** (shows full rule chain for any cell), snippet library, **Feeders** button (`tm1.CheckFeedersForRules`), **post-save reference check** (dead cube/dimension warnings as amber toasts) |
| **TI Editor** | Four-tab editor (Prolog / Metadata / Data / Epilog), parameter editor, datasource editor with CSV file upload to TM1 server, run with output log, **error log viewer** (reads TM1 `.log` file inline after errors), static analysis (IF/WHILE/FOR/NEXT block structure, arg counts), **block folding**, debugger, snippets, pattern generators, **post-save reference check** (dead cube/dimension/process warnings as amber toasts), **Validate** toolbar button — tests every `TI_CATALOG` function against the live TM1 server and shows pass/fail (see Function Catalog Maintenance below) |
| **TI Debugger** | Set breakpoints in any section, capture variable values at each breakpoint, watch panel, section-by-section execution |
| **Dimension Editor** | Hierarchy tree with drag-style CRUD, attribute grid, element search, bulk CSV import, attribute definition management. AttrGrid toolbar has a **Refresh** button (re-fetches without closing the tab) and a per-column **→A** button on String-type attributes to convert them to Alias in one click — existing values are preserved via delete+recreate + bulk value copy |
| **Subset Editor** | MDX code view + visual element tree, static/MDX save, MDX preview, ghost children |
| **View Editor** | Native and MDX view builder, cell grid with inline writeback, save/save-as, **auto-refreshes when rules for the same cube are saved**, **Feeders** toolbar button (`tm1.CheckFeedersForRules` + amber zero-cell highlighting for leaf rule cells with zero value — likely missing feeders), **cell right-click context menu** (see below) |
| **Guided MDX Builder** | Axis-by-axis view builder, subset filter builder, MDX execution |
| **Chore Editor** | Schedule editor, step list, activate/deactivate/execute on demand |
| **Cube Editor** | Create and delete cubes, dimension assignment |
| **SQL Editor** | External database queries (SQL Server, PostgreSQL, MySQL, SQLite), schema browser, saved queries, post SQL as TI datasource |
| **MDX Sandbox** | Ad-hoc MDX execution with result grid |
| **Deploy Panel** | 5-step wizard: Diff (change set vs Prod baseline) → Package (fetch + manifest) → Risk (**drift check** then BLOCKER/WARNING/INFO analysis) → **Approve** (named sign-off with notes, required before deploy) → Deploy (dependency-ordered, dry-run option) |
| **Deploy History** | Permanent archive of every real deployment — approval record, manifest, deploy results, and **pre/post target snapshots** (state of each deployed object on the target before and after the push). Changed objects show a Diff button that opens the IDE diff viewer. |

### View Editor — Cell Right-Click Menu

Right-clicking any cell in the View Editor grid opens a fixed-position popup with the cube name, LEAF/CONSOLIDATED badge, and the full dimension:element coordinate strip. Each coordinate has a `→` link that opens the corresponding Dimension Editor tab.

| Panel | Visible on | What it shows |
| ----- | ---------- | ------------- |
| **Write** | Leaf cells only | Inline value entry — writes via `tm1.Update`, then auto-refreshes the view |
| **Trace** | All cells | Full rule chain: `Type` badge (RULE / CONSOLIDATED / BASE / FEEDER), rule statements, component breakdown with per-component values |
| **Feeders** | All cells | `tm1.CheckFeedersOfCell` result — lists all feeder sources, or an amber warning if none found |
| **Breakdown** | Consolidated cells | Direct children of each consolidated dimension member — sorted by absolute value with a contribution bar and percentage |
| **Leaves** | Consolidated cells | All N-level leaf descendants (BFS walk via full edge set, up to 100 queried, top 50 shown) — sorted by absolute value with contribution bar and percentage |
| **Log** | All cells | Transaction history for this intersection — last 30 writes with timestamp, user, old and new value |
| **Notes** | All cells | Cell annotations — view, add, or delete free-text notes attached to this intersection |
| **Copy** | All cells | Copies `dim: element` pairs and the MDX tuple `([Dim].[Dim].[Elem], ...)` to the clipboard |
| **Rules** | All cells | Opens the Rules Editor tab for the cube |

For **Breakdown** and **Leaves**, the server uses `getEdges()` (one call) to build the complete parent→children map for each consolidated dimension, then executes one MDX query per C-dimension to fetch the values. Other dimensions are held at their current member in the WHERE clause.

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

Context-aware Monaco autocomplete across all three TM1 languages:

- **Rules + TI — cube name** — lists server cubes, expands to full snippet with dimension tab stops for cell functions (`DB()`, `CellPutN()`, etc.)
- **Rules + TI — dimension name** — lists server dimensions for dimension-first functions (`DimensionElementInsert()`, `ELCOMP()`, etc.)
- **Rules + TI — function keywords** — snippet completions for all catalog functions with correct parameter signatures
- **MDX — function names** — completions from `MDX_CATALOG` using the function's `template` field as the snippet (with tab stops)
- **MDX — keywords** — `SELECT`, `FROM`, `WHERE`, `NON EMPTY`, `WITH MEMBER`, `BASC`, `BDESC`, etc.
- **All languages — signature help** — triggered on `(` — shows param names and descriptions from the catalog; active parameter highlights as you tab through

### Function Catalog

The function catalog is the intelligence layer that drives autocomplete, signature help, static validation, and hover documentation across all three TM1 languages. It is fully transparent and user-editable.

#### Catalog files

| Catalog | File | Language | Purpose |
|---------|------|----------|---------|
| `RULES_CATALOG` | `client/src/lib/tm1-completion.js` | Rules | Rich schema entries — drives param completions + `rules-validator.js` |
| `TI_CATALOG` | `client/src/lib/tm1-completion.js` | TI | Rich schema entries — drives param completions + `ti-validator.js` |
| `TM1_FUNCTIONS` | `client/src/lib/tm1-functions.js` | Rules + TI | Named-param signature help, Monarch highlighting, variadic flags |
| `MDX_CATALOG` | `client/src/lib/tm1-mdx-catalog.js` | MDX | Category-grouped MDX functions with templates and descriptions |

#### Rich catalog schema (RULES_CATALOG and TI_CATALOG)

Each entry is a structured object — not a bare param array:

```js
DIMSIZ: {
  params:      ['dimname'],          // param type tags; '*' suffix = repeating/variadic
  returnType:  'numeric',            // 'numeric' | 'string' | 'void' | 'any'
  description: 'Returns the number of elements in a dimension.',
  compat:      'both',               // 'both' | 'v11' | 'v12'
  deprecated:  null,                 // string message shown as amber squiggle, or null
  isStatement: false,                // true = cannot be used in an expression or assignment
}

CELLPUTN: {
  params:      ['value', 'cubename', 'element*'],
  returnType:  'void',
  description: 'Writes a numeric value to a cube cell.',
  compat:      'both',
  deprecated:  null,
  isStatement: true,                 // calling this in nV = CELLPUTN(...) would be wrong
}

HIERARCHYCREATE: {
  params:      ['dimname', 'hiername'],
  returnType:  'void',
  description: 'Creates an alternate hierarchy within a dimension.',
  compat:      'v12',                // PA 2.0 / TM1 12+ only — not available in classic V11
  deprecated:  null,
  isStatement: true,
}
```

**Param type tags:** `cubename` | `dimname` | `element` | `attribute` | `hiername` | `value` | `n` | `string` | `condition`. `*` suffix on the last tag means it repeats (variadic).

**`compat` values:**

- `both` — works in TM1 V11 (classic) and PA 2.0+ (V12)
- `v12` — PA 2.0 / TM1 12+ only. Primarily: all `ELEMENT*` hierarchy-aware functions, all `HIERARCHY*` functions, `DIMENSIONHIERARCHYCREATE`
- `v11` — classic TM1 only with no V12 equivalent (rare; user-correctable via Catalog admin)

#### Validator wiring

- `rules-validator.js` imports `RULES_CATALOG` + `TM1_FUNCTIONS` — validates function names, arg counts, and deprecated warnings in AST
- `ti-validator.js` imports `TI_CATALOG` + `TM1_FUNCTIONS` — validates per section with IF/WHILE/FOR block tracking
- `mdx-validator.js` imports `MDX_CATALOG` via `MDX_FUNCTIONS_FLAT` — validates MDX function names and arg counts

All three feed Monaco `setModelMarkers` in their respective editor components — squiggles appear before running.

**What validators catch:**

- Unknown function name → `error` squiggle
- Wrong argument count → `error` squiggle
- `deprecated: 'message'` set on catalog entry → `warning` squiggle with the deprecation message
- TI-only function used in Rules → `error` noting it's a TI function

#### Catalog Admin UI

The **book icon** in the header opens the Function Catalog panel — three tabs: TI Functions | Rules Functions | MDX Functions.

Each row shows: function name, description, params, return type (→ numeric/string/void), compat badge (Both/V11/V12), source (built-in/user). Deprecated functions show a strikethrough name and amber warning. Statement-only functions show a `stmt` badge.

**Editing:** click the compat dropdown to reassign any entry — useful when reviewing IBM docs and finding a function is V11-only or V12-only. Changes save to `config/function-catalog-overrides.json` on the server. The built-in catalog in source code is the base; overrides are merged on top at runtime.

**Adding functions:** name + param list + compat via the form at the bottom of each tab.

**Live validation:** the Validate button (TI and Rules tabs) tests every catalog entry against the connected TM1 server by creating a minimal temp process per function and checking whether TM1 accepts the syntax. Results overlay ✓ / ✗ badges per row. Temp processes are deleted immediately — no data is modified. Server endpoint: `POST /api/admin/validate-ti-functions`.

#### Catalog audit history

The `TI_CATALOG` was audited against the IBM Planning Analytics 2.0 function reference (via Cubewise, which mirrors IBM docs) in Jun 2026. Removed: `DimensionElementAttributeCreate`, `DimensionElementAttributeDelete` (do not exist in PA 2.0). Corrected: `AttrInsert(dim, attr, type)` / `AttrDelete(dim, attr)` for classic attribute management; `ElementAttrPutS(value, dim, hier, el, attr)` for hierarchy-aware writes.

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
# PAW connection (used when servers.json is a plain array — paw-native mode)
PAW_HOST=http://192.168.x.x
PAW_USERNAME=admin
PAW_PASSWORD=your_password

# The TM1 server PAW validates all logins against (PAW Admin Console →
# Configuration → TM1 Login Server URI). Must match a name in servers.json.
PAW_LOGIN_SERVER=Production

# Server port
PORT=8083

# Optional: AI-powered MDX generation
ANTHROPIC_API_KEY=sk-ant-...
```

Add your TM1 servers to `config/servers.json`. The simplest form is a plain array — the IDE defaults to `paw-native` using `PAW_HOST`:

```json
[
  { "name": "Production" },
  { "name": "Development" }
]
```

For multi-adapter or multi-PAW-host setups, use the structured form — see the Connection Adapters section under Multi-User Login.

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

The IDE supports multiple simultaneous users. Each login produces an isolated session token — all TM1 calls made during that session use that user's credentials, so TM1 `}Clients` group membership controls what each user can see and do.

- Each login creates a **per-user session** (UUID token, stored in memory, auto-refreshed on expiry)
- All TM1 API calls are routed through that user's session — no shared credentials
- Each user gets their own **active change set** per server — no audit trail collisions

### Connection Adapters

The adapter used for each server is determined by `config/servers.json` — not by any `.env` variable. Three adapters are available:

| Adapter | `servers.json` key | When to use |
| ------- | ------------------ | ----------- |
| `paw-native` | `"adapter": "paw-native"` | PAW V11 or V12 with TM1 native auth. Each user's PAW session is created on login with their own credentials. Default when `servers.json` is a plain array. |
| `direct-v11` | `"adapter": "direct-v11"` | Bypass PAW entirely — connect directly to the TM1 admin server (`HTTPPortNumber`). Useful when PAW is unavailable or not deployed. |
| `paw-oauth2` | `"adapter": "paw-oauth2"` | PAW V12 with Authentik/OAuth2. Uses a machine credential (client ID + secret) — not per-user. Suitable for service accounts or CI. |

**Simple setup** — plain array in `servers.json` routes all servers through `paw-native` using `PAW_HOST` from `.env`:

```json
[{ "name": "Production" }, { "name": "Development" }]
```

**Advanced setup** — use `connections` (PAW-based) or `adminHosts` (direct TM1) blocks:

```json
{
  "connections": [
    {
      "name": "paw-prod",
      "adapter": "paw-native",
      "pawHost": "http://192.168.1.37",
      "loginServer": "Production",
      "servers": ["Production", "Development"]
    }
  ],
  "adminHosts": [
    {
      "adapter": "direct-v11",
      "url": "http://192.168.1.10:5895",
      "servers": ["Staging"]
    }
  ]
}
```

### PAW Login Server

PAW validates all logins against one specific TM1 server — the **TM1 Login Server** — configured in the PAW Admin Console under **Configuration → TM1 Login Server URI**. Users must exist on that server's `}Clients` to log into PAW. Users created on any other TM1 server are invisible to PAW authentication.

Set `loginServer` on the relevant connection in `servers.json` (or `PAW_LOGIN_SERVER` in `.env` for the plain-array setup). All User Management operations always target this server regardless of which workspace server is active.

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

For **dimension** objects, the package includes:

- Full element list, edges, and attribute definitions
- **Element delta** — specific element names added and removed relative to the baseline, shown as green/red chips in the manifest UI
- `}ElementFormats_{dim}` — all element format strings (width, colour, font, etc.) read via MDX and written on deploy
- `}ElementAttributes_{dim}` — attribute values for all elements

When packaging a **rules** or **cube** object, the packager also checks whether a corresponding `}Picklist_{cube}` control cube exists on Dev. If it does and its cells have changed relative to the baseline (or it is new), the picklist cube is **automatically included** in the package as a `picklist-cube` object — no manual step required.

### Step ⑤ — Risk, Approve & Deploy

**Step 3 (Risk):** Select the target server (Prod) and click **Run Check**. The step runs two phases automatically:

**Phase 1 — Drift check.** For each packaged object, the IDE fetches its current state from the target and compares it against the baseline snapshot taken at seeding time:

- **All match** → Prod hasn't changed since seeding → Phase 2 runs immediately
- **Any differ** → Prod has drifted. A table shows each drifted object and what changed (e.g. "Rules changed on target since baseline"). **Deployment is blocked.** The developer must:
  1. Re-seed the baseline from Prod (Step 1 → Seed)
  2. Re-align Dev to the new baseline
  3. Re-package before retrying

This prevents silent overwrites of changes made directly on Prod (hotfixes, manual edits) since the baseline was taken. Objects with outcome `NEW` (not in baseline) are skipped — there's no prior record to compare against. If no baseline exists, the drift check is skipped with a warning.

**Phase 2 — Risk analysis** (only runs if Phase 1 is clean):

- **Syntax** — rules checked via `tm1.CheckRules` against the target cube
- **Dependencies** — cube dimensions, parent dimensions for subsets/views, and parent cubes for views must exist on target
- **Picklist dependencies** — for any packaged `}Picklist_{cube}` object, cell values are parsed to validate `dimension:Dim` and `subset:Dim:SubsetName` references exist on target (`BLOCKER` if missing)
- **Chore conflicts** — active or running chores referencing a packaged process are flagged
- **Structural impact** — elements removed from a dimension on target raise `WARNING` (or `BLOCKER` for large removals or consolidation removal)

Returns `BLOCKER` / `WARNING` / `INFO`. Blockers prevent deployment.

**Step 4 (Approve):** A named approver signs off with optional notes before deployment is unlocked. The approval record (name, timestamp, notes) is stored permanently in the archive.

**Step 5 (Deploy):** Confirm and push. Objects are written in dependency order: attributes → dimensions → cubes → picklist cubes → rules → subsets → views → processes. Picklist cubes deploy after their parent cube (so the cube exists) and before rules (which may reference picklist behaviour).

Before deployment begins, the IDE captures a **pre-deploy snapshot** of the target server's current state for every packaged object. After deployment, a **post-deploy snapshot** is taken. Both are stored in the archive record alongside the manifest and results. In Deploy History, each deployment shows a per-object table with changed/unchanged status and a **Diff** button to compare pre/post state inline in the IDE diff viewer.

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
