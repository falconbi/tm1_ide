# 05 — Validator/catalog fixes: questions and decisions

## Step 3 — where the shared arity check lives

There is no existing precedent for `core/` or `server.js` requiring a JavaScript module from
`shared/`; the only current use is JSON (`shared/tm1-function-catalog.json`,
`shared/lens-*.json`). Following the brief, the pure `deriveArity` function is ESM in
`shared/catalog-arity.js` for the client. `core/catalog-arity.js` remains the CommonJS copy for
the server lints, and `tests/catalog-arity.test.mjs` runs the same fixed/variadic/`variadicMin`/
optional table against both so they cannot drift.

Decision for a later round: if a supported CJS-to-shared-JS loading convention is added, delete
the `core/` copy and have both sides import one implementation.

## Step 4 — shared test-call builder

`shared/catalog-test-call.js` is the ESM builder used by Catalog Admin. The CLI is CommonJS,
so `tools/lib/catalog-test-call.cjs` is the matching CJS copy; `tests/catalog-test-call.test.mjs`
runs the same table against both. The same later decision as step 3 applies: one implementation
when a CJS-to-shared-JS convention exists.
