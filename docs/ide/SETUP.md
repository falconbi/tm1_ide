# TM1 IDE — Setup

Install, configure and run the IDE.

← [Back to README](../../README.md)

---

## 🚀 Setup

### Prerequisites

- **Node.js 22** (20 also works). CI tests Node 20 and 22. A plain "LTS" installer may now give a
  newer version that CI doesn't test.
  - Windows: `winget install OpenJS.NodeJS.22`, or the Node 22 installer from
    [nodejs.org](https://nodejs.org). Then **open a new terminal** so `node` is on the PATH. The
    "Tools for Native Modules" option isn't needed.
- **Git.** On Windows, install Git for Windows.
- One or more TM1 servers with `HTTPPortNumber` set in `tm1s.cfg` (for direct connection), **or** a PAW v11 instance. v12 per-person sign-in (OIDC) is not built yet; see [Connection types](../auth/AUTHENTICATION.md#connection-types)

### 1. Install

```bash
git clone https://github.com/falconbi/tm1_ide.git
cd tm1_ide
npm install
```

On Windows, clone with `git clone -c core.autocrlf=false https://github.com/falconbi/tm1_ide.git`
so files keep their Linux line endings. With Git for Windows' default, one test fails on line
endings alone.

> The frontend is pre-built, so running the IDE needs no `client/` install or build step.
> **To run the tests** (`npm test`), install the client packages first, because some tests use
> client code: `cd client && npm install && cd ..`

### 2. Configure

#### Option A — Direct TM1 (no PAW required) ✅ Recommended for home lab / dev

This is the simplest setup. The IDE asks the **TM1 Admin Server** where each TM1 server is, then
talks to that server directly. No PAW needed.

**Before you start — check your `tm1s.cfg`:**

Each TM1 server needs `HTTPPortNumber` set in its `tm1s.cfg` (in the server's data directory). If
it's not there, add it, using any free port:

```ini
HTTPPortNumber=52670
```

Restart that TM1 server after adding it.

**`servers.json` doesn't use this port.** It points at the Admin Server (`5895` over HTTP, `5898`
over HTTPS, by IBM default), which tells the IDE each server's port. To check, open
`http://<tm1-machine>:5895/api/v1/Servers` in a browser. Your server should be listed with its port.

**Then create `config/servers.json`.** It isn't in the repo (it holds passwords and is
git-ignored), so create it from this example:

```json
{
  "adminHosts": [
    {
      "name": "MyLab",
      "url": "http://192.168.x.x:5895",
      "adapter": "direct-v11",
      "loginServer": "MyTM1Server",
      "username": "admin",
      "password": "your_password",
      "servers": ["MyTM1Server", "AnotherServer"]
    }
  ]
}
```

| Field | What to put here |
|-------|-----------------|
| `url` | The **TM1 Admin Server** address, e.g. `http://192.168.x.x:5895` (or `http://localhost:5895` on the TM1 machine). **Not** a TM1 server's `HTTPPortNumber`: that gives a 401 when you sign in. |
| `username` / `password` | A TM1 admin account (must be in the `ADMIN` group on the TM1 server) |
| `loginServer` | *Optional.* The server pre-selected on the sign-in page when the IDE is reachable from the network. Not needed for a local-only IDE — there you sign in to each server as you use it (see [Authentication](../auth/AUTHENTICATION.md#signing-in-to-the-ide)). |
| `serverCredentials` | *Optional, top level.* Per-server service logins for the MCP and background jobs: `{ "MyServer": { "username": "…", "password": "…" } }`. Falls back to the admin host's `username`/`password`. Plain text — keep `servers.json` private (it is git-ignored). |
| `servers` | The names of your TM1 servers exactly as the Admin Server lists them (its `ServerName`, e.g. `24retail`). These show up in the IDE's server selector. |
| `tls` | *(optional)* TLS mode for HTTPS connections: `"verify"` (default — CA chain + hostname match), `"chain-only"` (verify the CA chain, skip the hostname match — for the stock IBM TM1 cert, which has no server name), or `"insecure"` (no verification — lab only, logs a warning). Covers both the Admin Server discovery call and the resolved model-server connections. |
| `tlsCaFile` | *(optional)* Path to a CA / cert PEM file to add to the trust store — for an internal enterprise CA or a self-signed TM1 cert. Applies to `"verify"` and `"chain-only"`. The system trust store and `NODE_EXTRA_CA_CERTS` are always honoured too. |

Create a minimal `.env` (only the port is needed):

```env
PORT=8083
```

Don't copy `.env.example` for a direct setup. Its placeholder `PAW_*` values would be loaded.

Restart the IDE after any change to `config/servers.json` or `.env`.

---

#### Option B — Via PAW (Planning Analytics Workspace)

For environments where TM1 is accessed through PAW.

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

```env
PAW_HOST=http://192.168.x.x
PAW_USERNAME=admin
PAW_PASSWORD=your_password
PAW_LOGIN_SERVER=Production
PORT=8083

# Optional: AI-powered MDX generation
ANTHROPIC_API_KEY=sk-ant-...
```

Edit `config/servers.json`:

```json
[
  { "name": "Production" },
  { "name": "Development" }
]
```

> See [Authentication](../auth/AUTHENTICATION.md) for multi-host and advanced adapter setups.

#### Simple mode (optional)

For a server where people just edit and save, Simple mode hides the deploy process: the Deploy menu,
the change set button and the change set prompt on save. Every save is still recorded with who made it,
read-only servers stay read-only, and an AI agent working through the MCP server still has to open a
change set. It is off by default.

- **From the IDE:** **Admin** in the status bar → **IDE** → **Turn on Simple mode**. TM1 admins only. It
  applies to everyone on that server and is kept in `config/ide-modes.json`.
- **In `config/servers.json`:** `"simpleServers": ["Sandbox"]`, or `"simple": true` on an `adminHosts` /
  `connections` entry for every server it owns. This takes priority — the IDE switch can't turn it off.

### 3. Run

```bash
npm start
```

Open **[http://localhost:8083](http://localhost:8083)**

Every start prints `HTTPS listener not started … ide-key.pem`. That's expected: the IDE runs on HTTP.
Add `config/certs/ide-cert.pem` and `ide-key.pem` only if you need HTTPS.

<details>
<summary>Development mode (Vite HMR)</summary>

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — frontend with hot reload
cd client && npm install && npm run dev
```

Open **http://localhost:5173**

After making client changes, rebuild for production:

```bash
cd client && npm run build
```

This builds straight into `static/` (what the server serves), replacing the previous build.

</details>

---

## Installing at a client

### Intended setup

- The IDE is installed **once, on the client's DEV TM1 server machine** (or a machine next to it),
  not on each developer's PC.
- Developers open it **in a browser**. Nothing is installed on their machines.
- Each developer signs in to each TM1 server with **their own TM1 login**, so TM1 security and
  per-person change sets apply. See [MULTI_USER_LOGIN.md](../auth/MULTI_USER_LOGIN.md).
- To make it reachable from the network, set `HOST=0.0.0.0` in `.env`. A sign-in page then always
  appears first. The browser-to-IDE connection is **plain HTTP** today, so passwords cross the
  network unencrypted. Keep it on a trusted network until HTTPS for the IDE lands.
- Changes reach TEST and PROD through the deploy pipeline. The IDE is not installed on PROD.
- Secrets go in `config/servers.json` and `.env` on that machine only. See
  [Where secrets live](../auth/AUTHENTICATION.md#where-secrets-live).

### Windows: partly tested

Most client TM1 servers run Windows. **Tested on 19 Nov 2026** on Windows 10 Pro, TM1 v11 and
Node 22, on the TM1 machine itself: the install, start, sign-in and opening a cube all work.
`better-sqlite3` used its prebuilt Windows binary, so no build tools were needed. The other editors,
the Windows service wrapper and package/deploy are still untested. Remaining differences and risks:

| Area | On Linux today | On Windows |
| --- | --- | --- |
| Running as a service | `systemd --user` services (`tm1-backend`, `tm1-frontend`), logs in `/tmp/tm1-*.log`. These are machine setup, not in the repo. | Needs a Windows service wrapper (e.g. NSSM, or a scheduled task at start-up). Not written yet. |
| Git | `git` must be on the PATH (used for TM1 Git deploys, drift and review) | Install Git for Windows. **Line endings:** Git for Windows defaults to `core.autocrlf=true`, which can rewrite rule/TI files on checkout and make content checks see changes that aren't there. Set `core.autocrlf=false` for the IDE's own clone and its repositories. |
| `better-sqlite3` (change log) | Prebuilt binary | Prebuilt Windows binary used with Node 22 (tested). For a Node version without one, it needs Visual Studio Build Tools to compile. |
| Package file names | Object names made file-safe (`safeFilename`) | Windows also rejects reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…) and names ending in a dot or space. An object named exactly like one of those would fail to package. Not handled yet. |
| File permissions | No permissions are set in code. `config/servers.json` relies on the folder's permissions. | Same. Restrict the IDE folder to the service account and administrators with Windows ACLs. |
| Front-end rebuild | `npm run build` writes straight into `static/` | Same. Only needed when changing the front end, never for an install. |
| Shebang lines (`#!/usr/bin/env node`) | Used to run tools directly | Ignored on Windows. Run tools with `node <file>`. |

The first Windows install should be treated as a test: run `npm test`, then sign in, open each
editor, and run one change set through package → risk → deploy on a scratch server before using
it for real.
