# Provisioning a New TM1 Server Instance (Windows)

Use this guide to create a new TM1 server instance (e.g. a Test or Dev environment) on a Windows server.

---

## Prerequisites

- TM1 binaries already installed on the Windows server
- An existing TM1 instance to use as a template (e.g. Prod)
- Access to Cognos Configuration on the Windows server
- PowerShell available on the Windows server

---

## Step 1 — Copy the Script

Copy `tools/provision-tm1-server.ps1` from this repository to the Windows server.

---

## Step 2 — Run the Script

Open PowerShell on the Windows server and run:

```powershell
.\provision-tm1-server.ps1
```

Or pass the template cfg path directly to skip the first prompt:

```powershell
.\provision-tm1-server.ps1 -TemplateCfg "C:\TM1Servers\Prod\tm1s.cfg"
```

> **Note:** If you get an execution policy error, run this first (unblocks for the current session only):
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```

---

## Step 3 — Answer the Prompts

The script will ask for:

| Prompt | Example | Notes |
|--------|---------|-------|
| Path to template `tm1s.cfg` | `C:\TM1Servers\Prod\tm1s.cfg` | Copied from existing server |
| Server name | `TM1_Test` | Must be unique on the Admin Host |
| Server root directory | `C:\TM1Servers\TM1_Test` | New folder, will be created |
| Data directory | `C:\TM1Servers\TM1_Test\Data` | Where cubes and dimensions are stored |
| Log directory | `C:\TM1Servers\TM1_Test\Logs` | Where TM1 writes log files |
| Files directory | `C:\TM1Servers\TM1_Test\Files` | Optional — for CSVs and scripts |
| PortNumber | `50912` | Must be unique on the machine |
| ClientMessagePortNumber | `17412` | Must be unique on the machine |
| HTTPPortNumber | `52612` | REST API port — must be unique |
| AdminHost | `localhost` | Press Enter for localhost |
| IPAddress | _(press Enter to keep template value)_ | Network interface |

---

## Step 4 — What the Script Creates

```
C:\TM1Servers\TM1_Test\
├── tm1s.cfg              ← generated from template with your values
├── Data\                 ← TM1 cube and dimension data
├── Logs\                 ← TM1 log files
└── Files\                ← optional
    ├── Scripts\          ← TI scripts
    ├── Import\           ← CSV import files
    └── Export\           ← CSV export files
```

All instance-specific settings (server name, ports, directories) are substituted into the `tm1s.cfg`. All other settings (security mode, performance parameters, feature flags) are carried over unchanged from the template.

---

## Step 5 — Register in Cognos Configuration

1. Open **Cognos Configuration** on the Windows server
2. Add a new TM1 instance pointing at the root directory (e.g. `C:\TM1Servers\TM1_Test`)
3. Start the instance

---

## Step 6 — Register in PAW

Add the new server in PAW so the IDE can connect to it.

---

## Step 7 — Add to the IDE

Add the new server name to `config/servers.json` in the IDE:

```json
[
  { "name": "TM1_Apportionment" },
  { "name": "TM1_Test" }
]
```

---

## Port Number Guidelines

Each TM1 instance on the same machine needs three unique ports:

| Parameter | Purpose |
|-----------|---------|
| `PortNumber` | Main TM1 client port |
| `ClientMessagePortNumber` | Progress/cancel messages |
| `HTTPPortNumber` | REST API — used by PAW |

Suggested convention: increment all three by 1 for each new instance.

---

## After Provisioning — Clone Prod Data

Once the new instance is running and registered, use the IDE's **Clone** feature to deploy the Prod baseline (model + structure) to the new server. See the Deployment Pipeline section in the README.
