# Security Model

TM1 IDE is a **local, single-user developer tool**. It runs on your
machine and connects out to the TM1 / Planning Analytics servers you point it at —
the same shape as `aws`, `gh`, `kubectl`, `docker`, or the VS Code CLI.

Its security model follows from that.

---

## Trust boundary: your OS user account

> **Anyone who can log into this machine as you has access to everything TM1 IDE holds.**

That is the deliberate assumption, and it is the same one every local developer
tool makes. TM1 IDE does **not** try to defend against a hostile user inside your
own OS account — that is not a solvable problem and pretending to solve it only
adds friction.

What lives inside that boundary:

| Asset | Location | Readable by |
| --- | --- | --- |
| TM1 admin credentials (`admin` / password) | `config/servers.json` | your OS user (file) |
| Anthropic API key, PAW host/creds | `.env` | your OS user (file) |
| Live TM1 passwords, in plaintext, for the session | Node process memory (`_sessions` map in `core/paw_connect.js`) | your OS user (memory / debugger) |
| IDE session token | browser `localStorage` (`tm1-token`) → browser profile on disk | your OS user (file) |
| Change history, deploy baselines | `change_log.db`, `.tm1baseline/` | your OS user (file) |

All one bucket. Protecting the OS account protects TM1 IDE.

---

## What TM1 IDE does enforce

Because the tool is local, the protections are lightweight and targeted:

1. **Loopback bind.** The server listens on `127.0.0.1` only — it is not reachable
   from the LAN or anywhere else. Override with `HOST=0.0.0.0` **only** if you
   deliberately need LAN access and accept that the browser↔server leg is then
   plaintext HTTP with no transport security. (`server.js`)

2. **Login rate limit.** `POST /api/auth/login` — the one unauthenticated
   endpoint — is throttled to 10 attempts per 15 minutes per IP. Defence in depth
   locally; a real barrier if `HOST` is ever widened. (`server.js`)

3. **Session token expiry.** An IDE token is dropped after 12 hours of inactivity
   and the user must log in again. This is the only expiry that applies in
   `direct-v11` mode. (`core/paw_connect.js`, `IDLE_TTL`)

4. **Custom-header auth = CSRF defence.** Every `/api` call must carry the
   `x-ide-token` header. Browsers block cross-origin pages from setting custom
   headers, so this doubles as CSRF protection — no cookie, no ambient authority.

5. **Secrets are gitignored.** `.env` and `config/servers.json` are in
   `.gitignore` and have never been committed. Keep it that way.

---

## Operational notes

- **Credentials belong in local, gitignored config only.** Never commit
  `servers.json` or `.env`; never paste a password into a log, an issue, or a
  prompt. If TM1 IDE spreads to more people on a team, each person runs their own
  instance with their own config — there is no shared install.

- **Watch for folder sync.** If your working directory sits inside Dropbox /
  OneDrive / iCloud / a synced NAS / Time Machine, then `.env` and `servers.json`
  leave the machine into a place with a weaker or shared trust model. `.gitignore`
  does nothing there. This is the single most realistic leak path for a local
  tool — check that the repo is not inside a synced folder.

- **The IDE↔TM1 leg.** In `direct-v11` mode the adapter sends HTTP Basic auth on
  every request. If that connection is plain **HTTP** over a network (e.g. a lab
  TM1 server on the LAN), those credentials cross the wire base64-encoded, not
  encrypted — only putting TLS on the TM1 server fixes that. When the TM1 server
  **does** use HTTPS, the adapter verifies its certificate against the system
  trust store plus `NODE_EXTRA_CA_CERTS`; use `tlsCaFile` in `servers.json` to
  trust an internal-CA or self-signed cert, or `tlsInsecure: true` to skip
  verification for a throwaway lab box (logged, discouraged).

- **Deploy pushes are a human step.** The deploy pipeline packages changes; a
  person deploys them. The "approval" record is a local log, not an access
  control — appropriate for a single operator, not a substitute for one.

---

## Out of scope: shared-server / multi-user deployment

Running TM1 IDE on a shared server that multiple people reach over the network is
**not supported** and not a missing feature — it is a different product with a
different threat model. Crossing either of these lines would require a coherent
block of work before it is safe:

**Off localhost** (`HOST=0.0.0.0`, a tunnel, a reverse proxy, a cloud VM):

- TLS on the browser↔server leg — without it, login passwords, tokens, and all
  model data are sniffable on the network
- Move the token from `localStorage` to an `HttpOnly; Secure; SameSite` cookie —
  a stolen token is otherwise portable and replayable
- Add a CSRF token — cookie auth removes the custom-header CSRF defence
- Real session lifecycle — enforced expiry, session listing, revoke

**Multi-user** (more than one distinct person logs in):

- Each user authenticates with their own TM1 credentials; drop the
  `servers.json` admin fallback in `core/adapter_registry.js`
- Authorization — connect to TM1 as the logged-in user so TM1's own cell /
  element / object security applies, instead of everyone acting as admin
- Server-enforced deploy gate — `/api/deploy/execute` currently runs with
  `skipRiskCheck: true` and no server-side approval check
- Per-user workspace state — `config/forge.json` and the SQL connection files
  are currently single global files

Until one of those lines is crossed, the local model above is the whole story.
