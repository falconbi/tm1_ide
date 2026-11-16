# TM1 IDE — Architecture

How the pieces fit together, and where the code lives. Read this after Setup and Features, then use
[CLAUDE.md](../../CLAUDE.md) as the working map (constraints, conventions, and the “how to add…”
sections).

← [Back to README](../../README.md)

---

## Three programs, one codebase

| Program | Entry point | Who uses it |
|---|---|---|
| **IDE** | `server.js` | Developers: rules, TI, dimensions, views, deploys, admin |
| **Lens app** | `lens-server.js` | Business users: the saved Lenses, as a separate runtime |
| **MCP server** | `tools/tm1mcp/server.js` | AI agents building and checking models through MCP tools |

They share `core/` (TM1 client, change log, model store, deploy tooling) and `shared/` (Lens bridge,
pivot engine, function catalog). `tools/tm1deploy/` is the command-line package/risk/deploy tooling;
it is not the IDE’s release path, which now runs through TM1 Git.

## Project structure

```
tm1_ide/
├── server.js                    # IDE Express backend — all IDE API routes
├── lens-server.js               # Lens app: sign-in, home, sandboxed Lens viewer
├── core/                        # Shared Node code
│   ├── tm1_client.js            # Every TM1 REST call goes through this client
│   ├── adapter_registry.js      # Picks direct-v11 / paw_native / paw_oauth2 per server
│   ├── adapters/
│   │   ├── direct_v11.js        # Direct TM1 REST, Basic Auth
│   │   ├── paw_native.js        # PAW cookie jar + CSRF
│   │   └── paw_oauth2.js        # PAW with an Authentik/OAuth2 machine credential
│   ├── change_log.js            # Change sets + audit log (SQLite)
│   ├── model-store.js           # Model-owned documents (tests, Lenses, baselines)
│   ├── git-*.js                 # TM1 Git releases, approvals, drift, readiness
│   ├── lens_*.js                # Lens store, bridge validation, activity, preferences
│   └── sql_client.js            # MSSQL / PostgreSQL / MySQL / SQLite connections
├── client/                      # React + Vite frontend source (built into static/)
│   └── src/
│       ├── App.jsx              # Root layout, tabs, global keyboard handling
│       ├── store/               # Zustand: tabs, groups, server, UI state
│       ├── hooks/useApi.js      # All TanStack Query hooks
│       ├── components/          # One file per editor/panel
│       └── lib/                 # Monaco language, validators, formatters, pivot wrapper
├── shared/                      # Code shared by the IDE and Lens app
│   ├── tm1-function-catalog.json # The one function catalog (all consumers derive from it)
│   ├── lens-bridge.js           # postMessage contract between a Lens frame and its host
│   ├── lens-kit/                # The Lens toolkit (ECharts, AG Grid, React Flow, Alpine)
│   ├── lens-patterns/           # Worked Lens patterns (read-only demonstrations)
│   └── pivot/                   # One pivot engine for the IDE View grid and Lenses
├── static/                      # Committed build output, served by the IDE
├── tools/
│   ├── tm1mcp/                  # MCP server + its 67 tools and security wrapper
│   └── tm1deploy/               # Package / diff / risk / deploy CLI
├── config/                      # Committed examples + per-install runtime state
├── data/                        # Runtime DB, summaries, Lens logs and prefs
├── core-ti/                     # Hidden core TI processes and platform settings
├── tests/                       # node --test suite (fakes; no live TM1 required)
├── docs/                        # Guides and review records
├── scripts/                     # Small developer scripts (e.g. test DB seed)
└── .github/workflows/ci.yml     # Node 20/22: build, static check, tests, both lint ratchets
```

## Connections

The IDE connects either directly to a TM1 server’s REST port or through PAW; the adapter in
`config/servers.json` decides. Direct is simplest for a lab; PAW is usual at a client.

```
Direct:  Browser ←→ server.js ←Basic Auth→ TM1 REST
PAW:     Browser ←→ server.js ←Cookie+CSRF→ PAW ←→ TM1
Lenses:  Browser ←→ lens-server.js ←same core adapters→ TM1
MCP:     Agent ←stdio→ tools/tm1mcp ←same core adapters→ TM1
```

- `core/adapter_registry.js` selects the adapter from `config/servers.json` on every request.
- `core/tm1_client.js` wraps every TM1 call; routes and MCP tools never build REST URLs themselves.
- The IDE frontend uses **TanStack Query**; cache keys include `server` first.
- The Lens frame never holds a token and never talks to the network directly: it posts to its host,
  which performs the call as the signed-in user.

## Documentation map

- [SETUP.md](SETUP.md) — install, server config, run, development mode
- [FEATURES.md](FEATURES.md) — every editor and tool
- [LINT.md](LINT.md) — client and backend lint ratchets
- [MCP_SERVER.md](MCP_SERVER.md) — connecting an AI agent
- [../auth/CONNECTION_ARCHITECTURE.md](../auth/CONNECTION_ARCHITECTURE.md) — adapter pattern
- [../auth/ADAPTER_INTERFACE.md](../auth/ADAPTER_INTERFACE.md) — adapter contract
- [../deploy/DEPLOY_LIFECYCLE.md](../deploy/DEPLOY_LIFECYCLE.md) — the current release path
- [CLAUDE.md](../../CLAUDE.md) — architecture constraints, conventions, adding an editor
