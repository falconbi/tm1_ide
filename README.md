# TM1 IDE

A browser-based IDE for IBM Planning Analytics (TM1). Edit rules, TI processes, dimensions, subsets, views, chores, and cube data directly from your browser — no TM1 Architect or Perspectives required.

All TM1 communication routes through Planning Analytics Workspace (PAW), so there is no direct TM1 connection, no per-server port config, and no SSL to manage.

---

## Features

### Editors

| Editor | What it does |
|--------|-------------|
| **Rules Editor** | Monaco editor with TM1 rules syntax highlighting, live syntax validation (CheckRules API), code formatter (3 structure presets), region collapse/expand, lineage trace panel, **cell calculation trace** (shows full rule chain for any cell), snippet library |
| **TI Editor** | Four-tab editor (Prolog / Metadata / Data / Epilog), parameter editor, datasource editor, run with output log, **error log viewer** (reads TM1 `.log` file inline after errors), static code analysis (validator), debugger, snippets, pattern generators |
| **TI Debugger** | Set breakpoints in any section, capture variable values at each breakpoint, watch panel, section-by-section execution |
| **Dimension Editor** | Hierarchy tree with drag-style CRUD, attribute grid, element search, bulk CSV import, attribute definition management |
| **Subset Editor** | MDX code view + visual element tree, static/MDX save, MDX preview, ghost children |
| **View Editor** | Native and MDX view builder, cell grid with inline writeback, save/save-as |
| **Guided MDX Builder** | Axis-by-axis view builder, subset filter builder, MDX execution |
| **Chore Editor** | Schedule editor, step list, activate/deactivate/execute on demand |
| **Cube Editor** | Create and delete cubes, dimension assignment |
| **SQL Editor** | External database queries (SQL Server, PostgreSQL, MySQL, SQLite), schema browser, saved queries, post SQL as TI datasource |
| **MDX Sandbox** | Ad-hoc MDX execution with result grid |

### Explorer (Left Sidebar)

Browse and manage all TM1 objects: cubes, dimensions, subsets, views, processes, chores. Full CRUD for every object type — create, rename, delete. Inline `+` buttons to add objects without leaving the explorer.

### Cross-Object Search

`Ctrl+Shift+F` opens a full-text search across all rules files and TI process code on the connected server simultaneously.

### Autocomplete

Context-aware Monaco autocomplete in both Rules and TI editors:
- **Cube name** — lists server cubes, expands to full snippet with dimension tab stops for cell functions (`DB()`, `CellPutN()`, etc.)
- **Dimension name** — lists server dimensions for dimension-first functions (`DimensionElementInsert()`, `ELCOMP()`, etc.)
- **Function keywords** — snippet completions for ~40 verified TI functions and 6 Rules functions with correct parameter signatures (sourced from IBM TM1 Reference)

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

## IBM REST API Reference

The full IBM Planning Analytics REST API is documented in `docs/Planning Analytics.postman_collection.json`. This covers all endpoint groups: Dimensions, Cubes, Processes, Chores, Views/MDX, Subsets, Sessions, Transactions, Jobs, ErrorLogFiles, Metrics, Configuration, File Management, GIT integration, and PAW Workspace management.

---

## Status

Active development. Core IDE features are complete and production-stable. In-progress work tracked in `docs/STATUS.md`.
