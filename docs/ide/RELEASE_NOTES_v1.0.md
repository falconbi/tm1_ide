# TM1 IDE v1.0.0 — release notes

**Release date:** 17 November 2026
**Status:** first versioned reference release. Not a supported product; read the limits below.

## What this is

A browser-based IDE and MCP server for IBM Planning Analytics (TM1). It gives a developer one place
to edit rules, TI, dimensions, subsets, views, chores and cube data; understand how a model fits
together; and move a change through a governed release.

The frontend is committed in `static/`; the backend is Node 20+. There is no installer and no
service wrapper in this release.

## Highlights

- **Editors** — Rules (validation, Check Now, formatter, regions, trace), TI (run, debug, error
  log), dimensions/hierarchies/attributes, subsets, native and MDX views, chores and cubes.
- **Understanding the model** — Cube Map, Rule Lens, data sources, process summaries, cell trace,
  transaction log, model health and search.
- **Governed change** — change sets, before/after history, assertions stored in the model, release
  builds, approvals, deploy history, drift checks and readiness checks through TM1's built-in Git.
- **MCP server** — 67 tools for an AI agent, with reader/builder identities, masking policy,
  change-set gating and a generated tool inventory.
- **Lenses** — a separate app and toolkit for model-owned HTML screens, still in development.
- **Connections** — direct TM1 REST or through PAW, selected per server in `config/servers.json`.

## Verification

- **512 tests, 509 pass, 3 skipped, 0 fail** in a fresh Linux clone. The skips are the private
  baseline/package fixtures and the opt-in live MCP check.
- Client and lens-kit builds succeed; committed `static/` is current after a clean build.
- Client lint 128; backend lint 0.
- CI green on Node 20 and 22 (tests, build, `static/` freshness, both lint ratchets).

## Known limits in this release

- **Windows is untested.** The code uses Node path/temp handling and is expected to work, but no
  Windows install has been run. `win32` line endings, native modules and service setup remain
  unverified.
- **Live deploy verification is deferred.** The seven real-server checks are in
  [07_DEPLOY_FIXES_DONE.md](review/07_DEPLOY_FIXES_DONE.md#behaviour-james-should-verify-live-he-runs-live-checks).
  The deploy paths are covered by fakes and tests, not yet by the full live matrix.
- **Lenses are in development**, and a model's Lenses live in the model rather than this repo.
- **The backend is a reference design, not a hardened multi-tenant service.** Read
  [SECURITY.md](../../SECURITY.md) before exposing it beyond a trusted network.
- TM1 v11 is the primary target; v12 features are noted where they differ.

## Upgrading

There is no earlier tagged release. For an existing checkout, update, run `npm ci` and
`cd client && npm ci`, then `npm test`. Rebuild the client if you change `client/src` or `shared/`.

## Documentation

- [Setup](SETUP.md)
- [First walkthrough](WALKTHROUGH.md)
- [Features](FEATURES.md)
- [Architecture](ARCHITECTURE.md)
- [MCP server](MCP_SERVER.md)
- [Deploy lifecycle](../deploy/DEPLOY_LIFECYCLE.md)
