# TM1 IDE — Authentication

How the IDE signs in to TM1: the session layer, the three adapters, and the auth API.

← [Back to README](../README.md)

---

## 🔐 Authentication — Complete Reference

> **Security model:** TM1 IDE is a **local, single-user developer tool** — it binds `127.0.0.1` by default and trusts your OS user account. See **[SECURITY.md](../SECURITY.md)** for the full model and what a shared-server deployment would require.

This section documents everything about how authentication works in the IDE — the session layer that is common to all setups, the three adapter paths, TM1's own auth mechanics, and the one feature that requires PAW regardless of adapter.

---

### The IDE Session Layer

The session system is adapter-agnostic at the frontend. The browser never talks to TM1 or PAW directly — all calls go through the Express backend, which manages auth on behalf of each user.

**Session lifecycle:**

1. User submits username + password to `POST /api/auth/login` (rate-limited: 10 attempts / 15 min / IP)
2. Server creates a session entry in an in-memory Map (in `core/paw_connect.js`): `Map<uuid-token, { username, password, session, expiry, lastSeen }>`
3. UUID token returned to browser → stored in `localStorage` as `tm1-token`
4. Browser sends `x-ide-token: <uuid>` header on **every** subsequent API request
5. Server middleware validates the token on every `/api/*` request (except `/api/auth/login` and `/api/auth/logout`), bumping `lastSeen`
6. **Token idle expiry:** a token unused for **12 hours** (`IDLE_TTL` in `paw_connect.js`) is dropped — the user must log in again. This is the only expiry that applies in `direct-v11` mode.
7. **PAW cookie refresh (paw-native only):** the PAW SSO session behind the token is refreshed every **10 minutes** (`SESSION_TTL`) using the stored credentials — transparent to the user, independent of the idle expiry above

What the `session` field contains differs by adapter:

| Adapter | `session` value |
|---------|----------------|
| `direct-v11` | `null` — credentials live in the Map, re-encoded as Basic Auth per request |
| `paw-native` | Live axios instance with a `tough-cookie` jar holding the PAW SSO session |
| `paw-oauth2` | Not per-user — a shared OAuth2 token cached at the connection level |

**Multi-user isolation:**

Multiple users can be logged in simultaneously. Each login produces an independent Map entry keyed by its own UUID. There is no shared state between users — each gets their own credential store, their own PAW session (if applicable), and their own active **Change Set** per server so audit trails never collide.

---

### Option A — direct-v11 (HTTP Basic Auth)

Recommended for home lab and dev environments. Connects directly to the TM1 Admin Server — no PAW required.

#### What "direct-v11" means

TM1 has exposed an HTTP REST API since V11 (Planning Analytics 2.0.x). Every TM1 installation has an **Admin Server** process that listens on `HTTPPortNumber` (default `5895`, set in `tm1s.cfg`). This admin server:

- Serves `GET /api/v1/Servers` — a list of all TM1 server instances it manages, including each server's own HTTP port and whether it uses SSL
- Acts as a discovery endpoint so the IDE can resolve the individual REST API base URL for each named server

Once resolved, all subsequent TM1 API calls go directly to the individual server's port — the admin server is not involved again (the URL is cached).

#### direct-v11 Login Flow

1. User enters TM1 username + password in the IDE login screen
2. `POST /api/auth/login` — server calls `createDirectSession(username, password)`:
   - Credentials stored in session Map with `session: null`
   - **Immediate credential probe**: `GET /api/v1/Configuration` on the `loginServer` — a live TM1 call to verify credentials before issuing a token
   - If TM1 rejects → session deleted → `401` returned with `"Login failed — check your TM1 credentials"`
   - If TM1 accepts → UUID token returned to browser

#### direct-v11 Per-Request Auth

On every outbound TM1 call, `DirectV11Adapter._headers()` encodes the session credentials:

```
Authorization: Basic base64(username:password)
```

Sent on every HTTP request. No persistent connection, no cookie, no CSRF token. TM1 validates the credentials on each call independently.

**LDAP/AD-integrated TM1 servers:**  
If your TM1 server uses CAM (Cognos Access Manager) with an LDAP or Active Directory namespace, add `"camNamespace": "YourNamespace"` to the admin host entry in `servers.json`. The adapter sends it as a `CAMNamespace` header alongside `Authorization`, which tells TM1 to validate the credentials against the named namespace rather than TM1 native auth.

#### URL resolution

The `adapter_registry.js` resolves each server's base URL on first use:

```
GET http://<adminHost>:<HTTPPortNumber>/api/v1/Servers
→ find entry where Name matches serverName
→ build base URL: http://<adminHost>:<server.HTTPPortNumber>
```

The resolved URL is cached in `_urlCache`. All TM1 API calls then go to:

```
http://<server-ip>:<server-port>/api/v1/<path>
```

#### Credential resolution priority

`adapter_registry.js` prefers the **logged-in user's credentials** (from `getSessionCredentials(ideToken)`) over the static credentials in `servers.json`. This means:

- If a user logs in with their own TM1 username/password, all their API calls use those credentials
- If `getSessionCredentials` returns null (e.g. an unauthenticated internal call), it falls back to the `username`/`password` fields in `servers.json`

#### Access control

TM1 enforces access server-side based on `}ClientGroups` membership — exactly as it does in TM1 Architect or Perspectives. The IDE makes no access decisions of its own. What a user can read or write in the IDE reflects precisely what their TM1 groups allow.

---

### Option B — paw-native (PAW Cookie Session)

For environments where TM1 is accessed through Planning Analytics Workspace. PAW acts as an authenticated reverse proxy — the IDE authenticates with PAW, and PAW forwards all TM1 REST API calls to the underlying TM1 server.

#### What PAW is

Planning Analytics Workspace (PAW) is IBM's web analytics platform for TM1. It runs as a separate service (typically on port 80/443) and exposes the TM1 REST API through its own auth layer at:

```
${PAW_HOST}/api/v0/tm1/${serverName}/api/v1/${path}
```

All TM1 REST API endpoints are available through this proxy URL — the path after `/api/v1/` is identical to what you would call directly. PAW adds its own session validation layer on top.

#### paw-native Login Flow

1. User submits username + password
2. `createSession(username, password)` POSTs to PAW's login form:

   ```http
   POST ${PAW_HOST}/login/form/
   Content-Type: application/x-www-form-urlencoded

   username=...&password=...&mode=basic
   ```

3. PAW validates the credentials against the configured **TM1 Login Server**
4. On success: PAW sets a `ba-sso-csrf` cookie (a CSRF prevention token)
5. The IDE captures the full response cookie jar using `axios-cookiejar-support` + `tough-cookie` — the cookie jar persists for the life of the session
6. UUID token returned to browser

If PAW rejects the login (wrong credentials, unreachable server), the `ba-sso-csrf` cookie is never set. `_login()` throws `"PAW login failed — ba-sso-csrf cookie not set"`, which the login route catches and returns as `401`.

#### paw-native Per-Request Auth

On every TM1 API call:

1. `getCachedPawSession(token)` retrieves the axios instance with its cookie jar — re-authenticates silently if the 10-minute TTL has expired
2. `getCSRF(session)` reads the current `ba-sso-csrf` cookie value from the jar
3. Request sent with the cookie jar (all PAW cookies included automatically) plus an explicit CSRF header: `ba-sso-authenticity: <csrf-value>`
4. PAW validates the session and CSRF token, then proxies the call to TM1

#### TM1 Login Server

PAW validates all logins against exactly one TM1 server — the **TM1 Login Server** configured in the PAW Admin Console under _Configuration → TM1 Login Server URI_. This is the server that holds the master user list for PAW authentication.

- Users must exist in `}Clients` on this specific server to log into PAW (and therefore the IDE)
- Users must have logged into the PAW workspace directly at least once to have an active workspace profile
- Set `loginServer` in `servers.json` (or `PAW_LOGIN_SERVER` in `.env` for the plain-array format) to match the PAW Login Server name — the IDE uses this to tell the login screen which server is the authority

Once authenticated, the PAW session grants access to any server registered under that PAW instance — the user's `}ClientGroups` on each individual server still control what they can actually do.

#### User management

With `paw-native`, the shield icon in the app header opens the **User Management** panel. This provisions users directly via the TM1 REST API through PAW:

- List, create, update, and delete `}Client` elements
- Set passwords and assign `}ClientGroup` memberships
- Changes are live — no TM1 server restart required

---

### Option C — paw-oauth2 (Authentik / OAuth2)

For PAW V12 environments using Authentik as the identity provider.

#### Key difference from paw-native

`paw-oauth2` uses a **machine credential** — a single client ID + secret that represents the IDE as a service account. There are no per-user PAW sessions. The `PawOAuth2Adapter` fetches an OAuth2 access token using the machine credential and caches it per connection (`{connection.name}::{serverName}`). The token is refreshed automatically when it expires.

This means all IDE users' TM1 calls are made under the service account identity from PAW's perspective. TM1 still applies `}ClientGroups` access control server-side — the service account must have the appropriate group memberships for the operations the IDE performs.

#### Configuration

```json
{
  "connections": [
    {
      "name": "prod",
      "adapter": "paw-oauth2",
      "pawHost": "http://192.168.x.x",
      "loginServer": "Production",
      "client_id": "tm1-ide",
      "client_secret": "your_secret",
      "servers": ["Production"]
    }
  ]
}
```

---

### How the Adapter Registry Selects an Adapter

`core/adapter_registry.js` runs on every API request. Selection order:

1. Load `config/servers.json`
2. Search `adminHosts[]` — if the requested `serverName` appears in `h.servers`, use `DirectV11Adapter` with that admin host's URL and credentials
3. Search `connections[]` — if the requested `serverName` appears in `c.servers` (or equals `c.name`), use the adapter named by `c.adapter`
4. If `servers.json` is a plain array (legacy format): wrap all servers in a single implicit `paw-native` connection using `PAW_HOST` from `.env`

The default adapter type is determined by `getDefaultAdapterType()` which reads the first entry in `adminHosts` or `connections`. The login route uses this to decide whether to call `createDirectSession` (direct-v11) or `createSession` (PAW-based).

---

### PAW Books — The One PAW-Specific Feature

The **Used In → PAW Books** panel in the View Editor is the only feature in the IDE that requires a live PAW connection regardless of how you have TM1 auth configured.

It calls PAW's content management API:

```
GET ${PAW_HOST}/pacontent/v1/Assets(path='...')/Assets
```

This recursively walks the PAW content tree under `/shared` and `/users`, finding dashboards and workbenches. For each book found, it fetches the full content JSON and inspects the embedded TM1 view references (`PAProperties.tm1`, `Models_internal.data.parentStore`). Books that reference the current cube and view are returned as clickable links.

This API is a PAW workspace endpoint — it has no equivalent in the TM1 REST API v1. When the IDE is connected via `direct-v11` (no PAW), the endpoint immediately returns `{ books: [], pawUnavailable: true }` and the PAW Books section is silently suppressed in the UI. The **TI Processes** half of Used In continues to work via the standard TM1 REST API regardless of adapter.

---

### Connection Adapters — Quick Reference

| Adapter | `servers.json` key | Auth mechanism | PAW required | Credential scope |
|---------|-------------------|----------------|--------------|-----------------|
| `direct-v11` | `"adapter": "direct-v11"` | HTTP Basic Auth, per-request | No | Per-user (falls back to servers.json static creds) |
| `paw-native` | `"adapter": "paw-native"` | PAW cookie jar + CSRF header | Yes | Per-user PAW session |
| `paw-oauth2` | `"adapter": "paw-oauth2"` | OAuth2 machine credential | Yes | Shared service account |

<details>
<summary>Advanced servers.json — mixing adapters and PAW hosts</summary>

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
      "loginServer": "Staging",
      "username": "admin",
      "password": "your_password",
      "servers": ["Staging"]
    }
  ]
}
```

In this configuration, `Production` and `Development` route through PAW (`paw-native`), while `Staging` connects directly via `direct-v11`. The adapter registry resolves the correct path on every request based on which server is being accessed.

</details>

### Auth API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Authenticate. `direct-v11`: stores credentials + probes TM1. `paw-native`: authenticates with PAW form login. Returns `{ token, username }`. |
| `POST` | `/api/auth/logout` | Invalidates the session token. Subsequent requests with that token return `401`. |
| `GET` | `/api/config` | Returns `{ loginServer }` — used by the login screen to pre-fill the server selector. |
| `GET` | `/api/users` | List all TM1 `}Client` elements on the login server. |
| `POST` | `/api/users/provision` | Create a user with password and group assignments. |
| `PATCH` | `/api/users/:name` | Update user properties. |
| `DELETE` | `/api/users/:name` | Delete a user from `}Clients`. |
| `POST` | `/api/users/:name/password` | Reset a user's TM1 password. |
| `GET` | `/api/paw/book-usage` | List PAW workbooks that embed a given view. Returns `{ books: [], pawUnavailable: true }` when no PAW session is available. |

---

See also: [MULTI_USER_LOGIN.md](MULTI_USER_LOGIN.md) · [ADAPTER_INTERFACE.md](ADAPTER_INTERFACE.md).
