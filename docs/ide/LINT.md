# Lint baseline

The client (`client/`) is linted with ESLint (`client/eslint.config.js`). The ratchet number lives
in **`client/lint-baseline.json`**; CI reads it directly, and it may only go **down**.

Run it from `client/`:

```bash
npm run lint          # eslint .            — exits non-zero while any error remains
npm run lint:count    # prints the total number of lint problems
```

## Current baseline

`client/lint-baseline.json` currently allows **129** problems. A fresh
`npm run lint:count` on 16 Nov 2026 reported **129** problems: **20 errors, 109 warnings**.

When lint improves, lower `problems` in `client/lint-baseline.json` in the same commit. There is no
second number to update. The remaining warnings are mostly React hook dependency and
state-in-effect findings, left for a per-screen review; do not suppress them just to move the
number.

## CI

`.github/workflows/ci.yml` builds the client, checks that `static/` is current, runs the tests,
then reads `client/lint-baseline.json` and fails if `npm run lint:count` reports more problems than
the file allows. The count and the baseline are printed either way.

## Backend

The server and tooling use the root ESLint config (`eslint.config.js`): `server.js`, `lens-server.js`,
`core/**` and `tools/**` as CommonJS, and `shared/**` as ESM. The ratchet number lives in
`lint-baseline.json` at the repository root.

```bash
npm run lint          # from the repository root
npm run lint:count
```

A fresh run on 16 Nov 2026 reported **87** problems (56 errors, 31 warnings). Most are existing
`no-empty`, `no-useless-assignment`, `preserve-caught-error` and `no-unused-vars` findings. They
are recorded, not fixed, so the backend now has the same “only go down” gate as the client.
