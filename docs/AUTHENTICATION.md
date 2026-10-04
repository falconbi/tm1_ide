# TM1 IDE — Authentication

How the IDE signs in to TM1 — every TM1 security setup, what the IDE supports today, what it doesn't yet,
and how each one works.

← [Back to README](../README.md)

---

## At a glance

| TM1 security setup | How TM1 accepts it (REST) | IDE today | Planned |
|---|---|---|---|
| **v11 native** (mode 1, or 2 with a TM1 login) | `Authorization: Basic` | ✅ Supported (direct or via PAW) | — |
| **v11 LDAP password check** (`PasswordSource=LDAP`) | `Authorization: Basic` | ✅ Supported | — |
| **v11 CAM — user + password** (mode 4/5) | `Authorization: CAMNamespace base64(user:password:namespace)` | ⚠️ Direct: built — header identical to TM1py's; not yet confirmed on a CAM server. Via PAW: works | Confirm at first CAM site |
| **v11 CAM — single sign-on** | CAM passport from the Cognos gateway → `Authorization: CAMPassport …` | ⚠️ Via PAW only | Direct SSO |
| **v11 OpenID Connect** (`SupportOpenConnect=T`) | Identity-provider sign-in (code from the provider) | ❌ Not supported | Phase 2, with v12 sign-in |
| **v11 Windows integrated** (mode 2/3) | Kerberos / NTLM (`Negotiate`) | ❌ Not supported | Last |
| **v12 Planning Analytics as a Service** | API key as Basic (`apikey` : key) | ❌ Not supported | Next |
| **v12 on-prem / Cloud Pak for Data** | App client ID + secret → token → `Bearer` | ❌ An adapter exists (`paw-oauth2`) but has **never been tested** against a v12 server | Phase 2 — test on the v12 lab |
| **Different login per server** | — | ✅ Tested (v11.8: separate sign-in per server, sign-out ends the TM1 session) | — |

✅ supported and tested · ⚠️ partial or unverified · ❌ not yet. A row only moves to ✅ after it has been tested
against a real server of that type.

---

## Signing in to the IDE

The IDE works like TM1 Architect: **there is no IDE user list and no "app login" — you sign in to TM1 servers.**

| Where the IDE can be reached | What happens |
|---|---|
| **This machine only** (`HOST=127.0.0.1`, the default) | The IDE opens straight away. Pick a server; the first time you use it, it asks for **that server's** login. |
| **The network** (`HOST=0.0.0.0`) | A sign-in page appears first: choose any TM1 server you have an account on and sign in to it. That proves who you are — and signs you in to that server. |

Two settings in `.env` control this:

```
HOST=127.0.0.1      # who can reach the IDE: this machine only (default) — or 0.0.0.0 for the network
IDE_LOGIN=auto      # auto (default): sign-in page only when reachable from the network
                    # always: show the sign-in page even when local (e.g. a shared PC)
```

There is deliberately **no way to switch the sign-in page off for a network-reachable IDE**: the IDE holds things TM1
doesn't protect (stored SQL connection logins, the AI provider key, change history), so anyone who can reach it must
sign in. The status bar shows which mode you're in: **Local only** or **Network**. Changing `HOST` needs a restart.

**A brand-new server** (user `admin`, blank password): on the sign-in page — or in the per-server sign-in dialog —
choose *"Brand-new server? Set it up"*. The IDE signs in as `admin` with the blank password **once**, makes you set a
password, then signs you in with it. It is never left signed in on a blank password. This is the IDE's replacement for
using TM1 Architect to set a first password.

**Sample passwords.** Signing in as `admin` with IBM's published sample password (`apple`) shows a warning: fine in a
lab, an open door anywhere others can reach.

**Each server, its own login.** Signing in to one server never signs you in to another — the IDE never tries one
server's password on a different server. The server picker shows the selected server's state (signed in as … /
**Sign in** / login rejected) with Sign in and Sign out.

**The sign-in dialog adapts to the server.** Before asking for anything, the IDE asks the server how it wants to be
signed in to — without sending credentials, so it can't count as a failed login — and shows the right fields:
username + password for TM1 security or the LDAP check; plus a **namespace** for CAM. *Connection details* in the
dialog shows exactly what the server answered — safe to screenshot, no credentials involved. The username (and CAM
namespace) is remembered per server in your browser; **passwords never are**.

**Who did what.** Change sets record the username you signed in to *that server* with.

## How TM1 sign-in works

The general, tool-independent explanation — every method step by step, directory vs CAM vs single sign-on, the
first administrator on a new server, sessions and lock-outs, TLS — is in the
**[TM1 Authentication Guide](TM1_AUTHENTICATION_GUIDE.md)**. This page covers only what the IDE does.

## Security model

- **Local, single-user tool by default.** The IDE binds to `127.0.0.1` and trusts your OS account. See
  [SECURITY.md](../SECURITY.md) for what a shared deployment would need.
- **Your TM1 password stays on your machine** — held in the IDE server's memory for the life of the session (it
  is needed to re-sign in to PAW and, until session reuse lands, on every direct call). It is never written to
  disk by the login flow and never sent to the browser; the browser holds only a random session token.
- **Service credentials in `config/servers.json`** (the fallback login, the PAW OAuth client secret) are stored
  **in plain text** — protect that file (it is git-ignored). Moving them to the OS keychain is on the list.
- **TM1 decides access.** The IDE makes no access decisions of its own; your TM1 groups apply exactly as in any
  other TM1 tool.
- **Login throttling:** 10 attempts / 15 minutes per IP on the IDE login. TM1's own `MaximumLoginAttempts` still
  applies — the IDE must never keep retrying a rejected password (see Known issues).

### TLS

Per server in `servers.json`: `"tls": "verify"` (default — full certificate check), `"chain-only"` (checks the
certificate is signed by a trusted authority but not the host name — right for IBM's stock TM1 certificate) or
`"insecure"` (no check; throwaway labs only). `"tlsCaFile"` adds your own CA. The PAW adapters do not yet have
these options. Note: some VS Code extensions disable certificate checking for every Node process they start —
test TLS outside them.

---

## Published Lenses (embedded in a PAW book)

A Lens published into a PAW book (URL widget — HTTPS only) has no IDE around it, so it has no IDE session, and
browsers block cross-site cookies, so a Lens on another server can't borrow the viewer's PAW login.

**Principle: a published Lens runs as the viewer — never as its author, never as a shared account** — so TM1
security decides what each viewer sees, exactly as for the book around it.

| Option | When |
|---|---|
| **Same address as PAW** — published under PAW's HTTPS address; calls PAW's TM1 API with the viewer's own PAW session | v11 / on-prem PAW (preferred) |
| **OAuth sign-in** — the Lens is a PAW "authorized application"; the viewer signs in and the token carries their identity | v12 / PAW cloud (preferred) |
| **Login inside the frame** — the Lens asks for a sign-in itself | Fallback; acceptable in some cases |
| Token in the URL · shared service account | ❌ Never (leaks credentials / bypasses TM1 security) |

Status: designed, not built. Detail: [LENSES_PLAN.md](LENSES_PLAN.md).

## Known issues

Stated plainly. Items marked **Fixed** were tested on a real TM1 v11.8 server on 4 Oct 2026.

1. ~~One login for every server.~~ **Fixed** — each server has its own sign-in; a wrong password gives one clear
   rejection and is never retried (tested: wrong password once, then the right one worked — account not locked).
2. ~~A new TM1 session on every request.~~ **Fixed** — one session per server, reused for everything and closed on
   sign-out (measured: a lab server had 538 leaked sessions before; after the fix several minutes of browsing added none,
   and signing out closed the session on the server).
3. **Direct CAM is untested.** The header is identical to TM1py's, but no CAM server has been available to confirm it.
4. ~~User Management acted on the login server.~~ **Fixed** — it manages the server selected in the IDE, and says so
   (with a Sign in button) when you're not signed in to it.
5. **The PAW OAuth adapter (`paw-oauth2`) is untested** and uses the "client credentials" flow, which IBM documents as
   not supported for Planning Analytics authorized applications. An earlier version of this page called it "lab-proven" —
   that was not backed by a test and has been corrected (4 Oct 2026). It is not a supported v12 path.
6. **The IDE↔browser connection is plain HTTP.** Fine on one machine; when the IDE is reachable from the network,
   passwords typed in the browser cross the network unencrypted. HTTPS for the IDE is planned (central installs).

## Roadmap

1. **This release** ([plan](AUTHENTICATION_PLAN.md)): per-server login (with a login prompt per server and no retrying of rejected passwords),
   "Set up new server", User Management on the selected server, session reuse, direct CAM credentials.
2. **Next:** v12 API keys (Planning Analytics as a Service), v12 client ID/secret tokens (on-prem, Cloud Pak for
   Data), CAM single sign-on.
3. **Last:** Windows integrated login (mode 3).

---

# Reference — how the IDE implements it today

#### The IDE Session Layer

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

##### What "direct-v11" means

TM1 has exposed an HTTP REST API since V11 (Planning Analytics 2.0.x). Every TM1 installation has an **Admin Server** process that listens on `HTTPPortNumber` (default `5895`, set in `tm1s.cfg`). This admin server:

- Serves `GET /api/v1/Servers` — a list of all TM1 server instances it manages, including each server's own HTTP port and whether it uses SSL
- Acts as a discovery endpoint so the IDE can resolve the individual REST API base URL for each named server

Once resolved, all subsequent TM1 API calls go directly to the individual server's port — the admin server is not involved again (the URL is cached).

##### direct-v11 Login Flow

1. User enters TM1 username + password in the IDE login screen
2. `POST /api/auth/login` — server calls `createDirectSession(username, password)`:
   - Credentials stored in session Map with `session: null`
   - **Immediate credential probe**: `GET /api/v1/Configuration` on the `loginServer` — a live TM1 call to verify credentials before issuing a token
   - If TM1 rejects → session deleted → `401` returned with `"Login failed — check your TM1 credentials"`
   - If TM1 accepts → UUID token returned to browser

##### direct-v11 Per-Request Auth

On every outbound TM1 call, `DirectV11Adapter._headers()` encodes the session credentials:

```
Authorization: Basic base64(username:password)
```

Sent on every HTTP request. No persistent connection, no cookie, no CSRF token. TM1 validates the credentials on each call independently.

> ⚠️ **Known issue (fix scheduled):** because the `TM1SessionId` cookie TM1 returns is not kept, **every request opens a new TM1 session** — measured on a v11.8 server: 6 calls → 6 new sessions, each lingering until TM1's session timeout. See [Known issues](#known-issues).

**CAM servers (mode 4/5):**  
A `"camNamespace": "YourNamespace"` field exists in `servers.json`, but the adapter currently sends it as a separate `CAMNamespace` header next to `Authorization: Basic`. That is **not** the format TM1 documents (`Authorization: CAMNamespace base64(user:password:namespace)`) and has **not been verified** against a CAM server — treat direct CAM as unsupported until fixed. CAM works today through PAW (`paw-native`).

**LDAP password validation (`PasswordSource=LDAP`):** works as native — TM1 checks the Basic credentials against the directory.

##### URL resolution

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

##### Credential resolution priority

`adapter_registry.js` prefers the **logged-in user's credentials** (from `getSessionCredentials(ideToken)`) over the static credentials in `servers.json`. This means:

- If a user logs in with their own TM1 username/password, all their API calls use those credentials
- If `getSessionCredentials` returns null (e.g. an unauthenticated internal call), it falls back to the `username`/`password` fields in `servers.json`

##### Access control

TM1 enforces access server-side based on `}ClientGroups` membership — exactly as it does in TM1 Architect or Perspectives. The IDE makes no access decisions of its own. What a user can read or write in the IDE reflects precisely what their TM1 groups allow.

---

### Option B — paw-native (PAW Cookie Session)

For environments where TM1 is accessed through Planning Analytics Workspace. PAW acts as an authenticated reverse proxy — the IDE authenticates with PAW, and PAW forwards all TM1 REST API calls to the underlying TM1 server.

##### What PAW is

Planning Analytics Workspace (PAW) is IBM's web analytics platform for TM1. It runs as a separate service (typically on port 80/443) and exposes the TM1 REST API through its own auth layer at:

```
${PAW_HOST}/api/v0/tm1/${serverName}/api/v1/${path}
```

All TM1 REST API endpoints are available through this proxy URL — the path after `/api/v1/` is identical to what you would call directly. PAW adds its own session validation layer on top.

##### paw-native Login Flow

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

##### paw-native Per-Request Auth

On every TM1 API call:

1. `getCachedPawSession(token)` retrieves the axios instance with its cookie jar — re-authenticates silently if the 10-minute TTL has expired
2. `getCSRF(session)` reads the current `ba-sso-csrf` cookie value from the jar
3. Request sent with the cookie jar (all PAW cookies included automatically) plus an explicit CSRF header: `ba-sso-authenticity: <csrf-value>`
4. PAW validates the session and CSRF token, then proxies the call to TM1

##### TM1 Login Server

PAW validates all logins against exactly one TM1 server — the **TM1 Login Server** configured in the PAW Admin Console under _Configuration → TM1 Login Server URI_. This is the server that holds the master user list for PAW authentication.

- Users must exist in `}Clients` on this specific server to log into PAW (and therefore the IDE)
- Users must have logged into the PAW workspace directly at least once to have an active workspace profile
- Set `loginServer` in `servers.json` (or `PAW_LOGIN_SERVER` in `.env` for the plain-array format) to match the PAW Login Server name — the IDE uses this to tell the login screen which server is the authority

Once authenticated, the PAW session grants access to any server registered under that PAW instance — the user's `}ClientGroups` on each individual server still control what they can actually do.

##### User management

With `paw-native`, the shield icon in the app header opens the **User Management** panel. This provisions users directly via the TM1 REST API through PAW:

- List, create, update, and delete `}Client` elements
- Set passwords and assign `}ClientGroup` memberships
- Changes are live — no TM1 server restart required

---

### Option C — paw-oauth2 (Authentik / OAuth2)

For PAW V12 environments using Authentik as the identity provider.

##### Key difference from paw-native

`paw-oauth2` uses a **machine credential** — a single client ID + secret that represents the IDE as a service account. There are no per-user PAW sessions. The `PawOAuth2Adapter` fetches an OAuth2 access token using the machine credential and caches it per connection (`{connection.name}::{serverName}`). The token is refreshed automatically when it expires.

This means all IDE users' TM1 calls are made under the service account identity from PAW's perspective. TM1 still applies `}ClientGroups` access control server-side — the service account must have the appropriate group memberships for the operations the IDE performs.

##### Configuration

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

#### How the Adapter Registry Selects an Adapter

`core/adapter_registry.js` runs on every API request. Selection order:

1. Load `config/servers.json`
2. Search `adminHosts[]` — if the requested `serverName` appears in `h.servers`, use `DirectV11Adapter` with that admin host's URL and credentials
3. Search `connections[]` — if the requested `serverName` appears in `c.servers` (or equals `c.name`), use the adapter named by `c.adapter`
4. If `servers.json` is a plain array (legacy format): wrap all servers in a single implicit `paw-native` connection using `PAW_HOST` from `.env`

The default adapter type is determined by `getDefaultAdapterType()` which reads the first entry in `adminHosts` or `connections`. The login route uses this to decide whether to call `createDirectSession` (direct-v11) or `createSession` (PAW-based).

---

#### PAW Books — The One PAW-Specific Feature

The **Used In → PAW Books** panel in the View Editor is the only feature in the IDE that requires a live PAW connection regardless of how you have TM1 auth configured.

It calls PAW's content management API:

```
GET ${PAW_HOST}/pacontent/v1/Assets(path='...')/Assets
```

This recursively walks the PAW content tree under `/shared` and `/users`, finding dashboards and workbenches. For each book found, it fetches the full content JSON and inspects the embedded TM1 view references (`PAProperties.tm1`, `Models_internal.data.parentStore`). Books that reference the current cube and view are returned as clickable links.

This API is a PAW workspace endpoint — it has no equivalent in the TM1 REST API v1. When the IDE is connected via `direct-v11` (no PAW), the endpoint immediately returns `{ books: [], pawUnavailable: true }` and the PAW Books section is silently suppressed in the UI. The **TI Processes** half of Used In continues to work via the standard TM1 REST API regardless of adapter.

---

#### Connection Adapters — Quick Reference

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

#### Auth API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Authenticate. `direct-v11`: stores credentials + probes TM1. `paw-native`: authenticates with PAW form login. Returns `{ token, username }`. |
| `POST` | `/api/auth/logout` | Invalidates the session token. Subsequent requests with that token return `401`. |
| `GET` | `/api/config` | Returns `{ loginServer }` — used by the login screen to pre-fill the server selector. |
| `GET` | `/api/users` | List all TM1 `}Client` elements on the login server. ⚠️ All `/api/users*` routes act on the **login server**, not the server selected in the UI — fix scheduled. |
| `POST` | `/api/users/provision` | Create a user with password and group assignments. |
| `PATCH` | `/api/users/:name` | Update user properties. |
| `DELETE` | `/api/users/:name` | Delete a user from `}Clients`. |
| `POST` | `/api/users/:name/password` | Reset a user's TM1 password. |
| `GET` | `/api/paw/book-usage` | List PAW workbooks that embed a given view. Returns `{ books: [], pawUnavailable: true }` when no PAW session is available. |

---

See also: [MULTI_USER_LOGIN.md](MULTI_USER_LOGIN.md) · [ADAPTER_INTERFACE.md](ADAPTER_INTERFACE.md).
