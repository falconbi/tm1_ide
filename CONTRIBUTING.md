# Contributing

This is a reference project, so the tests and build rules are part of what is being shared. Run the
same checks CI runs before opening a pull request.

## Requirements

- **Node.js 20 or later**. CI tests Node 20 and 22 (`.github/workflows/ci.yml`).
- Git, and a local checkout with both lockfiles: `package-lock.json` and
  `client/package-lock.json`.

## Install

```bash
npm ci
cd client && npm ci
```

The frontend is committed (the server serves `static/`), but its dependencies are separate.

## Test

```bash
npm test
```

The suite is `node --test` and never touches a live TM1 server. Tests use fake clients; the optional
live MCP check only runs when `TM1_MCP_LIVE_SERVER` is set. Do not require a TM1 server or a server
restart to make a test pass.

## Build the frontend

```bash
cd client && npm run build
```

This uses Vite and writes the app **and the Lens kit** straight into `../static/`. Commit the
changed `static/` files with the source change. Do **not** copy from `client/dist`; there is no dist
step, and copying a stale folder back silently reverts changes. CI builds first, runs tests against
that bundle, then fails if `git status --porcelain -- static` is not empty.

## Lint

Two ratchets, both only allowed to go down:

```bash
# client — the number is client/lint-baseline.json
cd client
npm run lint:count

# server, core, tools and shared — the number is lint-baseline.json at the root
cd ..
npm run lint:count
```

Both configs are flat ESLint (`client/eslint.config.js`, `eslint.config.js`). When lint improves,
lower the number in the matching baseline file in the same commit. Do not suppress a rule just to
move the number; the remaining findings are recorded in [LINT.md](docs/ide/LINT.md).

## Adding things

Pick the existing pattern and keep one obvious way to do the job:

- **A server route** lives in `server.js`; routes report failures through `fail(res, e)`. If a route
  is worth testing without Express, put the handler in a small factory such as
  `core/user_admin.js`, `core/admin_routes.js` or `core/session_routes.js`. See
  [CLAUDE.md](CLAUDE.md#architecture-constraints).
- **A TM1 call** goes in `core/tm1_client.js`, never directly in a route. The OData URL pattern and
  endpoint notes are in [CLAUDE.md](CLAUDE.md#tm1-specific-conventions).
- **A client hook** belongs in `client/src/hooks/useApi.js`; cache keys include `server` first. See
  [CLAUDE.md](CLAUDE.md#state-management).
- **An editor** follows the dispatcher and tab pattern in
  [CLAUDE.md](CLAUDE.md#adding-a-new-editor-type).
- **An MCP tool** goes in `tools/tm1mcp/tools/` and is registered through the security wrapper; read
  [MCP_SERVER.md](docs/ide/MCP_SERVER.md) and `tools/tm1mcp/guard.js` before adding one.

## What CI enforces

Install both lockfiles, build the client, verify `static/` is current, run `npm test`, then run both
lint ratchets. The workflow runs on Node 20 and 22; the build and both ratchets run on Node 20 only.
