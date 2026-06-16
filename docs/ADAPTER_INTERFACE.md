# TM1 IDE — Adapter Interface Design

On-Prem only (V11 + V12). Cloud is future phase.

---

## Goal

Replace hard-coded PAW-proxy dependency with a pluggable adapter so the IDE can connect to TM1 directly (no PAW required), matching the connectivity model of Arc.

---

## Adapters

### In use

| ID | V11/V12 | Auth Mechanism | Use Case |
|---|---|---|---|
| `direct-v11` | V11 | Basic auth (`Authorization: Basic ...`) per request | Direct to TM1 REST API, no PAW. Supports Native (Mode 1) and admin accounts on Mode 5. |
| `paw-oauth2` | V12 | OAuth2 client credentials via PAW → Bearer token | PAW V12 deployments (PAW 2.1.21+ / 3.1.8+) |

### Available but not used

| ID | V11/V12 | Auth Mechanism | Notes |
|---|---|---|---|
| `paw-native` | V11 | PAW session cookie + CSRF header | Current IDE approach — proxies through PAW V11. Only needed if TM1 REST API ports are inaccessible and PAW is the only entry point. `direct-v11` is preferred in all normal cases. |

No NTLM, no Cloud — both are future.

> **Correction:** An earlier version of this document described a `direct-v12` adapter using `POST /tm1/auth/v1/session` to bypass PAW. This is incorrect. PAW V12 OAuth2 still routes through PAW — `client_id`/`client_secret` are registered in PAW's Integrations tile and tokens are obtained from PAW's own OAuth2 endpoints, not from TM1 directly.

---

## Adapter Interface

Every adapter implements these methods. `TM1Client` calls the adapter — never touches auth or URL construction directly.

```
authenticate(credentials) → AuthSession
  Returns session info (cookie, token, CSRF, etc.) that the adapter stores internally.

request(method, path, { body, params }) → response
  Makes an authenticated TM1 REST API call. Adapter handles:
  - URL construction (base URL + path)
  - Auth headers / cookies / tokens
  - Session refresh on expiry
  - Response parsing

isAuthenticated() → boolean
  Whether the cached session is still valid (used before request)
```

---

## Config Schema

`config/servers.json` evolves from a flat list to support adapter type and connection details per server.

### Current (v1 — flat list)

```json
[
  { "name": "24Retail" },
  { "name": "Production" }
]
```

### Target (v2 — adapters)

```json
{
  "adminHosts": [
    {
      "name": "DEV",
      "url": "http://dev-adminhost:5898",
      "adapter": "direct-v11",
      "user": "developer",
      "password": "...",
      "camNamespace": "",
      "servers": ["24Retail", "Propel_Planning"]
    }
  ],
  "connections": [
    {
      "name": "PAW-V12",
      "adapter": "paw-oauth2",
      "pawHost": "http://192.168.1.178",
      "client_id": "...",
      "client_secret": "..."
    },
    {
      "name": "PAW-Dev",
      "adapter": "paw-native",
      "pawHost": "http://192.168.1.37",
      "username": "admin",
      "password": "apple",
      "servers": ["24Retail"]
    }
  ]
}
```

### Credential storage

Credentials live in `servers.json` for simplicity (developer IDE, 2-5 users). Can be extracted to `.env` or a separate `credentials.json` later if needed.

Note: `paw-oauth2` stores `client_secret` in config. This is a pre-shared secret registered in PAW's Integrations tile — not a user password. The user's actual password is never stored, only `client_secret` which is a machine credential.

---

## Auth Flows

### `direct-v11` — Basic Auth

```
Every request:
  GET /api/v1/Cubes
  Authorization: Basic base64(user:password)
  [CAMNamespace: CorpAD]  (optional, only if camNamespace is set)

No session management — stateless (TM1 V11 Basic auth).
```

### `paw-oauth2` — PAW V12 OAuth2 Bearer Token

Requires PAW 2.1.21 / 3.1.8 or later. `client_id` and `client_secret` are generated in the **Integrations tile in PAW Administration** — not a TM1 config.

```
Step 1 — Obtain Bearer token:
  POST {PA-URL}/oauth2/token
  grant_type=client_credentials
  client_id={clientId}
  client_secret={clientSecret}

  ← { "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }

Step 2 — All subsequent TM1 calls:
  GET {PA-URL}/api/v1/tm1/{server}/api/v1/{path}
                      ↑ v1 not v0
  Authorization: Bearer eyJ...

Step 3 — Refresh:
  Token expires after 1 hour → repeat Step 1.
  Adapter caches token with TTL, auto-refreshes before expiry.
```

Source: IBM Postman collection (PAW REST API, PAW 2.1.21+/3.1.8+).

### `paw-native` — PAW Session Cookie + CSRF (existing, unchanged)

```
Step 1 — Authenticate:
  POST /login/form/
  Content-Type: application/x-www-form-urlencoded
  username=admin&password=apple&mode=basic

  ← Set-Cookie: paSession=...; HttpOnly
  ← Set-Cookie: ba-sso-csrf=...

Step 2 — All subsequent TM1 calls:
  GET /api/v0/tm1/{server}/api/v1/{path}
  Cookie: paSession=...; ba-sso-csrf=...
  ba-sso-authenticity: <csrf-value>

Step 3 — Refresh:
  PAW session expires → re-POST to /login/form/.
  Adapter caches session with configurable TTL (default: 10 min).
```

---

## TM1Client Changes

### Current constructor

```js
new TM1Client(serverName, ideToken)
```

- Resolves PAW session from `paw_connect.js` using `ideToken`
- Constructs URL as `{PAW_HOST}/api/v0/tm1/{server}/api/v1/{path}`

### New constructor

```js
new TM1Client(serverName, adapter)
```

- `serverName` — TM1 server name (e.g. `"24Retail"`)
- `adapter` — an instance of a `ConnectionAdapter` subclass
- `TM1Client` never touches auth or URL — calls `adapter.request(method, path, opts)`

### How routes create TM1Client

```js
// Current:
const cl = new TM1Client(serverName, req.ideToken)

// New:
const adapter = adapterRegistry.getAdapter(serverName, req.ideUser)
const cl = new TM1Client(serverName, adapter)
```

`adapterRegistry` resolves the correct adapter for the server from `servers.json` config, authenticating on first use per user session.

### Adapter Registry

```
adapterRegistry
  ├── getAdapter(serverName, ideUser) → ConnectionAdapter
  ├── authenticate(serverName, credentials) → AuthSession
  └── invalidate(serverName, ideUser)
```

- Maintains a `Map<serverName, Map<ideUser, AdapterInstance>>`
- On first access: reads server config, creates adapter, calls `authenticate()`
- Subsequent calls: returns cached adapter instance
- Uses the same per-user session pattern as current `paw_connect.js`

---

## Migration Path

### Phase 1 — New adapters alongside PAW (current sprint)

1. Add `direct-v11` and `paw-oauth2` adapters
2. `servers.json` schema evolves (backward compatible — flat list still works with PAW)
3. `TM1Client` constructor updated to accept adapter parameter
4. Old single-arg constructor deprecated but works (defaults to PAW adapter)
5. All routes updated to pass adapter instead of `ideToken`

### Phase 2 — Remove PAW dependency (optional)

1. Drop `paw-native` adapter from the codebase
2. Remove `PAW_HOST`/`PAW_USERNAME`/`PAW_PASSWORD` from `.env`
3. Simplify `paw_connect.js` to `null` (no-op)
4. All servers connect direct

### Phase 3 — Drop single-adapter backward compat

1. Remove old `new TM1Client(serverName, ideToken)` signature
2. All routes pass adapter explicitly

---

## File Changes

| File | Change |
|---|---|
| `core/tm1_client.js` | Accept adapter instead of ideToken. Delegate `get`/`post`/`patch`/`delete`/`_runTI` to adapter. |
| `core/adapter_registry.js` | **New.** Caches adapter instances per server+user. |  
| `core/adapters/paw_native.js` | **New.** Extracted from existing `paw_connect.js` logic, wrapped in adapter interface. |
| `core/adapters/direct_v11.js` | **New.** Basic auth, no session. |
| `core/adapters/paw_oauth2.js` | **New.** PAW OAuth2 client credentials → Bearer token. URL prefix `/api/v1/tm1/` (not v0). |
| `server.js` | All `new TM1Client(server, req.ideToken)` → `new TM1Client(server, adapter)`. User management routes no longer special-case PAW_LOGIN_SERVER. |
| `config/servers.json` | Schema v2 with `adminHosts` + `connections` + per-server adapter config. |
| `.env` | Remove `PAW_HOST`/`PAW_USERNAME`/`PAW_PASSWORD`/`PAW_AUTH_MODE` (or keep for paw-native backward compat). |

---

## Future Phases (Not Implemented)

### CAM Namespace Support

`direct-v11` already supports optional `camNamespace` header. If the config includes `camNamespace`, the adapter adds `CAMNamespace: {value}` to every request. No code change needed after initial implementation.

### Cloud (IBM PA on AWS)

New adapter `cloud-v12`:
- Auth: IAM API Key → Bearer token from `https://iam.cloud.ibm.com/identity/token`
- Base URL: `https://{region}.aws.planninganalytics.ibm.com/api/v0/tm1/{instance}`
- Session: Bearer token with 60-min expiry, auto-refreshed

Requires IBM Cloud account to test — deferred until a client needs it.

### NTLM / Kerberos

New adapter `direct-v11-ntlm`:
- Uses `axios-ntlm` package for SPNEGO negotiation
- Requires `user`/`password`/`domain` in config
- Ties to Windows domain auth — rare in practice, deferred.
