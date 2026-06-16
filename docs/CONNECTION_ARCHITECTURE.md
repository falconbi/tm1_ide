# TM1 IDE — Connection Architecture

Session discussion: Jun 16 2026. Covers user management fix, PAW auth model, adapter pattern design, multi-environment model, and roadmap.

**Last updated:** Jun 16 2026 — scoped to on-prem V11 + V12.

---

## Phase Scope

**In scope (this phase):** On-premise PAW V11 and PAW V12 only.

| Adapter | Auth | TM1 URL |
|---|---|---|
| `paw-v11` | `POST /login/form/` → cookie + CSRF | `/api/v0/tm1/{server}/api/v1/` |
| `paw-v12-oidc` | Authentik PKCE → cookie + CSRF | `/api/v0/tm1/{server}/api/v1/` |

Both adapters share the **same request transport** (`paSession` + `ba-sso-authenticity`). Only the login handshake differs. `PawV12OIDCAdapter` can extend `PawV11Adapter` for all post-login behaviour.

**Out of scope (deferred):**
- IBM PA Cloud / AWS / MCSP (`paw-cloud-apikey`)
- PAW OAuth registered apps (`paw-oauth` → Bearer → `/api/v1/tm1/`)
- Direct TM1 / Arc-style Admin Host bypass
- IAM Bearer token flows

The adapter interface is designed to accommodate cloud later, but **this phase builds two adapters only**.

---

## 1. User Management Fix — PAW_LOGIN_SERVER

**Root cause:** PAW validates all logins against one specific TM1 server — the **TM1 Login Server** — configured in PAW Admin Console → Configuration → TM1 Login Server URI. Users created on any other server are invisible to PAW auth.

**Fix shipped:**
- Added `PAW_LOGIN_SERVER` to `.env` and `.env.example`
- All 10 user/group routes in `server.js` now always target `PAW_LOGIN_SERVER` regardless of selected workspace server
- README updated with new "PAW Login Server" section

**V12 note:** TM1 Login Server is a V11-only concept. User management in the IDE must be adapter-aware — disabled or routed to IdP on V12/OIDC environments.

---

## 2. PAW Architecture — Key Facts

- PAW is not a separate user store — in TM1 native auth mode, TM1 `}Clients` IS the user store
- PAW has one designated TM1 Login Server for auth — all logins validated there (V11 only)
- PAW discovers TM1 servers via the **TM1 Admin Host** (port 5895 HTTP / 5898 HTTPS) — a separate service acting as a server registry. TM1 servers register themselves on startup
- PAW V12 replaces the TM1 Login Server concept with OIDC — identity comes from the IdP, not `}Clients`
- The TM1 Login Server constraint is V11-only

**Admin Host discovery API (direct, reliable):**
```
GET http://{adminhost}:5895/api/v1/Servers
GET https://{adminhost}:5898/api/v1/Servers
```
Source: [TM1 Admin Server API](https://www.ibm.com/docs/en/planning-analytics/2.0.0?topic=api-tm1-admin-server)

**PAW proxy list API (unreliable):**
```
GET {paw-host}/api/v1/tm1/Servers
```
Included in the IBM Postman collection but explicitly noted as *"not exposed through the PAW proxy"*. Do not depend on this without testing on your instance. `tm1_paw_tree` documents: *"PAW has no endpoint to list TM1 server names"*.

---

## 3. Arc vs Our IDE — Connection Model

Arc connects directly to TM1 via the Admin Host, bypassing PAW entirely. For IBM Cloud / AWS, Arc uses IBM IAM API keys → Bearer tokens — direct Admin Host is blocked by cloud firewalls.

**Key discovery:** the TM1 OData path suffix is identical across all deployment types:

```
{base}/api/{pawVersion}/tm1/{database}/api/v1/{endpoint}
```

Only the auth mechanism, base URL, and PAW API version prefix change. Our existing PAW-proxy architecture is the right shape — it just needs pluggable auth underneath.

| Layer | What varies per environment |
|---|---|
| Base URL | `http://dev-paw` vs `https://region.planninganalytics.saas.ibm.com` |
| Tenant segment | None (on-prem) vs `/api/{tenantId}/` (cloud) |
| PAW API version | `v0` (cookie auth) vs `v1` (OAuth Bearer) |
| Auth transport | Cookie+CSRF vs Bearer |
| TM1 OData suffix | Always `/api/v1/{endpoint}` |

---

## 4. Auth Mechanisms by Deployment Type

### Summary table (this phase)

| Scenario | Login mechanism | Request auth | TM1 URL prefix |
|---|---|---|---|
| On-prem PAW V11 | `POST /login/form/` (mode=basic) | Cookie + CSRF | `/api/v0/tm1/{server}` |
| On-prem PAW V12 / Authentik | 6-step Authentik PKCE flow → PAW `/login?code=` | Cookie + CSRF | `/api/v0/tm1/{server}` |

Both on-prem adapters use identical post-login behaviour. The registry selects the adapter by `environment.adapter` in config.

<details>
<summary>Deferred: cloud and OAuth paths (out of scope)</summary>

| Scenario | Login | Request auth | TM1 URL prefix |
|---|---|---|---|
| IBM PAaaS / MCSP | API key basic auth | `paSession` cookie | `/api/{tenant}/v0/tm1/{db}` |
| PAW OAuth app | `/oauth2/authorize` → `/oauth2/token` | Bearer | `/api/v1/tm1/{server}` |
| Arc / direct cloud | IAM API key | Bearer (direct Admin Host) | N/A — bypasses PAW |

</details>

### PAW V11 — Cookie + CSRF (current, verified in code)

**Actual flow** (`core/paw_connect.js` — not the aspirational `/api/v1/auth/login` endpoint):

```
POST {paw-host}/login/form/
  Body: username, password, mode=basic
  Content-Type: application/x-www-form-urlencoded

← Set-Cookie: paSession, ba-sso-csrf

Every request:
  Cookie: paSession (via axios cookie jar)
  Header: ba-sso-authenticity: {ba-sso-csrf value}

TM1: GET/POST {paw-host}/api/v0/tm1/{server}/api/v1/{path}
```

Refresh: re-POST `/login/form/` with stored credentials before 10-min TTL expires.

### PAW V12 — Authentik interactive (verified in `tm1_cubemap/core/paw_connect.py`)

**This is NOT a standard OAuth2 password grant, and it does NOT end in Bearer tokens.**

```
1. GET  PAW /login                          → Authentik PKCE redirect
2. POST Authentik /api/v3/flows/executor/default-authentication-flow/  (username)
3. POST same endpoint                       (password) → xak-flow-redirect
4. GET  Authentik /application/o/authorize/  (strip prompt=login from URL)
5. GET  Authentik consent executor            → redirect URL with OAuth code
6. GET  PAW /login?code=...                   → paSession + ba-sso-csrf cookies

Every request: same cookie + ba-sso-authenticity as V11
TM1: {paw-host}/api/v0/tm1/{server}/api/v1/{path}
```

Port `tm1_cubemap/core/paw_connect.py` to Node for the V12 adapter. Reference: `Downloads/paw-conventions.md`.

### pacontent/v1 (book-usage, PAW assets)

Separate from TM1 proxy. Used by `GET /api/paw/book-usage` in `server.js`.

```
{paw-host}/pacontent/v1/{path}
Cookie: paSession + ba-sso-csrf
Header: ba-sso-authenticity
Paths: double URL-encoded (/shared → %252fshared)
```

Source: [Content Services API](https://ibm.github.io/pacontentservicesapi/)

Any adapter must provide auth for both TM1 proxy calls and `pacontent/v1`.

---

## 5. Adapter Pattern

### Architecture

```
TM1Client  (API calls — method signatures never change)
    └── ConnectionRegistry.resolve(serverKey, ideToken)
            └── ConnectionAdapter  (auth + URL — swappable per environment)
                    ├── paw-v11           → /login/form/ → cookie+CSRF
                    └── paw-v12-oidc      → Authentik PKCE → cookie+CSRF (extends v11)
```

All TM1 REST API calls, editors, explorer, deploy pipeline — none of the OData logic changes. Only auth and URL construction underneath.

### Adapter interface

```javascript
class ConnectionAdapter {
  get environmentId()
  get credentialGroup()

  async authenticate({ username, password })  // → AdapterSession (adapter-specific login only)
  async refresh(session)                      // re-run authenticate with stored password
  async discoverServers(session)              // → [{ name, displayName? }]
  buildTm1Url(session, serverName, odataPath) // always /api/v0/tm1/ for this phase
  async getAuthHeaders(session)               // ba-sso-authenticity (shared)
  async getHttpClient(session)                // axios cookie jar (shared)
  isAuthError(error)                          // 401/403 → trigger refresh
}
```

Post-login methods are identical for V11 and V12 — only `authenticate()` differs. `PawV12OIDCAdapter` overrides `authenticate()` and inherits everything else from `PawV11Adapter`.

### AdapterSession (runtime, per user per credential group)

```javascript
{
  sessionKey,           // internal cache key
  credentialGroup,      // 'dev' | 'prod'
  environmentId,
  adapterType,
  username,
  expiresAt,            // epoch ms
  secrets,              // in-memory only: { password } — never persisted to disk
  state,                // adapter-private: cookie jar, accessToken, etc.
}
```

### ConnectionRegistry

```javascript
// Login
authenticateGroup(ideToken, credentialGroupId, { username, password })
  → for each environment in group: adapter.authenticate() + discoverServers()
  → store binding + server catalog

// Per request
resolve(ideToken, serverKey)  // e.g. 'dev:TM1_Test'
  → { adapter, session, serverName }

// Factory
createTM1Client(serverKey, ideToken)  // replaces new TM1Client(server, ideToken)
```

### TM1Client change (minimal)

```javascript
class TM1Client {
  constructor(serverName, connection) {
    this.server = serverName
    this._adapter = connection.adapter
    this._session = connection.session
  }
  _url(path)  { return this._adapter.buildTm1Url(this._session, this.server, path) }
  async _headers() { return this._adapter.getAuthHeaders(this._session) }
  // + unified 401 → adapter.refresh() → retry once
}
```

### File layout

```
core/
  connection_registry.js
  tm1_client.js              (minimal change)
  adapters/
    base.js                  (shared cookie+CSRF post-login logic)
    paw_v11.js               (extract from paw_connect.js)
    paw_v12_oidc.js          (extends paw_v11; port login from tm1_cubemap)
    admin_host.js            (discovery helper)
    factory.js               (paw-v11 | paw-v12-oidc only)
config/
  connections.json           (replaces servers.json)
```

---

## 6. Multi-Environment Model

### Environment isolation

Clients with Dev / Test / Prod have **three separate Admin Hosts** — one per environment. Sharing an Admin Host would expose Test servers inside the Prod PAW UI, breaking environment isolation.

### Credential tiers

- **Dev credentials** — personal developer credentials, daily driver
- **Prod/Test credentials** — Test mirrors Prod exactly (like-for-like testing). One credential set covers both

### Login flow

```
Developer opens IDE
  → Sign in to Dev  (credentialGroup: dev)  → auth Dev PAW   → discover Dev servers
  → Sign in to Prod (credentialGroup: prod) → auth Test PAW  → discover Test servers
                                           → auth Prod PAW  → discover Prod servers

Server selector shows all discovered servers with environment prefix: "Dev / TM1_Test"
TM1Client resolves adapter by serverKey → environment → credential group
```

**Safety property:** Prod requires a deliberate separate login. Dev session cannot reach Prod servers.

### Config: `config/connections.json` (replaces `servers.json`)

Current (flat list):
```json
[{ "name": "ServerName" }]
```

Target:
```json
{
  "credentialGroups": [
    { "id": "dev",  "label": "Development" },
    { "id": "prod", "label": "Test / Production" }
  ],
  "environments": [
    {
      "id": "dev",
      "label": "Dev",
      "credentialGroup": "dev",
      "adapter": "paw-v11",
      "host": "http://dev-paw.corp.local:6080",
      "apiVersion": "v0",
      "adminHost": "dev-admin.corp.local",
      "adminPort": 5895,
      "loginServer": "Dev_Login",
      "servers": []
    },
    {
      "id": "test",
      "label": "Test",
      "credentialGroup": "prod",
      "adapter": "paw-v12-oidc",
      "host": "https://test-paw.corp.local",
      "apiVersion": "v0",
      "adminHost": "test-admin.corp.local",
      "oidc": {
        "provider": "authentik",
        "issuer": "https://auth.corp.local"
      },
      "servers": []
    },
    {
      "id": "prod",
      "label": "Production",
      "credentialGroup": "prod",
      "adapter": "paw-v11",
      "host": "http://prod-paw.corp.local:6080",
      "apiVersion": "v0",
      "adminHost": "prod-admin.corp.local",
      "adminPort": 5895,
      "loginServer": "Prod_Login",
      "servers": []
    }
  ]
}
```

`servers: []` is normally empty — populated at login via Admin Host discovery. Manual override per environment as fallback.

### Runtime server catalog (in-memory, per IDE session)

```javascript
{
  key: "dev:TM1_Test",           // sent as ?server= param everywhere
  environmentId: "dev",
  serverName: "TM1_Test",
  label: "Dev / TM1_Test",
  credentialGroup: "dev",
  loginServer: "Dev_Login"       // V11 user-mgmt routing only
}
```

### Server discovery strategy

```
On credential-group login, per environment:
  1. adapter.authenticate(credentials)
  2. If adminHost configured:
       GET http://{adminHost}:{adminPort}/api/v1/Servers
  3. Else if env.servers[] override:
       use override
  4. Else (best-effort):
       GET {host}/api/v1/tm1/Servers via adapter auth
  5. Cache in IdeSession.serverCatalog until ?refresh=1
```

### API changes

| Endpoint | Change |
|---|---|
| `POST /api/auth/login` | Add `credentialGroup` field |
| `GET /api/auth/status` | **New** — which groups are connected |
| `POST /api/auth/logout-group` | **New** — drop one group without full logout |
| `GET /api/servers` | Return discovered catalog with `key` + `label` |
| All `?server=` params | Send `key` (`dev:TM1_Test`) not bare name |

---

## 7. Out of Scope — IBM Cloud (deferred)

IBM PA Cloud / AWS / MCSP and PAW OAuth Bearer flows are documented in the investigation but **not built in this phase**. When needed later, add `paw-cloud-apikey` or `paw-oauth` adapters without changing `TM1Client` or the registry interface.

---

## 8. Current Codebase State (investigation findings)

### What is implemented

| Feature | Status | Location |
|---|---|---|
| Per-user PAW login | ✅ Done | `paw_connect.js` Map keyed by ideToken |
| IDE session token | ✅ Done | `x-ide-token` header, localStorage |
| PAW V11 cookie auth | ✅ Done | `/login/form/`, `ba-sso-authenticity` |
| `PAW_LOGIN_SERVER` routing | ✅ Done | 10 user routes in `server.js` |
| Flat `servers.json` | ✅ Done | Manual list, 8 servers |
| Adapter pattern | ❌ Not started | — |
| `PAW_AUTH_MODE=authentik` | ❌ Documented only | `.env` has vars, Node never reads them |
| Multi-environment | ❌ Not started | Single `PAW_HOST` |
| Server auto-discovery | ❌ Not started | — |

### Known bugs (fix before adapter work)

| Bug | Impact | Location |
|---|---|---|
| Deploy pipeline auth broken | `/api/deploy/seed`, `/diff`, `/package`, `/risk`, `/execute` all call `new TM1Client(server)` without `ideToken` | `server.js`, `tools/tm1deploy/src/*.js` |
| Duplicate `GET /api/sessions` | Change-log route (line 93) shadows TM1 sessions route (line 1799). `SessionsMonitor` gets wrong data | `server.js` |
| Per-server change sets | `getActiveSession(server)` not scoped to user — two devs on same server collide | `change_log.js` |
| Shared `forge.json` | All users overwrite same tabs/server state | `config/forge.json` |
| Stale `.env` vars | `PAW_USERNAME`/`PAW_PASSWORD` ignored by Node; only Python legacy uses them | `.env.example` |

### Env vars: documented vs implemented

| Variable | Node `paw_connect.js` | Notes |
|---|---|---|
| `PAW_HOST` | ✅ Used | Single instance only |
| `PAW_LOGIN_SERVER` | ✅ Used | User mgmt routes only |
| `PAW_AUTH_MODE` | ❌ Ignored | `native` and `authentik` both hit V11 flow |
| `PAW_USERNAME` / `PAW_PASSWORD` | ❌ Ignored | Python/tm1deploy legacy only |
| `AUTHENTIK_*` | ❌ Ignored | Working reference in `tm1_cubemap` |
| `PAW_TENANT_ID` | ❌ Ignored | Cloud only — out of scope this phase |

---

## 9. Migration Path

| Phase | Work | UX change |
|---|---|---|
| **0** | Fix deploy auth (pass `req.ideToken` through deploy modules) | None |
| **0** | Fix `/api/sessions` route collision → `/api/tm1/sessions` | None |
| **0** | Scope `getActiveSession(server, user)` | None |
| **1** | `PawV11Adapter` + `ConnectionRegistry` + auto-migrate `servers.json` | None |
| **2** | `createTM1Client(serverKey, ideToken)` in all ~120 `server.js` call sites | Server param becomes key |
| **3** | Multi-group login UI (Dev / Prod cards) | Login page redesign |
| **4** | Port `paw_v12_oidc.js` from cubemap Python | V12 on-prem clients |
| **5** | Admin Host discovery replaces manual lists | Servers auto-populate |

Phase 1 compat migration (zero UX change):
```javascript
// Auto-convert servers.json → connections.json at startup
{
  credentialGroups: [{ id: 'default', label: 'Default' }],
  environments: [{
    id: 'default', credentialGroup: 'default', adapter: 'paw-v11',
    host: process.env.PAW_HOST, apiVersion: 'v0',
    loginServer: process.env.PAW_LOGIN_SERVER,
    servers: oldServers.map(s => s.name)  // seed from flat list
  }]
}
```

---

## 10. Roadmap

| Priority | Work |
|---|---|
| Done | `PAW_LOGIN_SERVER` fix — user management always targets correct server |
| **Urgent** | Phase 0 bug fixes (deploy auth, sessions route, per-user change sets) |
| Near term | Phase 1: `PawV11Adapter` + `ConnectionRegistry` (no UX change) |
| Near term | Phase 2–3: server keys + multi-environment login UI |
| Next wave | Phase 4: `paw-v12-oidc` — port from `tm1_cubemap` (`.env` ready at `192.168.1.223`) |
| Future | IBM Cloud / OAuth adapters — separate phase when a client needs it |

---

## 11. Empirical Tests (run on your infrastructure)

Before building adapters, validate on live endpoints from `.env`:

1. V11: `GET http://192.168.1.37/api/v1/tm1/Servers` with cookie auth after `/login/form/` — does it return server list?
2. Admin Host: `GET http://{admin}:5895/api/v1/Servers` — does it match `config/servers.json`?
3. V12: Port cubemap Authentik flow to Node against `192.168.1.223` — confirm TM1 calls at `/api/v0/tm1/`
4. Session TTL: is 10 minutes correct for your PAW, or longer?

---

## 12. Reference Implementations in This Repo

| Auth flow | Working code | Port target |
|---|---|---|
| V11 native | `tm1_ide/core/paw_connect.js` | `adapters/paw_v11.js` |
| V12 Authentik | `tm1_cubemap/core/paw_connect.py` | `adapters/paw_v12_oidc.js` |
| V11 native (alt) | `tm1_paw_tree/core/paw_connect.py` | Reference only |
| PAW conventions | `Downloads/paw-conventions.md` | Authentik flow docs |
| TM1 via PAW | `tm1_ide/core/tm1_client.js` | Unchanged OData methods |

---

## Appendix: Investigation Prompt (completed Jun 16 2026)

The original Grok investigation prompt asked for adapter interface, config schema, login flow, TM1Client construction, refresh handling, migration path, V12 OIDC gotchas, and IBM Cloud IAM handling. Findings are incorporated in sections 4–9 above.

Key corrections from investigation:
- V11 uses `/login/form/` not `/api/v1/auth/login`; cookies are `paSession`/`ba-sso-csrf` not `TM1SessionId`/`X-CSRF-Token`
- V12 interactive Authentik ends in **cookies**, not Bearer — same post-login transport as V11
- Server discovery should use Admin Host direct API, not PAW `/api/v1/tm1/Servers`
- **Phase scope limited to on-prem V11 + V12** — cloud/OAuth deferred