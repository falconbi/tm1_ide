# 05 — Validators, formatter, function catalog, autocomplete

Read-only review. No code changes, no server restart, no TM1 calls. Evidence is from reading
the code and from local Node calls against the pure formatter/catalog functions.

Scope: `client/src/lib/*` validator/catalog/formatter modules, `core/*-lint.js`,
`shared/tm1-function-catalog.json`, `client/src/components/CatalogAdmin.jsx`,
`tools/validate-catalog.js`, and the tests that touch them.

## Summary

The catalog itself is in good shape: 236 entries, no schema errors, and the server-side arity
derivation handles fixed, variadic, `variadicMin` and optional (`?`) signatures correctly.
The main problems are in the layers built on top of it:

1. The structured formatter can silently change a rule's meaning by dropping parentheses.
2. Both client validators reject valid optional-argument calls that the server lints accept.
3. Catalog Admin's Validate/Apply path can mark real functions invalid and delete them from
   the effective catalog.
4. MDX catalog overrides are saved but never applied.
5. Client and server validators enforce different rule sets, so the same file passes one path
   and fails the other.
6. The naming dictionary is a second, badly drifted catalog.

---

## 1. Structured formatter removes parentheses and changes the calculation

**What:** Formatting with `tm1-structured` (or `tm1-verbose`) strips explicit grouping.
`['X'] = N: (1 + 2) * 3;` comes back as `['X'] = N: 1 + 2 * 3;`. The formatted rule now
evaluates as 7, not 9. Likewise `(2 + 3) * 4` comes back as `2 + 3 * 4`.

**Where:** `client/src/lib/formatters/tm1-expression-parser.js:48-53` returns the inner
expression for a parenthesised group and discards the parentheses.
`client/src/lib/formatters/tm1-structured.js:55-65` re-emits the binary tree without
re-introducing grouping. The formatter selection is at
`client/src/lib/formatters/rules-formatter.js:205-208`.

**Why it matters to a forker:** A formatter that changes calculation results is worse than no
formatter. This is silent data corruption in the one artefact the IDE exists to edit. Anyone
who copies the formatter inherits it.

**Suggested fix:** Preserve a `paren` node (or equivalent grouping flag) in the parser and emit
it in `fmtExpr`. If the expression formatter is not going to model operator precedence, it must
at least preserve the user's explicit parentheses. Add round-trip tests that assert explicit
grouping survives, not just that formatting returns a string.

**Effort:** Medium.

---

## 2. Client validators reject valid optional arguments

**What:** `SUBSETCREATE('Dim', 'Sub', 1)` and `PARSEDATE('2026', '01', '01')` are valid catalog
calls with an optional trailing argument, but both client validators report an argument-count
error.

**Where:** `client/src/lib/rules-validator.js:360-370` and
`client/src/lib/ti-validator.js:163-174` only compare against `catInfo.min` for non-variadic
functions. `client/src/lib/rules-validator.js:13-31` and
`client/src/lib/ti-validator.js:121-138` compute `{ min, max }` for optional parameters, but the
callers ignore `max`. The server path is correct:
`core/catalog-arity.js:15-25` returns `min`/`max`, and
`core/rules-lint.js:152` / `core/ti-lint.js:55` check both bounds.

The catalog has exactly two optional parameters:
`SUBSETCREATE` (`params: ['dimname', 'subset', 'value?']`) and `PARSEDATE`
(`['value', 'value', 'value?']`).

**Why it matters to a forker:** The editor squiggles valid code and pushes users to remove a
supported argument. The same call passes the MCP/server lint, so the two paths disagree on the
same file.

**Suggested fix:** Share the arity derivation/check between client and server, or at least
check `argCount < min || argCount > max` and handle the variadic branch separately. Add table
tests covering fixed, variadic, `variadicMin` and optional signatures on both validators.

**Effort:** Small.

---

## 3. Catalog Admin validation can delete real functions

**What:** The Validate button builds every test as `NAME(args);` and, on the Rules tab, sends
Rules functions to the TI-process validation endpoint. Results marked invalid can then be
"applied" as deletions from the effective catalog.

**Where:** `client/src/components/CatalogAdmin.jsx:358-366` selects `TI_CATALOG` or
`RULES_CATALOG`, builds `${name}(${args.join(', ')});` regardless of `isStatement` or
`returnType`, and posts to `/api/admin/validate-ti-functions`.
`client/src/components/CatalogAdmin.jsx:387-399` adds every invalid result to `deletions`.

The project's own CLI does this correctly: `tools/validate-catalog.js:61-68` only emits a bare
call for `isStatement`, otherwise it assigns the result. The CLI also documents
(`tools/validate-catalog.js:24-27`) that Rules validation needs a real cube and real
dimension/element names; the Catalog Admin Rules tab does not do that. It compiles Rules
functions as TI.

**Why it matters to a forker:** A misleading "invalid" result plus a one-click Apply can hide
a real function from autocomplete and suppress its warnings. It makes the catalog look
maintained while making it less correct.

**Suggested fix:** Reuse the CLI's `buildTestCall` semantics in Catalog Admin. Do not offer
Rules validation until it can run `CheckRules` against a selected cube with real objects; at
minimum label the current Rules button as "TI-compile check" and do not apply deletions from it
without review. Add a confirmation/review step before suppressing.

**Effort:** Medium.

---

## 4. MDX catalog overrides are saved but never applied

**What:** The Catalog Admin MDX tab lets users add, edit and delete MDX functions, and the
footer says changes apply to autocomplete and validation after reload. The runtime merge only
handles Rules and TI, so MDX edits never take effect.

**Where:** `client/src/components/CatalogAdmin.jsx:260` initialises an `mdx` override bucket,
`:269` renders MDX rows, and `:533` states that changes apply after reload.
`client/src/lib/catalog-runtime.js:13` has `state = { rules, ti }`;
`initEffectiveCatalogs()` at `:31-45` merges only those two. No MDX catalog is fetched or
merged.

**Why it matters to a forker:** The admin UI is the documented way to make the catalog match a
local TM1 version. For MDX it is a no-op, so the UI lies and the MDX validator/autocomplete
stays on the shipped catalog forever.

**Suggested fix:** Either add MDX to the runtime state and merge it into
`MDX_FUNCTIONS_FLAT`/`MDX_CATALOG`, or remove the MDX tab and the override fields and say MDX
is not user-editable. Add a test that an MDX addition/deletion reaches the effective catalog
after reload.

**Effort:** Medium.

---

## 5. `STR` is valid in the catalog but rejected by the server TI lint

**What:** The catalog says `STR` has `language: "both"`, so it appears in TI autocomplete, the
function reference and the client validator. The server TI lint hardcodes it as an error.

**Where:** `shared/tm1-function-catalog.json` (`STR.language === "both"`) versus
`core/ti-lint.js:42-46`, which pushes an error for any `STR()` call. The client validator has no
such exception; `client/src/lib/ti-validator.js` accepts the catalog entry.

**Why it matters to a forker:** The editor and the MCP path disagree about the same function.
Worse, the catalog is described as the single source of truth, but this one function has a
second, hidden rule in a server lint.

**Suggested fix:** Decide the truth and put it in the catalog. If `STR` is Rules-only, set
`language: "rules"` and remove the special case. If it is valid TI in some versions, model it
with `compat`/`deprecated` instead of a hard error, and keep the catalog and all consumers in
step.

**Effort:** Small.

---

## 6. The client TI validator parses comments as code

**What:** Commented-out calls are validated. `# CellPutN(1)` can produce an argument-count
error, and `# NotAFunction()` can produce an unknown-function warning, even though both are
inside a `#` comment.

**Where:** `client/src/lib/ti-validator.js:37-100` (`findFunctionCalls`) tracks strings and
parentheses but never skips `#` to end of line. It is called on the raw section text at
`client/src/lib/ti-validator.js:146`. The server path uses
`core/rules-lint.js:79-95`, whose scanner skips `#` comments, so the two disagree.

**Why it matters to a forker:** Commenting out a bad call is the normal way to debug. The
editor keeps complaining about code that is not executed, and the warning cannot be trusted.

**Suggested fix:** Strip comments before scanning, or teach `findFunctionCalls` to skip `#` to
newline (and decide what to do with `//`). Cover comments, strings with escaped quotes, and
commented calls in tests.

**Effort:** Small.

---

## 7. Client and server validators enforce different rules

**What:** The IDE validator and the server/MCP lint are separate implementations with
different behaviour. Examples:

- `core/rules-lint.js:149-151` deliberately ignores unknown functions; the client reports
  `Unknown function` and TI-only functions in Rules
  (`client/src/lib/rules-validator.js:351-357`).
- Server Rule lint checks arity and a few special messages; the client also checks block
  structure, unknown tokens, `ELSEIF`/`ELSE`/`ENDIF` in Rules, deprecated functions and
  `compat`.
- Server TI lint checks calls and `//` comments (`core/ti-lint.js:34-76`); the client also
  checks IF/WHILE/FOR structure and statement semicolons
  (`client/src/lib/ti-validator.js:306-410`).
- The special `ElementAttrN`/`ElementAttrS` and `AttrInsert` guidance exists in
  `core/rules-lint.js:158-160` and `core/ti-lint.js:59-64`, but not in the client equivalents.

**Why it matters to a forker:** A file can pass the MCP save path and fail in the editor, or
vice versa. A forker has to learn two validation contracts and cannot trust that a green
editor means the MCP build will accept the model.

**Suggested fix:** Make one implementation authoritative. The practical route is a shared
module (or a small server route the client calls) for catalog arity and core rule checks; keep
only editor-specific diagnostics (squiggle placement, Monaco ranges) in the client. If full
unification is not feasible, align the rule sets and document the intentional differences in
one place.

**Effort:** Large (or medium to align the existing checks).

---

## 8. The naming dictionary is a second, badly drifted catalog

**What:** `IBM_DEFAULTS` has 311 entries while the function catalog has 236. 110 catalog names
are absent from the naming dictionary, and 185 naming entries are not in the catalog (some are
legitimate keywords or aliases, but many are functions). `IBM_TYPES` also assigns languages
that contradict the catalog.

**Where:** `client/src/lib/formatters/naming.js:7` (`IBM_DEFAULTS`) and `:358`
(`IBM_TYPES`). It is used by the formatter (`tm1-structured.js:24-29`) and by the function
reference (`client/src/lib/tm1-snippets.js:44`).

Concrete mismatches found:

- `CELLGETN`/`CELLGETS` are `both` in the catalog but classified as `ti` in `IBM_TYPES`;
  `IBM_DEFAULTS` classifies them under Rules.
- `CUBEEXISTS`, `DIMENSIONELEMENTEXISTS` and `LOGOUTPUT` are `ti` in the catalog but Rules in
  `IBM_TYPES`.
- `ISLEAF` is `rules` in the catalog but MDX in `IBM_TYPES`.
- Catalog names such as `ATTRINSERT`, `ATTRDELETE`, `CELLISUPDATEABLE`, `CUBEATTRN` and
  `CONSOLIDATECHILDREN` have no naming entry.
- Naming-only names such as `ASCIREAD`, `FILEDELETE`, `UndeFFn` and `NumberOfTailors` do not
  exist in the catalog.

**Why it matters to a forker:** Formatting with `ibmOfficial` capitalization silently leaves
many real functions in whatever case the user typed, and the function reference can show
stale or non-existent names. This is exactly the drift the catalog consolidation was meant to
end.

**Suggested fix:** Derive casing (and, where possible, type) from the catalog. Keep
`IBM_DEFAULTS` only for keywords, aliases and deliberate overrides; move the long function
lists out. Add a test that every catalog key has a casing entry and every non-keyword naming
entry exists in the catalog (or is explicitly allow-listed).

**Effort:** Medium.

---

## 9. Snippet library offers functions that are not in the catalog

**What:** The snippet library contains `UCASE()` and `LCASE()` entries. The catalog has
`UPPER`/`LOWER` but no `UCASE`/`LCASE`, so these snippets insert calls that the validator and
TM1 do not know. `STR` is also tagged `both` in the snippet library while the TI lint rejects
it (finding 5).

**Where:** `client/src/lib/tm1-snippets.js:304-311` (`UCASE`, `LCASE`), with the filter at
`:14-16` and the function reference at `:41-61`. `getSnippets()` at `:333-336` does not apply
the catalog filter at all.

**Why it matters to a forker:** A snippet is supposed to be a safe, working example. Inserting
a non-existent function creates an immediate error and teaches the wrong TM1 API.

**Suggested fix:** Replace `UCASE`/`LCASE` with `UPPER`/`LOWER`, or add them to the catalog only
after live verification. Make snippet registration assert that every function name is in the
catalog and supports the snippet's language. Apply the same filter in `getSnippets()` or remove
the unused export.

**Effort:** Small.

---

## 10. The TI interpreter is mostly unreachable code

**What:** `executeTI()` is exported from `client/src/lib/ti-interpreter.js` but never imported
anywhere. Only `scanVariables()` is used, by `ProcessEditor.jsx:16`. The file is 761 lines.

**Where:** `client/src/lib/ti-interpreter.js:668` (`executeTI`); the only import is
`client/src/components/ProcessEditor.jsx:16` (`scanVariables`).

**Why it matters to a forker:** This looks like a working client-side TI simulator, but it is
not wired to the debugger or UI. It is a large piece of half-built code that a forker may try
to use or maintain. It also has no tests.

**Suggested fix:** Either delete `executeTI` and keep only `scanVariables`, or wire it into a
documented debugger/simulator feature with tests. If it is intentionally experimental, move it
out of `client/src/lib` and label it clearly.

**Effort:** Medium (delete is small; wiring is large).

---

## 11. "Align = signs" is a visible setting that does nothing

**What:** The formatter settings expose an "Align = signs" toggle, and one preset enables it,
but the implementation returns the lines unchanged.

**Where:** `client/src/lib/formatters/rules-formatter.js:239-253` calls
`alignEqualsInRegions()`, which is a no-op with a "Phase 1.5 / Phase 2 enhancement" comment.
The UI toggle is at `client/src/components/FormatSettings.jsx:298`; the preset that enables it
is in `client/src/lib/formatters/presets.js`.

**Why it matters to a forker:** A documented formatting option that silently does nothing is
confusing, especially when the preset claims to use it.

**Suggested fix:** Implement the alignment, or remove the toggle and the preset flag until it
works. Add a test for the chosen behaviour.

**Effort:** Small (remove) or medium (implement).

---

## 12. MDX validation is a second catalog and does not skip comments

**What:** The MDX validator is driven by `tm1-mdx-catalog.js`, not the shared function catalog,
and its call scanner does not skip MDX comments. A commented-out `Foo()` can be reported as
unknown or wrong-arity.

**Where:** `client/src/lib/mdx-validator.js:5-10` builds `MDX_CATALOG_MAP` from
`MDX_FUNCTIONS_FLAT`; `findMDXFunctionCalls()` at `:18-95` tracks strings and parentheses but
not `--` comments. `MDX_CATALOG` lives in `client/src/lib/tm1-mdx-catalog.js`.

**Why it matters to a forker:** MDX and TM1 Rules/TI are different languages, so a separate
catalog can be defensible. But the same "single source" promise does not hold here, and the
comment-scanning bug produces noise in normal MDX editing. MDX overrides in Catalog Admin are
also dead (finding 4), so there is no working way to correct the catalog from the UI.

**Suggested fix:** Decide and document that MDX has its own catalog; make the validator skip
`--`/`//` comments and strings; route MDX overrides through the runtime or remove the MDX
override UI. Add tests for comments, member properties and known/unknown functions.

**Effort:** Small to medium.

---

## 13. Syntax highlighting uses the base catalog, not the effective catalog

**What:** Rules function highlighting is built once from the base `RULES_CATALOG`. Functions
added through Catalog Admin are not highlighted; functions deleted through it remain
highlighted. Hover uses the effective catalog, so hover and highlighting disagree.

**Where:** `client/src/lib/tm1-functions.js:26-38` builds `rulesFnPattern` from the base
catalog at registration; `:419-433` uses `catalogEntry()` and therefore sees overrides.

**Why it matters to a forker:** The override feature appears to work in completion and hover
but not in the colouring, which is confusing and makes added functions look unrecognised.

**Suggested fix:** Build the pattern from the effective catalog and re-register/update it when
overrides change (or after reload). Add a test for an added and a deleted function.

**Effort:** Small.

---

## 14. Two different functions are both named `registerTM1Completions`

**What:** `tm1-functions.js` exports a 3-argument `registerTM1Completions(monaco, getServer,
getVersion)` that registers MDX and TI variable suggestions. `tm1-completion.js` exports a
5-argument `registerTM1Completions(monaco, language, catalog, keywords, getContext)` that
registers Rules/TI function and keyword completions. Both are imported in the same editor
files.

**Where:** `client/src/lib/tm1-functions.js:17` and `:483`;
`client/src/lib/tm1-completion.js:404`. Call sites are
`client/src/components/ProcessEditor.jsx:6,926-927` and
`client/src/components/EditorPane.jsx:22,636-637`.

**Why it matters to a forker:** Same name, different contract, different purpose. Calling the
wrong one produces missing completions rather than an error. This is exactly the "one obvious
way" problem.

**Suggested fix:** Rename them by purpose (`registerTM1BaseCompletions` /
`registerLanguageCompletions`) and document which editor registers which. Keep the two
providers if they serve different jobs, but make the names say so.

**Effort:** Small.

---

## 15. Smaller issues

- **`core/rules-lint.lineAt` rescans from the start for every call.**
  `core/rules-lint.js:34-38` is O(n²) on large rules files. Precompute line starts or use a
  running position. Effort: small.
- **`tools/validate-catalog` builds OData keys with `encodeURIComponent`.**
  `tools/validate-catalog.js:104,109` deletes `Processes('<percent-encoded name>')`; the OData
  key helper (`odataKey`) is the project convention. Temp process names are currently safe, but
  the pattern is wrong to copy. Use the shared helper and log cleanup failures. Effort: small.
- **No direct tests for the validator/catalog layer.** No test file imports
  `core/rules-lint`, `core/ti-lint`, `core/catalog-arity`, `client/src/lib/rules-validator`,
  `ti-validator`, `catalog-runtime` or `CatalogAdmin`. `tests/hierarchy-gen.test.js` only
  reaches `ti-lint` indirectly. The optional-argument and comment bugs above would be caught by
  simple table tests. `format-sweep.test.mjs` tests `applyTm1Format` (number formats), not
  `formatRules` with the structured preset. Add tests for arity (fixed/variadic/optional),
  comment/string scanning, validator parity, override merge (including MDX), snippet catalog
  membership, and formatter parenthesis round-trips. Effort: medium.

---

## Checked and found nothing (for this area)

- `shared/tm1-function-catalog.json` schema: 236 entries, languages `both: 84`, `ti: 130`,
  `rules: 22`; 2 optional parameters, 2 `variadicMin` entries, 93 statements; all entries have
  the expected fields and no invalid `language`/`compat` values. No duplicate keys (JSON object).
- `core/catalog-arity.js` itself is correct for fixed, variadic, `variadicMin` and optional
  signatures; the bugs are in the client callers that ignore its `max`.
- `tools/validate-catalog.js --language both` correctly includes TI and `both` entries; the
  earlier suspicion that it filtered only `language === "both"` was wrong.
- Rules/TI autocomplete, signature help and hover all read the effective catalog when one is
  loaded; only syntax highlighting uses the base catalog (finding 13).
- The default (non-structured) formatter path preserves explicit parentheses in the cases
  tested; the corruption is specific to the `tm1-structured`/`tm1-verbose` presets.

No TM1 server or live REST call was used in this review.
