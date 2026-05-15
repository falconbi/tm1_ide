# TM1 IDE

Models-as-code tooling and IDE for IBM Planning Analytics (TM1).

Define TM1 objects in YAML. Deploy via the TM1 REST API. Version control your entire model in git.

---

## What It Does

- **Models as code** — dimensions, cubes, rules, processes defined as YAML files
- **Deploy CLI** — diff and apply YAML changes to any TM1 server
- **IDE** — browser-based editor modelled on VS Code: object explorer, rules editor, TI process editor, cube viewer
- **Module system** — isolate functional areas into separate TM1 database instances with declared dependencies
- **CICD ready** — deploy on push via GitHub Actions or GitLab CI

---

## Project Structure

```
tm1_ide/
├── core/                  # Shared auth — PAW session + TM1 REST proxy
├── tm1_deploy/            # Deploy CLI — diff, apply, validate
├── models/                # Example YAML model definitions
│   ├── dimensions/
│   ├── cubes/
│   ├── rules/
│   ├── processes/
│   └── chores/
├── docs/                  # Concept docs and architecture notes
└── app.py                 # Flask IDE server (coming)
```

---

## Quick Start

```bash
git clone git@github.com:falconbi/tm1_ide.git
cd tm1_ide
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in PAW credentials
```

### Deploy a model

```bash
python3 -m tm1_deploy diff   --server "Planning Sample" --model models/
python3 -m tm1_deploy apply  --server "Planning Sample" --model models/
```

---

## YAML Format

### Dimension

```yaml
dimension: entity
hierarchy: entity
elements:
  - name: Total Company
    type: Consolidated
    children:
      - name: "10110"
        type: Numeric
      - name: "10120"
        type: Numeric
attributes:
  - name: currency
    type: String
  - name: region
    type: String
```

### Cube

```yaml
cube: revenue
dimensions:
  - entity
  - time
  - measure
rules: rules/revenue.rules
```

### Module

```yaml
name: apportionment
owns:
  - dimensions/apport_driver.yaml
  - cubes/apport_allocation.yaml
depends_on:
  - core_db/entity
  - core_db/time
```

---

## Architecture

All TM1 calls route through PAW at `/api/v0/tm1/{server}/api/v1/`. No direct TM1 connections, no per-server ports or SSL config.

See [docs/TM1_IDE_CONCEPT.md](docs/TM1_IDE_CONCEPT.md) for full architecture and design rationale.

---

## Status

Early development. See [docs/TM1_IDE_CONCEPT.md](docs/TM1_IDE_CONCEPT.md) for the full concept and build order.
