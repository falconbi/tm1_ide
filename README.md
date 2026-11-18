<div align="center">

# TM1 IDE

**An open development experiment for the IBM Planning Analytics (TM1) community.**

[![CI](https://github.com/falconbi/tm1_ide/actions/workflows/ci.yml/badge.svg)](https://github.com/falconbi/tm1_ide/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

A browser-based TM1 development environment that explores what modern TM1 development could
look like. It covers AI agents working through MCP, governed changes and deployment, and web
applications built on TM1 data.

It's working software, actively developed and shared openly as a codebase to learn from and
build on. **This is a community project, not a supported product.**

[![A view and its rules side by side in the IDE](docs/images/hero.png)](https://www.youtube.com/watch?v=_-BWl_n-aWU)

> [!NOTE]
> **Security:** the IDE is designed for local, single-user development, not as a shared
> multi-user web service. Protect your credentials, test on non-production servers first, and
> read the [security model](SECURITY.md) before connecting to an important TM1 system.

---

## ▶ Watch it working

Short videos, a few minutes each, recorded on a live TM1 server.

| | Video | What you'll see |
|---|---|---|
| ▶ | **[IDE Basics](https://www.youtube.com/watch?v=_-BWl_n-aWU)** | Connecting, the Explorer, tabs and split panes, and the editors at a glance |
| ▶ | **[Rules Editor](https://www.youtube.com/watch?v=q-eoEeDHwSA)** | Writing rules and feeders, checking them, and tracing a calculation |
| ▶ | **[TI Editor](https://www.youtube.com/watch?v=vmZzt2ud_og)** | Writing, running and debugging TI processes |
| ▶ | **[Dimension Editor](https://www.youtube.com/watch?v=qGAjW8m_vAg)** | Dimensions, hierarchies, attributes, picklists and subsets |
| ▶ | **[IDE Views](https://www.youtube.com/watch?v=wD6n-vdmCLI)** | Native and MDX views, subsets, hierarchies, working the grid and tracing a number |
| ▶ | **[Cube Map](https://www.youtube.com/watch?v=MM62ZqC3pjk)** | A whole model on one page: the map, the Runbook and Play a run |

More are on the way: AI building through MCP, deploys, and Lenses.

---

## Why this project exists

AI agents, MCP and modern web tools are changing how software is built. TM1 can benefit from
that too. This project explores how, through working code rather than slides. It brings together
a development environment, an MCP server for AI-assisted model building, and a way to build
focused web applications on TM1.

## What this project explores

### A modern TM1 development environment
Rules and TI with live checking, a debugger, dimensions, views, subsets and MDX, all in one browser
tab. The Cube Map draws the whole model, and any number can be traced back to its rule.

See [the videos](#-watch-it-working) and [all features](docs/ide/FEATURES.md).

### MCP and AI-assisted model building
An MCP server gives AI agents structured tools to inspect, build and test TM1 models. The
questions it explores:
- Can an agent build a real model?
- How are standards communicated and enforced?
- How is the result tested?
- How do people stay in control?

A financial consolidation engine was built this way, test-first:
[how it was built](https://falconbi.github.io/articles/consolidation-built-by-ai/) ·
[MCP server guide](docs/ide/MCP_SERVER.md).

[![An AI agent building a TM1 model through MCP](docs/images/ai-build.png)](docs/ide/MCP_SERVER.md)

### Governed development
As more of the building is automated, governance matters more, not less. Every save goes into a
change set. Tests live in the model. A release ships exactly one change set through TM1's built-in
Git, with review, approval, deploy and verify steps.
[How the deploy works](https://falconbi.github.io/articles/governed-tm1-deploys/).

<a href="docs/deploy/DEPLOY_LIFECYCLE.md"><img src="docs/images/deploy.png" alt="The step-by-step deploy" width="480"></a>

### Web applications on TM1 (Lenses, in development)
Focused HTML screens on live TM1 data, one per job, with governed write-back. They're built in the
IDE and they live in the TM1 model. They're not ready for use yet.

![The Lenses home page](docs/images/lenses-home-full.png)

## Three applications, one codebase

| Application | Entry point | What it's for |
|---|---|---|
| **IDE** | `server.js` | Developing and governing TM1 models |
| **Lens app** | `lens-server.js` | Running Lenses for business users |
| **MCP server** | `tools/tm1mcp/server.js` | AI agents working with TM1 models |

All three share one `core/`: the TM1 client, the connection adapters (direct or through PAW,
v11 and v12) and change logging. The function catalog is shared from `shared/`. See
[Architecture](docs/ide/ARCHITECTURE.md).

## Status and expectations

It's real code, used to build real models, and it's still evolving. Please know before you use it:

- **Actively developed.** Features, interfaces and internals change, sometimes in breaking ways.
- **Still being tested.** Not every feature has been tested on every TM1 version and setup. Expect
  bugs.
- **No support or guarantees.** It's provided as-is under the MIT licence. There's no promised
  response to issues or requests.
- **Your environment, your responsibility.** Understand what an operation does and validate changes
  before applying them to an important server.

See the [bug-fix log](docs/ide/BUG_FIXES.md) and [changelog](CHANGELOG.md) for what changes and how
often.

It isn't an IBM product and isn't supported by IBM.

## Getting started

```bash
git clone https://github.com/falconbi/tm1_ide.git
cd tm1_ide
npm install
# create .env (PORT=8083) and config/servers.json, see Setup
npm start                   # → http://localhost:8083
```

You need Node.js 22 (20 also works) and Git. The frontend is pre-built. `config/servers.json`
isn't in the repo. [Setup](docs/ide/SETUP.md) shows how to create it, pointing at your TM1 Admin
Server. Tested on Linux and Windows. Then see the [first walkthrough](docs/ide/WALKTHROUGH.md).

## Take it apart

You don't need to adopt the whole application to get something from it.

| If you're… | You might take |
|---|---|
| A TM1 developer | The editors, the checks, the Cube Map, the development ideas |
| Building AI agents | The MCP server and its TM1 tools |
| Designing deployment | The change sets, the tests in the model, the Git release flow |
| A web developer | The Lens approach to apps on TM1 data |

Clone it, fork it, change it, or build something better. Bug reports with steps to reproduce,
ideas and pull requests are welcome, but there's no promise they'll be accepted or maintained. See
[Contributing](CONTRIBUTING.md).

## Documentation

[Setup](docs/ide/SETUP.md) · [Features](docs/ide/FEATURES.md) ·
[Architecture](docs/ide/ARCHITECTURE.md) · [MCP server](docs/ide/MCP_SERVER.md) ·
[Deploy lifecycle](docs/deploy/DEPLOY_LIFECYCLE.md) · [Security](SECURITY.md) ·
[Changelog](CHANGELOG.md) · [Bug fixes](docs/ide/BUG_FIXES.md) · [All guides](docs/README.md)

## Licence

MIT. You may use, copy, change and share the code, provided the copyright and licence notice are
kept. See [LICENSE](LICENSE). IBM, Planning Analytics and TM1 are trademarks of IBM.

---

<div align="center">

**Built to explore. Shared to inspire.**

Take it, learn from it, change it, or build something entirely different with it.

</div>
