# 05 — Validators, formatter, catalog, autocomplete: checked verdict

Claude checked OpenCode's `05_VALIDATORS_FINDINGS.md` against the code on 16 Nov 2026. Nothing
fixed yet. James decides.

## What was checked

| Claim | Result |
|---|---|
| Structured / verbose formatter drops parentheses and changes the result (`tm1-expression-parser.js:48-53`, `tm1-structured.js:55-65`) | **Confirmed by running it.** `['X'] = N: (1 + 2) * 3;` → `1 + 2 * 3`; `(['B'] - ['C']) / ['D']` → `['B'] - ['C'] / ['D']`. Default setting is `null` (safe path), but presets at `presets.js:111` and `:142` switch it on and `FormatSettings.jsx` offers both. |
| Client validators reject valid optional arguments (`rules-validator.js:360-370`, `ti-validator.js:163-174`) | **Confirmed** — both test `argCount !== catInfo.min`; `max` is computed and ignored. Server lint checks both bounds. |
| Catalog Admin Validate builds `Name(args);` for every entry and Apply suppresses all "invalid" results (`CatalogAdmin.jsx:358-366`, `387-399`) | **Confirmed** — no `isStatement` handling; Rules functions compiled as TI; one click to suppress. `tools/validate-catalog.js` does it right. |
| MDX overrides saved, never applied (`catalog-runtime.js:13,31-45`; `CatalogAdmin.jsx:260,269,404`) | **Confirmed** — `state = { rules, ti }`; MDX tab and bucket exist. |

Findings 5–15 (STR, comments parsed as code, client/server rule drift, naming dictionary drift,
UCASE/LCASE snippets, unreachable TI interpreter, "Align = signs" no-op, MDX validator's own
catalog, highlighting from the base catalog, two `registerTM1Completions`) not re-verified line
by line. They agree with what `CLAUDE.md` already admits (naming.js independent, snippets
hand-curated, override layer not reaching other consumers) and with the code shape seen.

## Ranked recommendations

1. **Formatter: stop the damage first, then fix.** Same day: remove `expressionFormatter` from
   the two presets and hide the structured/verbose options until fixed, with a line in
   `BUG_FIXES.md`. Then: keep a `group` node in the parser, emit it in `fmtExpr`, and add a
   round-trip test suite that formats a set of real rules and asserts the token stream (minus
   whitespace) is unchanged. That test is the thing that stops this coming back. *Small to
   disable; medium to fix. Data-changing bug.*
2. **One arity check, shared.** Move the client's arity check to `argCount < min || argCount >
   max` (variadic separate), or better, have the client import the same `catalog-arity` logic
   the server uses (it is pure; put it in `shared/`). Table tests for fixed, variadic,
   `variadicMin` and optional on both. *Small.*
3. **Catalog Admin: reuse the CLI's test builder.** `buildTestCall` from `tools/validate-catalog.js`
   moves to `shared/` and both use it. The Rules tab's Validate is relabelled "TI-compile check"
   or removed until it can run `CheckRules` on a real cube. Apply shows a review list and never
   suppresses without a confirm. *Medium.*
4. **MDX overrides: apply them or remove the tab.** Recommendation: fold MDX into the shared
   catalog over time (finding 12 says the MDX validator has its own catalog anyway), and until
   then remove the MDX tab and say so. Removing a lying feature beats finishing it in a hurry.
   *Small to remove.*
5. **One rule set, client and server.** The client and server validators disagree (unknown
   functions, `STR`, TI-only in Rules). Decide the rule once, write it in `CLAUDE.md`, and move
   the shared parts (arity, known-function check, comment stripping) into `shared/` so both
   import them. Fix `STR` in the server lint and the comment parsing in the TI validator as part
   of it. *Medium. This is the "one obvious way" problem in its purest form.*
6. **Snippets and naming dictionary checked against the catalog by a test.** A test that every
   snippet function name and every `IBM_DEFAULTS` entry used as a function exists in the catalog
   (allow an explicit keyword/alias list). Fix `UCASE`/`LCASE` → `UPPER`/`LOWER`. *Small.*
7. **Delete what nobody reaches.** `executeTI` and the rest of `ti-interpreter.js` except
   `scanVariables` (761 → ~100 lines); the "Align = signs" setting; the duplicate
   `registerTM1Completions` name (rename one). *Small.*
8. **Highlighting from the effective catalog** (`tm1-functions.js:26-38`): rebuild the pattern
   after `initEffectiveCatalogs()`. *Small.*

## Keep as the model (agreed with the findings)

`shared/tm1-function-catalog.json` itself: 236 entries, consistent schema, server-side arity
derivation correct for every signature form, and a live validator (`tools/validate-catalog.js`)
that does the test call properly. The problems are in the layers that didn't reuse it.
