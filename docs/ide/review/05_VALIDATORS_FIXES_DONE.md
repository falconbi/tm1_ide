# 05 — Validators, formatter, catalog, autocomplete: fixes done (round 1)

All nine steps are committed. No push, no server restart, no TM1 call.

## Commits

| Step | Commit | What changed |
|---|---|---|
| 1 | `4c70b54` | Disabled the TM1 Verbose and TM1 Structured presets and their pickers; added the failing-then-`todo` grouping test and the BUG_FIXES warning |
| 2 | `f331c5e` | Parser keeps a `group` node, formatter emits brackets, tokenizer no longer reads `1+2` as one number, presets/pickers re-enabled, 20-rule round-trip test added |
| 3 | `d60c224` | Client validators use shared `deriveArity` bounds (`min`/`max`), fixing optional arguments; client/server arity table test added |
| 4 | `d807cd4` | Catalog Admin uses the shared test-call builder, labels Rules validation "TI-compile check", reviews invalid functions with checkboxes, and can undo the last suppression |
| 5 | `d110d43` | Removed the MDX overrides tab, catalog rows and bucket; MDX stays on `tm1-mdx-catalog.js`; MDX validator test added |
| 6 | `d2838b0` | Server no longer rejects `STR`; client TI scanner strips comments; MDX validator skips `--`/`//`/`/* */`; unknown functions are warnings on both paths; comment/consistency tests added |
| 7 | `a5c6395` | `UCASE`/`LCASE` snippets are `UPPER`/`LOWER`; naming/type entries checked by `tests/catalog-consumers.test.mjs`; snippet data split into a pure module |
| 8 | `4426f58` | Deleted the unused TI executor/simulator (761 → 154 lines, only `scanVariables` remains), removed the no-op "Align = signs" setting, renamed the 3-argument completions helper |
| 9 | `e34f96e` | Rules highlighting is built from the effective catalog and refreshed after overrides load; pattern test added |

## Tests and lint

- Before step 1: **411 tests** (410 pass, 1 skipped); lint **129 problems** (20 errors, 109 warnings).
- After step 9: **438 tests** (437 pass, 1 skipped, 0 failed); lint **129 problems** (20 errors, 109 warnings).
- Every step ran `npm test`, `cd client && npm run build`, and `cd client && npx eslint src`. The build writes directly to `static/`; the rebuilt bundle was committed with each step.
- Step counts: 412 → 413 → 419 → 424 → 426 → 433 → 436 → 437 → 438.
- `static/lens-kit` was rebuilt each time; no stale `client/dist` copy was used.

## Shared-module decision

There was no existing precedent for `core/` or `server.js` requiring JavaScript from `shared/`
(only JSON). Following the brief:

- `shared/catalog-arity.js` is the ESM arity derivation used by the client; `core/catalog-arity.js`
  remains the CommonJS copy for the server lints.
- `shared/catalog-test-call.js` is the ESM test-call builder used by Catalog Admin;
  `tools/lib/catalog-test-call.cjs` is the CommonJS copy for the CLI.
- `tests/catalog-arity.test.mjs` and `tests/catalog-test-call.test.mjs` run the same table against
  both copies.

This is recorded in `05_VALIDATORS_FIXES_QUESTIONS.md` for a later decision to collapse to one
implementation once a supported CJS-to-shared-JS convention exists.

## Not done, and why

- **Rules validation against a real cube** was not implemented. The Rules tab now says
  "TI-compile check" and never auto-suppresses; real `CheckRules` validation still needs a cube
  and real object names, as the CLI already documents.
- **MDX overrides** were removed, as decided, rather than made to work. Old `mdx` keys in
  `config/function-catalog-overrides.json` are still round-tripped by the server and ignored by
  the UI.
- **Naming cleanup** leaves 80 older naming-only names in the explicit `IBM_KEYWORDS` list
  instead of deleting them without live verification. The test pins the list so a new invented
  name fails. About 110 catalog names still have no naming entry; the brief only required the
  naming → catalog direction, so they are not added blindly.
- The Catalog Admin review/undo UI and the formatter previews were exercised by build and unit
  tests, not by a browser automation run (Playwright is not used in this repo).

## Residual difference worth knowing

Client Rules validation still reports a **TI-only function used in Rules** as an error, while
`core/rules-lint` reports it as an unknown-function warning because its `SIG` table excludes
TI-only names. The general unknown-function rule is now warning-on-both; this specific
known-in-the-wrong-language case was not part of the brief and remains a small client/server
difference.
