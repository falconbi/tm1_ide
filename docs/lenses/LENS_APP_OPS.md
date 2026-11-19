# Lens app — running it

How to run the Lens app as a service, put it behind PAW (or another HTTPS proxy), and keep it healthy.
Setup of a server and Lenses themselves is in [LENS_APP_PLAN.md](LENS_APP_PLAN.md); the IDE is in
[INSTALL.md](../../INSTALL.md).

The Lens app is a separate process from the IDE: `node lens-server.js` (or `npm run lens`). It
serves ONE TM1 server and reads Lenses from that server's model under
`Applications/Governance/Lenses`.

---

## Settings

| What | Where |
|---|---|
| The TM1 server, port, HTTPS, `trustProxy`, idle minutes, end-of-session processes | `config/lens-app.json` (git-ignored) or `LENS_CONFIG=/path/to/file.json` |
| Which adapter serves that server (direct / `paw-native` / `paw-oauth2`) | `config/servers.json` — the same file the IDE uses |
| `PAW_HOST` for PAW-native sign-in | `.env` at the repository root (loaded at startup) |
| Secrets | never in the database or a Lens; `servers.json` / `.env` only |

If `config/lens-app.json` is missing the app fails at startup with the exact create-file message.
For the 24Retail lab only, `--demo` / `LENS_DEMO=1` uses the example and logs that it is demo data.

---

## Linux — systemd

Install and test first as the service account:

```bash
cd /opt/tm1-ide
npm ci
node lens-server.js          # Ctrl+C once it starts
```

`/etc/systemd/system/tm1-lens.service`:

```ini
[Unit]
Description=TM1 Lens app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tm1ide
WorkingDirectory=/opt/tm1-ide
ExecStart=/usr/bin/node lens-server.js
Restart=on-failure
RestartSec=5
# The app reads .env from the repository root; LENS_CONFIG overrides the settings path.
# Environment=LENS_CONFIG=/etc/tm1-ide/lens-app.json

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tm1-lens
journalctl -u tm1-lens -f
```

The process should run as a non-root account that can read `config/` and write `data/`
(`data/lens-prefs.json`, `data/lens-activity.jsonl`). Restrict the folder to that account.

## Windows — service

Use NSSM (or a scheduled task at start-up) with:

```
Application:  C:\Program Files\nodejs\node.exe
Arguments:    lens-server.js
Startup dir:  C:\tm1-ide
```

Install Git for Windows only if you deploy through Git. Set the service account's ACLs on the
install folder; `config\servers.json` holds a password.

## Container

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "lens-server.js"]
```

Mount `config/` (settings and servers) and `data/` (preferences and activity log). Do not bake
`config/servers.json` or `.env` into the image.

---

## HTTPS and PAW

Preferred: run the app next to PAW and let PAW's address be the front door. Put a TLS reverse
proxy in front of it, then set in `config/lens-app.json`:

```json
{ "server": "Production", "port": 8090, "trustProxy": true }
```

`trustProxy` makes `req.secure`, the Secure session cookie and the toolkit URL follow
`X-Forwarded-Proto`. Without it, behind a TLS proxy the toolkit is blocked as mixed content and the
cookie is not Secure. Leave it off when the app is reached directly.

The proxy must pass `X-Forwarded-Proto` and `X-Forwarded-For`, and must not buffer Server-Sent
Events (nginx: `proxy_buffering off;` on the `/api/live/` location). Keep the app on a trusted
network; the browser-to-app hop is HTTPS only when the proxy provides it.

Embedding a Lens in PAW uses the viewer address `https://<lens-app>/lens/<Lens-Name>` in a PAW URL
widget. The person signs in to the Lens app first (or PAW-native sign-in uses their PAW session);
the page must be reachable from the browser, not just from PAW's server.

---

## Health and logs

- `GET /healthz` → `{ "ok": true, "server": "Production" }`. No TM1 call, so it works while TM1 is
  down. Use it for the proxy or a monitor.
- The app logs to stdout/stderr: startup line, sign-in failures, and `[lens] could not log …`
  warnings. Under systemd that is the journal; under NSSM, its log file.
- `data/lens-activity.jsonl` holds saves, notes and process runs (the same under each person's TM1
  name). At 5 MB it rotates once to `lens-activity.jsonl.1`.
- `data/lens-prefs.json` holds each person's theme, written atomically (temp file + rename).
- Idle sessions end after `idleMinutes`; their TM1/PAW session is released and live streams close.

---

## Upgrade

```bash
git pull
npm ci
sudo systemctl restart tm1-lens
```

Lenses are in the TM1 model, not in this checkout, so they survive an upgrade. Rebuild `static/`
only when changing the front end (`cd client && npm run build`) — an install never needs it.

## Backup

- The model's `Applications/Governance/Lenses` (the Lenses) and `Applications/Governance/LensHistory`
  (their earlier versions) — through the model, not the app.
- `config/lens-app.json`, `config/servers.json`, `.env` — the installation's settings.
- `data/lens-prefs.json` — themes; regenerable.
- `data/lens-activity.jsonl` — activity history; regenerate nothing, archive it if it matters.
