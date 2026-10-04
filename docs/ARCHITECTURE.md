# TM1 IDE — Architecture

How the pieces fit together, and where the code lives.

← [Back to README](../README.md)

---

## 📁 Project Structure

```
tm1_ide/
├── server.js                          # Express backend — all API routes
├── core/
│   ├── tm1_client.js                  # TM1 REST client — all API calls go through here
│   ├── adapter_registry.js            # Selects adapter per request, resolves server URLs
│   ├── paw_connect.js                 # Session store + PAW cookie-jar auth (paw-native)
│   ├── change_log.js                  # Change Set tracking — logs every save to audit trail
│   ├── sql_client.js                  # External SQL connections (MSSQL/PG/MySQL/SQLite)
│   ├── mdxBuilder.js                  # MDX query construction helpers
│   └── adapters/
│       ├── direct_v11.js              # Direct TM1 REST — Basic Auth, no PAW
│       ├── paw_native.js              # PAW proxy — cookie jar + CSRF header
│       └── paw_oauth2.js              # PAW proxy — Authentik/OAuth2 machine credential
├── client/                            # React + Vite frontend source
│   └── src/
│       ├── App.jsx                    # Root layout, global keyboard handlers
│       ├── store/                     # Zustand: tabs, groups, server, UI state
│       ├── hooks/useApi.js            # All TanStack Query data hooks
│       ├── components/                # One file per editor/panel
│       └── lib/
│           ├── tm1-completion.js      # RULES_CATALOG + TI_CATALOG (rich schema, arg counts)
│           ├── tm1-functions.js       # TM1_FUNCTIONS (Monarch highlighting, signature help)
│           ├── tm1-mdx-catalog.js     # MDX_CATALOG (category-grouped MDX functions)
│           ├── rules-validator.js     # Static analysis for Rules
│           ├── ti-validator.js        # Static analysis for TI
│           ├── mdx-validator.js       # Static analysis for MDX
│           ├── ti-debugger.js         # Breakpoint injection + capture parsing
│           ├── ti-interpreter.js      # Client-side TI execution simulator
│           ├── tm1-snippets.js        # TI and Rules snippet library
│           └── formatters/            # Rules formatter: tokenizer, AST, presets
├── tools/
│   └── tm1deploy/                     # Deploy CLI (optional — UI pipeline does the same)
│       ├── bin/tm1deploy.js           # Entry point: seed / diff / package / risk / deploy
│       └── src/                       # snapshot.js, diff.js, packager.js, risk.js, deployer.js
├── static/                            # Pre-built frontend (committed, served directly)
├── config/
│   ├── servers.json                   # TM1 server list + adapter config
│   ├── forge.json                     # Workspace state (open tabs, server, split direction)
│   ├── function-catalog-overrides.json # User-editable catalog additions/corrections
│   ├── sql-connections.json           # External SQL connection definitions
│   └── sql-queries.json               # Saved SQL queries
└── docs/
    ├── Planning Analytics.postman_collection.json  # Full IBM REST API reference
    ├── CONNECTION_ARCHITECTURE.md     # Adapter pattern deep-dive
    ├── DEPLOYMENT.md                  # Deploy pipeline internals
    └── ADAPTER_INTERFACE.md           # Adapter contract reference
```

---

## 🏗️ Architecture

```
# Option A — direct-v11 (recommended)
Browser  ←→  Express (server.js)  ──Basic Auth──▶  TM1 Server

# Option B — paw-native / paw-oauth2
Browser  ←→  Express (server.js)  ──Cookie+CSRF──▶  PAW  ──▶  TM1 Server
```

- `core/adapter_registry.js` selects the right adapter from `servers.json` on every request
- `core/tm1_client.js` wraps every TM1 API call — routes never call the API directly
- The frontend uses **TanStack Query** for all server state — all cache keys include the server name

---

See also: [CONNECTION_ARCHITECTURE.md](CONNECTION_ARCHITECTURE.md) (adapter pattern deep-dive) · [ADAPTER_INTERFACE.md](ADAPTER_INTERFACE.md) (adapter contract).
