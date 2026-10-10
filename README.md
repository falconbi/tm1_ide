<div align="center">

# TM1 IDE

**A browser-based IDE for IBM Planning Analytics (TM1)**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PAW](https://img.shields.io/badge/PAW-V11%20%7C%20V12-0062B1?logo=ibm&logoColor=white)](https://www.ibm.com/products/planning-analytics)
[![Monaco](https://img.shields.io/badge/Editor-Monaco-646CFF)](https://microsoft.github.io/monaco-editor/)

**The whole TM1 development loop in one browser tab — write, test, trace, map and deploy.**

No TM1 Architect, no Perspectives, nothing to install on the server.

</div>

---

> [!IMPORTANT]
> **Deployment now runs on TM1's built-in Git (preview).** Step-by-step deploy with approvals, drift checks and model-owned history. Tested in the lab, not yet production-proven — use it on test servers and tell us what you find.

> [!WARNING]
> **Pre-release — for initial testing only.**
> This project is under active development and is not yet production-ready. Expect rough edges, breaking changes between commits, and features that are incomplete or unstable. Do not use in a production TM1 environment without understanding the risks.

![Split pane — View + Rules](docs/images/5_screenshot.png)

## Why it exists

AI agents can now build TM1 models, and a modern HTML interface can do what the old desktop tools did — and more.
This project is a working example of both:

- a **simple browser UI** for the whole TM1 development loop
- an **MCP server** that lets an AI agent build and test models — with a full financial consolidation engine built
  that way as the worked example
- **deployment and governance** — change sets, tests, approvals, history — to test how far the bar can be raised
  now that building can be automated

It is here to inspire further TM1 development in the agentic age, at a time when competing planning platforms are
moving fast.

A demonstration and reference project — to show what's possible, to learn from, and to build on. Not a supported
product.

## What's in it

- **A real editor for rules and TI** — Monaco (the engine behind VS Code) with TM1-aware autocomplete, signature
  help, formatting, folding and regions. Validation catches wrong argument counts and broken IF/WHILE blocks as
  you type, before TM1 does. TI has a debugger with breakpoints and watches.
- **See how the model works** — the Cube Map draws every cube and how data moves between them (rules, feeders,
  TI writes). Right-click any cell to trace the rule chain behind its value.
- **Prove the numbers** — assertions hold the answers you know are right and run after every build and deploy.
  TM1 will happily return a confident wrong number; this catches it.
- **Ship with confidence** — every save is tracked in a change set, and a release ships exactly that change set
  through TM1's built-in Git: test → close → build release → review → approve → deploy → verify, with a full
  history. [How and why it works](https://falconbi.github.io/articles/governed-tm1-deploys/).
- **Build with AI** — an MCP server lets an AI agent (e.g. Claude Code) build dimensions, cubes, rules and
  processes, inside change sets and checked by the same tests. A full financial consolidation engine was built
  this way, test-first, and passes every one of its test cases — most of them published worked answers —
  [how it was built](https://falconbi.github.io/articles/consolidation-built-by-ai/).

Also: dimension, subset, view, chore and cube editors, view grid with writeback, sessions and jobs monitors,
server admin, file manager, SQL editor, MDX builder and a Period Builder. Connects to TM1 directly over the REST
API or through PAW (v11 and v12). [See all features](docs/FEATURES.md).

## Quick start

```bash
git clone https://github.com/falconbi/tm1_ide.git
cd tm1_ide
npm install
cp .env.example .env        # direct-v11 only needs PORT=8083; PAW setups need PAW_HOST etc.
npm start                   # → http://localhost:8083
```

The frontend is pre-built — no build step needed. Full instructions: [Setup](docs/SETUP.md).

## Documentation

| Guide | What's in it |
|---|---|
| [Features](docs/FEATURES.md) | Every editor and tool, with screenshots |
| [Setup](docs/SETUP.md) | Install, configure servers, run, development mode |
| [Authentication](docs/AUTHENTICATION.md) | How the IDE signs in — per-server login, what's supported and tested |
| [TM1 Authentication Guide](docs/TM1_AUTHENTICATION_GUIDE.md) | How every TM1 sign-in method works, in plain English — for anyone in TM1 |
| [Architecture](docs/ARCHITECTURE.md) | How the pieces fit, project structure |
| [Deploy lifecycle](docs/DEPLOY_LIFECYCLE.md) | The current deploy — change-set releases through TM1 Git, approvals, drift, verification |
| [Governed TM1 deploys](https://falconbi.github.io/articles/governed-tm1-deploys/) | Article: how and why the deploy works, with diagrams — a good first read |
| [Earlier REST pipeline](docs/DEPLOYMENT.md) | The original diff → package → risk → deploy pipeline, kept for history and the admin-only CLI |
| [MCP server](docs/MCP_SERVER.md) | Connecting an AI agent to build and test models |
| [Building models](docs/BUILDING_MODELS.md) | Lessons and TM1 quirks from real model builds |
| [Bug fixes](docs/BUG_FIXES.md) | Every bug fix, by date committed |
| [Security](SECURITY.md) | The security model |
| [IBM REST API](docs/Planning%20Analytics.postman_collection.json) | Postman collection of the TM1 REST API |

Keyboard shortcuts: press `F1` or `Ctrl+Shift+K` in the app.

## Status

Active development. Core IDE features are complete and stable; MCP and the deployment pipeline are still being proven on real builds.

---

<div align="center">
Built for the IBM Planning Analytics community · <a href="https://github.com/falconbi/tm1_ide/issues">Report an issue</a>
</div>
