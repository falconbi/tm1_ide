# TM1 IDE — Setup

Install, configure and run the IDE.

← [Back to README](../README.md)

---

## 🚀 Setup

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- One or more TM1 servers with `HTTPPortNumber` set in `tm1s.cfg` (for direct connection), **or** a PAW instance (V11 native auth / V12 Authentik SSO)

### 1. Install

```bash
git clone https://github.com/falconbi/tm1_ide.git
cd tm1_ide
npm install
```

> The frontend is pre-built — no `client/` install or build step needed.

### 2. Configure

#### Option A — Direct TM1 (no PAW required) ✅ Recommended for home lab / dev

This is the simplest setup. The IDE connects directly to the TM1 admin server — no PAW needed.

**Before you start — check your `tm1s.cfg`:**

The IDE talks to TM1 over HTTP. You need `HTTPPortNumber` to be set in your server's `tm1s.cfg` file (usually found in the TM1 server's data directory). If it's not there, add it:

```ini
HTTPPortNumber=5895
```

Restart the TM1 server after adding it. You can use any free port — `5895` is the IBM default for the admin server.

**Then edit `config/servers.json`:**

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
| `url` | IP address of the Windows machine running TM1, followed by the `HTTPPortNumber` |
| `username` / `password` | A TM1 admin account (must be in the `ADMIN` group on the TM1 server) |
| `loginServer` | *Optional.* The server pre-selected on the sign-in page when the IDE is reachable from the network. Not needed for a local-only IDE — there you sign in to each server as you use it (see [Authentication](AUTHENTICATION.md#signing-in-to-the-ide)). |
| `serverCredentials` | *Optional, top level.* Per-server service logins for the MCP and background jobs: `{ "MyServer": { "username": "…", "password": "…" } }`. Falls back to the admin host's `username`/`password`. Plain text — keep `servers.json` private (it is git-ignored). |
| `servers` | The names of all your TM1 servers as they appear in Cognos Configuration — these are what show up in the IDE's server selector |
| `tls` | *(optional)* TLS mode for HTTPS connections: `"verify"` (default — CA chain + hostname match), `"chain-only"` (verify the CA chain, skip the hostname match — for the stock IBM TM1 cert, which has no server name), or `"insecure"` (no verification — lab only, logs a warning). Covers both the Admin Server discovery call and the resolved model-server connections. |
| `tlsCaFile` | *(optional)* Path to a CA / cert PEM file to add to the trust store — for an internal enterprise CA or a self-signed TM1 cert. Applies to `"verify"` and `"chain-only"`. The system trust store and `NODE_EXTRA_CA_CERTS` are always honoured too. |

Create a minimal `.env` (only the port is needed):

```env
PORT=8083
```

---

#### Option B — Via PAW (Planning Analytics Workspace)

For environments where TM1 is accessed through PAW.

```bash
cp .env.example .env
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

> See [Authentication](AUTHENTICATION.md) for multi-host and advanced adapter setups.

### 3. Run

```bash
npm start
```

Open **[http://localhost:8083](http://localhost:8083)**

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
cp dist/assets/index-*.js ../static/assets/
cp dist/assets/index-*.css ../static/assets/
cp dist/index.html ../static/index.html
```

</details>
