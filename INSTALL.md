# Install the TM1 IDE

A step-by-step install for a person, or for an AI agent installing on someone's behalf.
Follow the steps in order. Do not skip the questions in Step 0 and do not guess the answers.

This is the short path: one TM1 Admin Server, direct connection (no PAW). For PAW, TLS,
multi-host setups and Simple mode, see [SETUP.md](docs/ide/SETUP.md).

---

## Step 0 — Ask the user for these

Ask once, before running anything. If an answer is missing, stop and ask — a wrong value here is
the most common reason a first install fails.

| What you need | Why |
|---|---|
| Operating system: Windows, Linux or macOS | Commands differ below |
| TM1 Admin Server host and port | Almost always `5895` (HTTP) or `5898` (HTTPS). **Not** a TM1 server's own `HTTPPortNumber` (often 5xxxx) |
| TM1 server names | Exactly as the Admin Server lists them, e.g. `24retail`. Case does not matter to the IDE, but spelling does |
| A TM1 admin username and password | The account must be in TM1's `ADMIN` group |
| Whether the IDE is for this machine only, or reachable from the network | Affects `HOST` in `.env`, and the network option is plain HTTP |
| Port for the IDE | Default `8083`; only change it if that port is taken |

If the user does not know the Admin Server port, check the Admin Server machine: open
`http://<admin-host>:5895/api/v1/Servers` in a browser. It must list the server names. If this URL
answers with a login prompt or 401, it is a TM1 server port, not the Admin Server.

---

## Step 1 — Check Node.js and Git

```bash
node --version
git --version
```

You need **Node.js 22** (20 also works) and Git. If either is missing:

- **Windows:** `winget install OpenJS.NodeJS.22` and install Git for Windows, then **open a new
  terminal** so both are on the PATH.
- **macOS:** install Node 22 from [nodejs.org](https://nodejs.org) or `brew install node@22`, and
  Git comes with the Xcode command-line tools.
- **Linux:** use your distribution's Node 22 package or nvm, and install `git`.

Do not continue until both commands print a version.

---

## Step 2 — Clone and install

```bash
git clone https://github.com/falconbi/tm1_ide.git
cd tm1_ide
npm ci
```

You do **not** need to build the frontend to run the IDE: `static/` is committed and served as-is.

Only if the user wants to **run the tests** (`npm test`), install the client packages too. Some
tests import client code, and without this 22 tests fail with missing client packages:

```bash
cd client && npm ci && cd ..
```

Line endings need no special handling: `.gitattributes` keeps the clone LF on Windows too. A clone
made before that file existed still passes the docs test, which normalises CRLF.

---

## Step 3 — Configure `config/servers.json`

The file is not in the repo because it holds a password and is git-ignored. Copy the example:

```bash
# Linux / macOS
cp config/servers.example.json config/servers.json

# Windows (Command Prompt or PowerShell)
copy config\servers.example.json config\servers.json
```

Edit it. Fill in the values from Step 0 — this is the shape for one Admin Server:

```json
{
  "adminHosts": [
    {
      "name": "MyLab",
      "url": "http://<admin-host>:5895",
      "adapter": "direct-v11",
      "loginServer": "<server-name>",
      "username": "<tm1-admin-user>",
      "password": "<tm1-admin-password>",
      "servers": ["<server-name>", "<another-server-name>"]
    }
  ]
}
```

- `url` — the **TM1 Admin Server**, normally port `5895` (HTTP) or `5898` (HTTPS).
- `servers` — every TM1 server the IDE may show, using the names the Admin Server returns.
- `loginServer` — optional; the server pre-selected on the sign-in page.
- `username` / `password` — a TM1 admin account. Plain text: keep this file private.

Never print, echo or commit the password. `config/servers.json` is already in `.gitignore`.

### `.env` (optional)

For a direct connection, `.env` is optional. Defaults are `PORT=8083` and `HOST=127.0.0.1` (this
machine only). Create `tm1_ide/.env` only if the user wants a different port or network access:

```env
PORT=8083
# HOST=0.0.0.0   # also reachable from the network — plain HTTP, see Security below
```

Do **not** copy `.env.example` for a direct connection: its placeholder `PAW_*` values would be
loaded.

Using PAW instead? Follow Option B in [SETUP.md](docs/ide/SETUP.md#option-b--via-paw-planning-analytics-workspace).

---

## Step 4 — Start it

```bash
npm start
```

Leave that terminal open. You should see:

```
TM1 IDE running at http://127.0.0.1:8083 · local only, no IDE sign-in (sign in per server)
```

Two other lines are normal and not errors:

- `HTTPS listener not started … ide-key.pem` — the IDE runs on HTTP unless you add certificates.
- `⚠ config/servers.json is missing …` — you skipped Step 3. Stop and do it.

Open **http://localhost:8083** in a browser.

---

## Step 5 — Verify it worked

1. **Ask the server.** This needs no sign-in:

   ```bash
   curl http://localhost:8083/api/config
   ```

   On Windows use `curl.exe http://localhost:8083/api/config` (not the PowerShell `curl` alias).
   A healthy response contains `"loginRequired"`, `"access"` and `"hasAI"`.

2. **Sign in.** Choose a server, sign in with the TM1 admin account, and open any cube. If the
   server opens, the install is done.

3. **If asked to prove it further:** open a cube's rules, and a TI process. No save is needed.

---

## When sign-in fails

The sign-in dialog shows the real cause. Match the message:

| Message | Meaning | Fix |
|---|---|---|
| `answered as a TM1 server, not the TM1 Admin Server` | `url` is a TM1 server's `HTTPPortNumber`, not the Admin Server | Set `url` to the Admin Server, usually port `5895` (HTTP) or `5898` (HTTPS) |
| `Can't reach the TM1 Admin Server at …` | Wrong host/port, or the Admin Server service is stopped | Check `http://<admin-host>:5895/api/v1/Servers` answers, and that the service is running |
| `Server "X" not found … Admin Server lists: A, B` | `servers` in `servers.json` does not match a real name | Use one of the listed names exactly |
| `TM1 rejected the login for "X"` | The username or password is wrong, or the account is not in `ADMIN` | Fix the credentials; this is not a `url` problem |
| `Cannot find module` when running `npm test` | The client packages are missing | `cd client && npm ci && cd ..` |
| `better-sqlite3` fails to build | Node version without a prebuilt binary | Use Node 22; on Windows also install the C++ build tools |

---

## Security

- The IDE is designed for **local, single-user** use. Do not expose it to a network unless the
  user asks. `HOST=0.0.0.0` puts it on the network over **plain HTTP**.
- The password in `config/servers.json` is plain text. Keep the file private; never commit it or
  paste it into logs, chat or a terminal command.
- Try it on a non-production TM1 server first. For shared installs and on the TM1 server itself,
  see [Installing at a client](docs/ide/SETUP.md#installing-at-a-client).

---

## What next

- [First walkthrough](docs/ide/WALKTHROUGH.md) — connect, edit rules and TI, build a small model.
- [Setup reference](docs/ide/SETUP.md) — PAW, TLS, Simple mode, multi-user, Windows notes.
- [Authentication](docs/auth/AUTHENTICATION.md) — how sign-in works and where secrets live.
