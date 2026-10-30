# Plan — authentication

Status: **for James's approval** · 4 Oct 2026 · the reference is [AUTHENTICATION.md](AUTHENTICATION.md).

## Goal

Signing in works like TM1 Architect: **no app login — you pick a server and sign in to that server**, in whatever
way that server's security requires. Every security setup a TM1 site runs is covered, every claim in the docs is
either tested on a real server or plainly labelled untested, and the IDE never locks an account.

## Principles

1. **Architect is the baseline.** No IDE user list, no fixed login server. A server login is the only login.
2. **The server decides the method.** The IDE detects what a server accepts and shows the right sign-in — users
   don't pick "an authentication method" unless something unusual needs overriding.
3. **Never retry a rejected password.** One attempt per click; TM1's `MaximumLoginAttempts` is never tripped by the IDE.
4. **One TM1 session per server**, closed on sign-out.
5. **Passwords are never stored** — only the method, username and namespace are remembered per server.
6. **Honest status.** ✅ only after a real-server test; otherwise "untested", with the reason (e.g. CAM: built to
   IBM's documented format and TM1py's proven behaviour, no CAM lab).

## Phase 1 — this release (ships this week)

| # | Item | Status |
|---|---|---|
| 1.1 | Per-server credentials; 401 `needsServerLogin` before any TM1 call; rejected = dropped, never retried | **Tested ✅** |
| 1.2 | One TM1 session per server (`TM1SessionId` reuse), sessions closed on sign-out | **Tested ✅** (8 calls → 0 new sessions) |
| 1.3 | Sign-in dialog per server + "Use my current login" + "Set up new server" (blank admin) | **Tested ✅** |
| 1.4 | User Management acts on the selected server | **Tested ✅** |
| 1.5 | MCP per-server service credentials (`serverCredentials`), fail fast on rejection | **Tested ✅** (5 MCP calls → 1 session) |
| 1.6 | **Architect model:** no IDE login when the IDE listens on localhost only; when exposed to the network, the login page asks you to sign in to *any* server you have an account on. `loginServer` retired (optional default only) | **Tested ✅** |
| 1.7 | Check why the IDE listens on all interfaces (`*:8083`); default back to `127.0.0.1` | **Checked** — `.env` sets `HOST=0.0.0.0` deliberately (LAN access); James to decide |
| 1.8 | Server picker shows each server's state (signed in / sign in / rejected) with a "Sign in" action | **Tested ✅** |
| 1.9 | **Detect the method:** one request *without credentials*; read TM1's `WWW-Authenticate` (Basic, CAMNamespace, CAMPassport + gateway, Negotiate). No login attempt, so no lockout risk | **Tested ✅** |
| 1.10 | **Adaptive sign-in dialog:** native/LDAP → user + password; CAM → + namespace | **Tested ✅** |
| 1.11 | **CAM credentials** — header matched step by step to TM1py's implementation; labelled **untested** | **Built** — identical to TM1py; untested (no CAM lab) |
| 1.12 | Remember method + username + namespace per server (never the password) | **Tested ✅** |
| 1.13 | **"Test connection"** diagnostic in the dialog — shows what the server accepts and what the IDE would do, no credentials needed; safe to screenshot for remote testers | **Tested ✅** |
| 1.14 | **Brand-new server on the network sign-in page** — "set the admin password" path (one blank-admin attempt, password must be set before continuing) | **Built** — awaiting test |
| 1.15 | **Sample-password warning** — signing in as `admin` with IBM's well-known sample password shows "change it before sharing this IDE" | **Tested ✅** |

**Testing (Phase 1):** the 8 cases below on a lab server given a different password just before the test, plus
1.9's detection on a native-security lab server. CAM: no lab — shipped as untested.

1. Open a server → sign-in appears; correct password → works; 1–2 TM1 sessions, not one per click
2. Wrong password → one failure, no retries, account not locked
3. Signing in to one server leaves the others unaffected
4. Sign out / close → TM1 sessions ended
5. Fresh server (blank admin) → Set up new server end to end
6. User Management targets the selected server; resetting your own password keeps you signed in
7. MCP against a server with its own service credentials
8. Regression: direct and PAW setups still work; local mode opens with no IDE login

## Phase 2 — next

| # | Item | Notes |
|---|---|---|
| 2.1 | **Connections screen** — add/edit connections in the IDE instead of `servers.json`: v11 admin host (discovers servers), single v11 server URL, PAW, v12 cloud, v12 on-prem / Cloud Pak for Data; TLS settings per connection | Replaces hand-editing |
| 2.2 | **CAM single sign-on** — passport from the Cognos gateway → `CAMPassport`, as TM1py does | Untested (no CAM lab) |
| 2.3 | **v12 Planning Analytics as a Service** — API key (`apikey` : key) | Testable only with a PAaaS tenant |
| 2.4 | **v12 on-prem / Cloud Pak for Data** — app client ID + secret → token; and "Sign in with PAW" for people (interactive OAuth, SSO through the identity provider) | Lab: PAW v12 (.223) + Authentik (.171) — start the TM1 v12 engine first (PAW showed 0 databases on 4 Oct). On-prem PAW v12 admin has **no** "authorized applications" page (checked 4 Oct) — in the lab, app clients (ID + secret) are registered **in Authentik** (the identity provider), not in PAW; the existing client is most likely PAW's own. Test: register a "TM1 IDE" app in Authentik and check whether PAW / the TM1 v12 engine accept its token; if not, drive PAW's own sign-in. Reference flow in the old tm1_cubemap project. Existing `paw-oauth2` adapter never tested |
| 2.4b | **v11 OpenID Connect** (`SupportOpenConnect`) — same flow as 2.4 (register the IDE in the identity provider, browser sign-in, code); matches Cubewise Canvas's documented approach | Exact hand-over to TM1 unconfirmed; needs a v11 server with OIDC on |
| 2.5 | **PAW adapters get TLS options** (verify / chain-only / CA file) | Same as direct |
| 2.6 | **Service credentials to the OS keychain** instead of plain text in `servers.json` | |
| 2.7 | **Published Lens sign-in** (same-origin PAW / OAuth / in-frame fallback) — reuses the sign-in dialog | See LENSES_PLAN.md |
| 2.8 | **Admin-host discovery** — list every server the admin host reports (no login needed), like Architect; the `servers` list becomes an optional filter (e.g. hide PROD) | New servers appear automatically |
| 2.9 | **First-run setup code** — fresh network install with nothing configured prints a one-time random code to the console (and a file only the installing account can read); entering it unlocks "Set up this IDE" to add the first admin host. Proves access to the machine, as Jenkins does. Skipped for local-only | Everything except `HOST`/`PORT` then lives inside the IDE |
| 2.10 | **Running the IDE centrally** (on the TM1 server or a shared box) — HTTPS between laptop and IDE (passwords otherwise cross the network in clear), stored SQL logins / AI key per user or admin-only, option to restrict which servers can be used to sign in | Documented as its own section |
| 2.11 | **"AI agent (MCP)" settings panel** — per server: the account the MCP signs in with (password write-only, Test sign-in), its TM1 groups with a warning if ADMIN/security admin, allowed = Build / Read-only / Not allowed, deploy targets it may contact, which server it works on. Admin-only on a network install | Today: `.mcp.json` + `servers.json` by hand. Changes apply live (MCP re-reads `servers.json`); working server needs an MCP reconnect |
| 2.12 | **Dedicated agent account** — "Create agent account" creates `ai-agent` on a server with build rights but no security admin; recommended over `admin` so TM1's own logs show the agent too. Guide: same advice for any automation account | Today the MCP signs in as `admin` |

## Phase 3 — last

| # | Item | Notes |
|---|---|---|
| 3.1 | **Windows integrated login (mode 3)** — Kerberos/NTLM `Negotiate` | Works only where the IDE runs on the user's Windows machine; needs a Windows test domain |
| 3.2 | CAM first-admin assistant (guided mode 4 → 1 → 5) | Restarts and `tm1s.cfg` edits stay with the admin |

## Docs (with every phase)

- AUTHENTICATION.md: At-a-glance rows move to ✅ only after testing; Known issues closed as fixed; rewrite
  "Signing in to the IDE — the login server" for the Architect model (1.6).
- SETUP.md: `servers.json` changes (`serverCredentials`, `loginServer` retired), then the Connections screen.
- README notice: remove once the release ships.

## Not doing

- Token in a URL, shared accounts that bypass TM1 security, storing user passwords on disk.
- OAuth "client credentials" as a supported v12 path (IBM documents it as unsupported) — kept for the lab only.

## Decisions (agreed 4 Oct 2026)

- Network-mode front door = **sign in with a TM1 account** through any server (option A) — no separate IDE password
  (a shared password has no identity; a per-user list duplicates TM1's own user store).
- Users already have TM1 accounts — the IDE is for TM1 developers/admins; nothing new to create.
- Sample servers' default login (admin/apple) is fine for a lab, never for anything shared — the IDE warns about it.

- Architect model — no app login (local); sign in via any server when networked.
- CAM shipped as untested, built to IBM's format and TM1py's proven behaviour; confirmed at the first real CAM site.
- "Use my current login" button: yes (one attempt). Server logins remembered across restarts: no (memory only).
  MCP service credentials per server in `servers.json` for now.
