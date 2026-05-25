# TM1 IDE

Models-as-code tooling and IDE for IBM Planning Analytics (TM1).

Define TM1 objects in YAML. Edit rules, views, subsets, and dimensions in a browser-based IDE. Deploy via the TM1 REST API. Version control your entire model in git.

---

## What It Does

- **Models as code** — dimensions, cubes, rules, processes defined as YAML files
- **IDE** — browser-based editor: object explorer, rules editor with lineage trace, cube viewer (visual + MDX), subset editor, dimension editor, TI process editor
- **Deploy CLI** — diff and apply YAML changes to any TM1 server (`tm1_deploy/`)
- **Module system** — isolate functional areas into separate TM1 database instances with declared dependencies
- **CICD ready** — deploy on push via GitHub Actions or GitLab CI

---

## Project Structure

```
tm1_ide/
├── server.js                   # Express backend — PAW proxy, TM1 REST, git operations
├── client/                     # React + Vite frontend
│   ├── src/
│   │   ├── components/         # IDE components (EditorPane, ViewEditor, RulesEditor, etc.)
│   │   ├── hooks/              # TanStack Query hooks for TM1 API
│   │   └── store/              # Zustand tab store
│   └── package.json            # Vite, React, shadcn/ui, Monaco, AG Grid
├── core/                       # Shared backend
│   ├── paw_connect.js          # PAW V11 session auth
│   ├── tm1_client.js           # TM1 REST proxy through PAW
│   └── mdxBuilder.js           # MDX generation helpers
├── tm1_deploy/                 # Deploy CLI (Python) — diff, apply, validate
├── models/                     # Example YAML model definitions
│   ├── dimensions/
│   ├── cubes/
│   ├── rules/
│   └── processes/
├── docs/                       # Architecture and concept docs
│   ├── DESIGN.md               # Full architecture and design rationale
│   └── PLAN.md                 # Build phases and roadmap
└── package.json                # Express server deps
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- IBM Planning Analytics Workspace (PAW) V11 on-prem
- TM1 V11 on-prem (one or more databases)

### 1. Clone and install

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
PAW_HOST=http://192.168.x.x
PAW_USERNAME=admin
PAW_PASSWORD=your_tm1_password
PORT=8083
```

### 3. Start

**Terminal 1 — Backend:**
```bash
npm start
```

**Terminal 2 — Frontend:**
```bash
cd client && npm run dev
```

Open **http://localhost:5173**

---

## Deploy CLI

```bash
python3 -m tm1_deploy diff   --server "Planning Sample" --model models/
python3 -m tm1_deploy apply  --server "Planning Sample" --model models/
```

---

## IDE Features

| Feature | Description |
|---------|-------------|
| **Explorer** | Browse cubes, dimensions, processes, chores, views, subsets |
| **Rules Editor** | Monaco editor with syntax highlighting, lineage trace panel |
| **Cube Viewer** | Visual pivot builder + MDX editor in one tab. Drag dimensions, pick subsets, execute, save as MDX |
| **Subset Editor** | Visual tree + MDX code view. Ghost children, Σ toggle |
| **Dimension Editor** | Hierarchy tree, attribute grid, search |
| **Process Editor** | TI code editor with execution terminal |
| **Global Search** | Find/replace across the model |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Execute / Refresh view |
| `Ctrl+S` | Save existing view |
| `Ctrl+Shift+S` | Save view as… |

---

## Architecture

All TM1 calls route through PAW at `/api/v0/tm1/{server}/api/v1/`. No direct TM1 connections, no per-server ports or SSL config.

The IDE is designed as a **desktop developer tool** — each developer runs their own instance with their own PAW credentials.

See [docs/DESIGN.md](docs/DESIGN.md) for full architecture.

---

## Related Tools

- **[tm1_cubemap](https://github.com/falconbi/tm1_cubemap)** — Visual cube lineage and model architecture graph
- **[tm1_paw_tree](https://github.com/falconbi/tm1_paw_tree)** — PAW workbook governance and usage tracking

---

## Status

Active development. See [docs/PLAN.md](docs/PLAN.md) for build phases and roadmap.
