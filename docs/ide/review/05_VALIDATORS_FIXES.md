# 05 — Validators, formatter, catalog, autocomplete: fix brief (round 1)

Build brief for OpenCode. Source: `05_VALIDATORS_VERDICT.md`, agreed 16 Nov 2026. Decision:
the MDX overrides tab is removed, not finished. Read `05_VALIDATORS_FINDINGS.md` for line numbers.

## Rules

- One commit per step, in order. Commit message starts with the step title.
- Before every commit: `npm test` (all pass), `cd client && npm run build` (every step touches
  `client/src`; rebuild and commit `static/`), `cd client && npx eslint src` (133 or fewer).
- Do not push. Do not restart any server. Do not touch TM1.
- Questions go in `docs/ide/review/05_VALIDATORS_FIXES_QUESTIONS.md`, never into guesses.
- `docs/ide/BUG_FIXES.md` line for steps 1, 2, 3, 4 and 6 (bugs).
- `shared/` is ESM and `core/` is CommonJS. Before moving any logic into `shared/`, check how
  `core/` already consumes `shared/` (grep `require(.*shared` in `core/ server.js tools/`). If
  there is a working precedent, follow it. If there is none, do **not** invent a module bridge:
  put the pure function in `shared/` as ESM for the client and keep a one-line CommonJS copy in
  `core/` that is tested against the same table, and write that down in the questions file for a
  later decision.

## Step 1 — Formatter: disable the two unsafe presets today (bug)

- `client/src/lib/formatters/presets.js:111` and `:142`: remove `expressionFormatter` from both
  presets (they fall back to the safe line formatter).
- `client/src/components/FormatSettings.jsx` (~147-152, ~278): hide the "verbose" and
  "structured" expression-formatter options and show one line of text in their place:
  "Structured formatting is disabled until it preserves brackets (see BUG_FIXES 2026-11-16)."
- `client/src/components/EditorPane.jsx:394`: if a saved setting is `tm1-verbose` or
  `tm1-structured`, treat it as `null`.
- `BUG_FIXES.md`: say plainly that formatting with either preset dropped parentheses and changed
  rule results, and that anyone who used them should check rules with brackets.
- Test: `formatRules` with `expressionFormatter: 'tm1-structured'` on `['X'] = N: (1 + 2) * 3;`
  must return the brackets intact (this test fails until step 2; mark it `todo` in step 1 and
  un-mark it in step 2).

## Step 2 — Formatter: preserve grouping, then re-enable (bug)

- `client/src/lib/formatters/tm1-expression-parser.js:48-53`: return `{ kind: 'group', inner }`
  instead of `inner`.
- `client/src/lib/formatters/tm1-structured.js` `fmtExpr`: emit `(` + inner + `)` for `group`.
  Check every other consumer of the AST (`grep -rn "kind ===" client/src/lib/formatters`) handles
  the new node.
- Add `tests/formatter-roundtrip.test.mjs`: format each rule in a fixture set (take 20 real rules
  from `docs/models/` or the WFP rules in the repo, including nested brackets, unary minus, `\`,
  `@=`, `&` string joins, and `IF(...)` with bracketed arms) with every preset and both
  expression formatters; tokenise input and output; assert the token streams are identical
  ignoring whitespace and comments. This is the test that stops the bug returning.
- Re-enable the two options in `FormatSettings.jsx` and the presets. Remove the step-1 notice.

## Step 3 — One arity check (bug)

- Client validators `rules-validator.js:360-370` and `ti-validator.js:163-174`: check
  `argCount < min || argCount > max`, variadic branch separate (`min` only). Use the `{min,max}`
  already computed at `rules-validator.js:13-31` / `ti-validator.js:121-138`.
- Then compare that derivation with `core/catalog-arity.js:15-25` line by line; if they differ,
  make them the same and say how in the commit message. Apply the `shared/` rule above if you
  move it.
- Table test (`tests/catalog-arity.test.mjs` or extend the existing one): fixed, variadic,
  `variadicMin`, optional `?` — `SUBSETCREATE('D','S')` and `SUBSETCREATE('D','S',1)` both pass,
  `PARSEDATE` with two and three args both pass, one arg fails. Run the same table against the
  client and the server derivation.

## Step 4 — Catalog Admin: honest validation (bug)

- Move `buildTestCall` from `tools/validate-catalog.js:61-68` to a shared module (see the
  `shared/` rule) and use it in `CatalogAdmin.jsx:358-366`: bare call for `isStatement`,
  assignment otherwise.
- Rules tab: rename the button to "TI-compile check" with a tooltip "Rules functions are compiled
  as TI here; a failure is not proof the function is invalid. Real Rules validation needs a cube
  (`tools/validate-catalog.js`)." Do not auto-suppress from this tab.
- Apply (`:387-399`): show the list of functions about to be suppressed with a checkbox each,
  all unchecked by default for the Rules tab and checked for the TI tab; a confirm button
  "Suppress N functions"; and an "Undo last suppression" in the tab footer that removes the names
  added by the last apply.

## Step 5 — Remove the MDX overrides tab (decided)

`CatalogAdmin.jsx:260` (`mdx` bucket), `:269` (`buildMdxRows`), `:404` (tab entry), `:533`
(the footer claim) and any MDX branch in `mutateOverride`. The server route for catalog
overrides keeps accepting and ignoring an `mdx` key for old files. One line in `CLAUDE.md`
Function Catalog section: "MDX functions are not user-editable; the MDX validator uses
`tm1-mdx-catalog.js`." Confirm the MDX validator and completion still work by test.

## Step 6 — Client and server agree (bugs: `STR`, comments)

- `core/ti-lint.js`: stop rejecting `STR`; the catalog says `both`.
- `client/src/lib/ti-validator.js:37-100` `findFunctionCalls`: skip `#` comments (to end of
  line) before scanning; reuse the same comment-stripping rule the formatter's tokenizer uses if
  it is importable, otherwise a shared tiny helper. Test: `# CellPutN(1)` produces no issue.
- `client/src/lib/mdx-validator.js`: skip MDX comments (`//`, `--`, `/* */`) the same way.
- Unknown functions: the server lint ignores them (`core/rules-lint.js:149-151`); the client
  reports them. Decide one rule and apply it to both: **warning** (not error) for an unknown
  function in both paths, since the catalog may lag a TM1 version. Write it in `CLAUDE.md`
  Validator Architecture Notes.

## Step 7 — Snippets and naming dictionary checked by a test

- `client/src/lib/tm1-snippets.js:304-311`: `UCASE`/`LCASE` → `UPPER`/`LOWER`.
- `tests/catalog-consumers.test.mjs`: every function name used in a snippet body exists in the
  catalog; every `IBM_DEFAULTS` entry in `naming.js` that is not in an explicit `KEYWORDS`
  allow-list exists in the catalog; every `IBM_TYPES` language agrees with the catalog's
  `language`. Fix the entries the test finds (list them in the commit message; do not delete
  naming entries that are real TM1 keywords — add them to the allow-list instead).

## Step 8 — Delete what nobody reaches

- `client/src/lib/ti-interpreter.js`: keep `scanVariables` (and only what it needs), delete
  `executeTI` and the simulator (`SIMULATED_FNS` etc.). Update the `CLAUDE.md` consumer table
  row for `SIMULATED_FNS`. Confirm `ProcessEditor.jsx:16` still works.
- "Align = signs": remove the setting from `settings.js`, `FormatSettings.jsx`, the preset that
  enables it, and the no-op at `rules-formatter.js:239-253`.
- Rename the 3-argument `registerTM1Completions` in `tm1-functions.js` to
  `registerMDXAndVariableCompletions` (or a name that says what it does); update importers.

## Step 9 — Highlighting from the effective catalog

`client/src/lib/tm1-functions.js:26-38`: build `rulesFnPattern` from `getRulesCatalog()` after
`initEffectiveCatalogs()` resolves, and rebuild when overrides change (the admin already
reloads the page, so a rebuild at init is enough). Test: an added override function is matched
by the pattern.

## When finished

`docs/ide/review/05_VALIDATORS_FIXES_DONE.md`: one line per step, commit hash, tests before and
after, lint, the `shared/` module decision from the rules above, anything not done and why.
