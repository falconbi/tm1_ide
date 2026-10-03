# Building TM1 models through the MCP

Read this before building a model from a requirements document. It is the method,
not the API reference — for the tool list see `MCP_SERVER.md`.

Accretive: every model built adds to the "What each build taught us" log at the
bottom. Learnings get sorted into one of three homes:

- **enforceable rule** → a check in `core/rules-lint.js` or `core/ti-lint.js` (the
  agent can't bypass it)
- **per-call nudge** → the `description` string of the relevant tool in
  `tools/tm1mcp/server.js` (seen on every call)
- **method / judgement** → this file

---

## The one principle

There are two questions about any model, and they need different answers:

1. **Is it written correctly?** — syntax, argument counts, section order. The
   linters and TM1's own `CheckRules` answer this. Cheap, automatic.
2. **Does it compute the right number?** — only a human plus `read_cells` against
   a known-good figure answers this. TM1 will happily return a confident wrong
   number with no error.

**So: for every worked example in the requirements document, add an assertion and
verify it with `read_cells` before closing the change set.** A build that passes
the linters and returns numbers is not a build that is correct.

---

## Get the dimensionality right first

Before any `build_cube`, settle the dimensions. Wrong dimensionality is the one
mistake you cannot lint your way out of and cannot cheaply fix later.

Signs you have a dimension missing and are about to encode it wrong:

- **Element names with a suffix that encodes a second attribute** — `Benefits
  North`, `Benefits South`; `Rent UK`, `Rent USA`. The suffix is a dimension.
  Model it as `Account × Entity`, not as `Account` with the entity baked into
  the name.
- **Parallel measures that are one measure times a type** — `Direct Input`,
  `Allocation`, `Fully Loaded` as three measure elements is usually one `Amount`
  measure and a missing `Method` / `Layer` dimension (or just rules).
- **A cube whose rules constantly parse the element name** (`SUBST`, `SCAN` on
  `!dim`) — the thing being parsed out wants to be its own dimension.

If the design needs another dimension, **create it — even if cubes must be
dropped and rebuilt.** Do not let build friction (an existing cube, a change-set
already open) push you into adding elements to the wrong dimension. Rebuilding a
cube is a 5-minute cost; a wrong grain is a rebuild of the whole model.

### Fixed house dimension order

Every cube uses the **same dimension order**, deliberately *not* re-tuned per cube
for sparsity. There is a sparsity-optimal order for any given cube; we don't chase
it. A predictable order across every cube is worth more — views and subsets line
up, cross-cube reading is easier, and rules are easier to follow.

```text
Period, Version, Company, Cost Centre, Account, Type, <cube-specific dims>, Measure
```

- Use whichever of the leading dimensions the cube actually has, in that order.
- Any dimensions unique to this cube go after `Type` and before the measure
  dimension.
- The measure dimension is always last (see below).

### Every cube has a measure dimension, and it goes last

No exceptions. The last dimension of every cube is its measures, named
`<Prefix> <Cube distinctive name> Measure`:

- `WFP Workforce Cost` → `WFP Workforce Cost Measure`
- `WFP Headcount` → `WFP Headcount Measure`
- Reference-data cubes too: `WFP FX Rates` → `WFP FX Rates Measure` (with a
  `Rate` element); `WFP Tax Bands` → `WFP Tax Bands Measure` (`From`, `To`,
  `Rate`, …).

A dedicated per-cube measure dimension (not a shared one) keeps each cube's
measures self-documenting, keeps rules unambiguous about which measure they
target, and gives every cube an obvious axis for its default view.
`build_cube` refuses a cube whose last dimension name doesn't end in
`Measure`/`Measures`.

**Default element format is `#,##0.00`** — numeric, thousands separator, 2 dp.
Every measure dimension gets a `Format` element attribute and `build_dimension`
sets each numeric element to `#,##0.00` automatically. Override per element where
that's wrong: `0.00%` for ratios/percentages, `#,##0` for headcount/counts, more
decimals for FX and unit rates. Pass the override as a `Format` attribute value
in the same `build_dimension` call.

---

## Dimensions

- **Small and hand-listed in the doc** → `build_dimension` (elements, edges,
  attributes in one call).
- **Large, or sourced from a system** → a TI process (`build_process`) that loads
  from a datasource. Don't enumerate hundreds of elements as tool arguments.
- Element attributes: on v11 the rule/TI functions are 4-arg
  (`ElementAttrN(dim, hier, elem, attr)`) — the linters enforce this. The 3-arg
  legacy `ATTRN`/`ATTRS` also work and are simpler for single-hierarchy dims.
- You cannot create an element attribute on a zero-element dimension. Insert
  elements first.

### Version dimension — calculating vs static

A version has one of two roles at any time, carried on a `Version Type` string
attribute:

| `Version Type` | Behaviour | Members |
|---|---|---|
| `Calculated` | live, fully rule-driven, carries **its own complete set of assumptions** | `Budget` (while being built), `Forecast` (the working current model), scenarios (`Downside`, …) |
| `Static` | fixed; carries no rule; holds only what a snapshot process wrote | `Actual`, budget snapshots (`Budget FINAL`), monthly forecast snapshots (`FCST 2026-01`, …) |

The static members sit under one consolidation parent (`Non-Calculating`) so a
single rule guard can hold them — see the non-calculating landmine below.

Rules:

- **A snapshot is a new Version member** — not a separate dimension or cube. Every
  existing view, subset and report then works on it unchanged, and analysis stays
  in the same cube. At month-end close, a TI copies all `Forecast` leaf cells into
  a new static member; `Forecast` itself rolls forward.
- **Assumption encapsulation** — no `Calculated` version's rules read another
  version's assumptions or drivers. The **only** permitted cross-version read is
  **prior-period `Actual`** (closed-month values, or a driver keyed on actual
  history), and it comes in as a rule (`['Forecast'] = N: IF(closed, DB(…Actual…),
  STET)`), never a copy.
- **Cube rules target `Calculated` members**, so `Static` members are never
  overwritten by a recalculation. Either scope the rule area to those members
  explicitly, or guard on the `Non-Calculating` parent (see the landmine below).
- Cross-version coupling (e.g. "`Forecast` open months = the `Working` version")
  causes feeder traps and version-agnostic reference bugs, and makes a version
  impossible to reason about alone. Don't.

### Variance as version members

- **Variance is a version member, not a new cube or dimension.** Add a calculating
  `Variance` folder (weight-0 edges so its total is inert) with members like
  `Act vs Bud` = `DB(…,'Actual',…) − DB(…,'Budget',…)`, `Fcst vs Bud`,
  `Var FX` / `Var Operational`. Every existing view/report then does variance by
  picking the member — zero rework.
- **Gate the actuals-only variance** (`Act vs Bud`) to closed periods — a
  `WFP Period` "Actuals Closed" numeric attr set by the actuals load. Otherwise
  open months read `0 − Budget` as a huge favourable swing, and it's wrong at FY.
  Use `Fcst vs Bud` for the full-year outlook (Forecast already carries Actual in
  closed months).
- **Put the variance rules ABOVE the currency-translation rule.** The variance
  members have no FX rate of their own, so the P5-style `['Reporting'] = Σ ccy ×
  DB(FX, !Version, …)` returns 0 for them. First-match-wins → the variance rule
  must be earlier so it computes `Actual/Reporting − Budget/Reporting` directly.
- **FX vs operational split:** `Var FX` = Actual at actual rate − Actual at Budget
  rate; `Var Operational` = Actual − Budget both at Budget FX. They sum to the
  total variance because Budget's two currency views are equal by definition.
- **Closed-month = Actual creates "zombies"** when the forecast roster isn't kept
  current: someone who left shows present (actual) → gone (actual) → back (stale
  plan for open months). That's realistic and exactly what the variance layer is
  for — flag it, don't paper over it in the actuals load.
- **Stock measures (Headcount, FTE) sum over YTD / quarter / FY rollups** — a YTD
  headcount is headcount-months, not period-end. The *variance* is still correct
  (−1 vs −1); the absolute needs a period-end aggregation rule if it matters.

---

## Rules and TI

- The linters catch argument counts, 3-arg `ElementAttrN`, `IF` nested past 2
  deep, TI attribute writes ordered before the element insert commits. They do
  **not** catch wrong logic. Reading numbers back does.
- Flatten `IF` past two levels into helper measures — three-deep silently returns
  blank on this engine.
- In TI, structure goes in Prolog; attribute *values* go in the Epilog (Prolog
  inserts aren't committed until the Prolog ends).
- Feeders: don't feed a `DB()` whose target element is read from an attribute
  that might be blank — it feeds a non-existent element and fails at load.
- **A ratio KPI at a consolidation (cost per FTE, etc.) is painful under
  SKIPCHECK.** The rule computes `Amount / FTE` at every level, but a rule cell
  that *overrides* a consolidation needs that consolidated cell explicitly fed —
  feeding the leaves doesn't help (and their sum is the wrong number anyway). An
  over-feed for every entity/CC/department combo isn't worth it. Compute the ratio
  in the view / reporting layer instead, or accept it only at leaf level.
- **A one-off payment in a month with no base pay** (severance the month after a
  leaver's last month) is missed if `One-Time` cost is fed only from the salary
  driver (`_Monthly Base Full`, which is 0 that month). Feed the `One-Time` cost
  cell directly from the `One-Time Amount` input.

### House rules (from the Cubewise best-practice papers, still current)

- **Update a dimension, never Recreate.** Recreate drops any element missing from
  the new load *and its historical cube data*, silently and unlogged. Incremental
  `add_elements` / `restructure_dimension` are Update-style — keep it that way; a
  full rebuild only from a datasource that is authoritative for every element.
- **Zero the target region before an accumulating write.** A load that adds to
  the existing cell (`CellGetN` + add, or datasource "accumulate") double-counts
  on re-run. Our seeds write absolute values, so this only bites if a process
  ever switches to accumulate — clear the slice first (view + `ViewZeroOut`-style)
  in the Prolog.
- **Cube logging off during a bulk write must be guaranteed to come back on.**
  `CubeSetLogChanges(cube, 0)` is the speed lever, but if a fatal error in Data
  skips the Epilog the cube is left unlogged (crash = silent data loss until
  someone notices). Restore in the Epilog *and* either run it as a 3-step chore
  (off / load / on) or add a startup check that re-enables logging.
- **TI data sources are process-specific temp views/subsets, built in the Prolog
  and destroyed in the Epilog.** Never point a process at `Default` or a
  reporting subset — someone will change it and the process silently reads the
  wrong slice.

### Bespoke vs library (Bedrock)

- **Model logic ships bespoke.** Snapshot / version copy / close / allocations /
  recalc chains — anything scheduled, assertion-backed, or part of what the model
  produces — is a short purpose-built process shaped to *this* model's known
  cubes. It has to be reviewable in a change set, lintable, and testable. A
  generic library process (Bedrock `}bedrock.cube.data.copy` is ~2,200 lines, 35
  params, 27 dims hand-unrolled, and ships with a real copy-paste bug on the
  `v24` line) is none of those things.
- **Bedrock is a dev/admin toolbox**, not application code: ad-hoc region clears,
  one-off copies, view→file exports, dimension surgery while building. Fine to
  keep on the server; don't wire it into a chore.
- **The reusable technique from Bedrock's copy:** a **cube-view datasource** for
  the read (never nested `DIMNM`/`CellGetN` loops — those walk every empty
  intersection) plus **`CubeSetLogChanges(cube, 0)` around the write** (restore in
  Epilog). That combination is the speed, not the ASCII round-trip — exporting to
  a flat file and re-importing only pays off for cross-server copies or
  file-split parallelism. A view datasource also hands you `NValue` **and**
  `SValue`, so numeric and string cells copy in one pass.

---

## Views

- **Every cube gets a default view. Every dimension gets a default subset.** No
  exceptions — a cube or dimension with nothing to open is not finished. Name
  them `Default` (or set the cube's default view). Dimension default subset is
  usually all leaves, or all members if the consolidations matter.
- **Native for anything a human opens in the IDE** — input templates, standard
  reports, P&L layouts. The IDE's MDX-view axis parser is fragile with
  CROSSJOIN / ranges / filters; native views always render.
- **MDX only where the view genuinely needs set logic** native can't express, and
  you'll consume it via `execute_view` / the API rather than the IDE grid.
- Native axis entries take `subset:"Name"`, `members:[...]`,
  `memberSet:"leaf"|"root"`, or `customExpr:"<MDX set>"`.

## Subsets

- **Static `elements` list** when the membership is fixed and small.
- **`expression` (MDX set)** when it's rule-based — all leaves, top N, filter by
  attribute.

---

## Workflow

Each model gets its own server (e.g. `DEV_A`). Baselines are per-server
(`.tm1baseline/<server>.json`), so builds on different servers don't interfere.
Seed once at the start; re-seed only after a deploy, when starting the next version.

```
seed_baseline                     first — so the diff shows only what you build
start_change_set  "AI: <model>"
  … build dimensions, cubes, rules, processes, views …
  add_assertion   per worked example in the doc, AS YOU GO
run_assertions                    self-check before closing
close_change_set                  runs the assertions again, reports pass/fail
package_change_set                build the deployable
check_deploy_risk / check_target_drift   against a target
                                  → a human does the actual deploy
```

Narrate each step. Don't go dark for twenty tool calls — report what was built
and what the numbers came back as.

---

## v11 landmines (most are lint-enforced)

See `MCP_SERVER.md` → "Notes & limits" for the full list. The ones that cost real
iterations:

- 3-arg `ElementAttrN`/`ElementAttrS` — parses fine, returns blank at runtime
- `AttrInsert` is 4 args, not 3
- TI Prolog element insert + attribute write in the same section
- 3-deep nested `IF()` returns blank
- element rename is not supported (`restructure_dimension` reports this honestly)
- **static subset save APPENDS.** `PATCH .../Subsets('X')` with
  `Elements@odata.bind` adds to the existing members, it doesn't replace them —
  re-running a subset seed accumulates duplicates. Rebuild with
  `SubsetDeleteAllElements` then `SubsetElementInsert` in a TI.
- `SubsetCreatebyMDX` silently no-ops — use `SubsetCreate` + a
  `SubsetElementInsert` loop.
- `CubeProcessFeeders` is the only feeder-recalc that works — `tm1.CheckFeeders*`
  / `tm1.CheckFeedersOfCell` (Architect "Check Feeders") 404 on this build.
- **Stopping calc for a group of versions (non-calculating / static).** A bare
  `['<consolidation>'] = N: STET;` does **not** hold — the calc rules below still
  fire. The guard that works, first after `SKIPCHECK`:
  `[] = N: IF(ELPAR('<Version dim>', !<Version dim>, 1) @= '<non-calc parent>', STET, CONTINUE);`
  A rule *area* can't test a parent/attribute — only the RHS can. `CONTINUE` is a
  valid keyword. Put the non-calc versions under one consolidation parent.
- **`DimensionElementComponentAdd` in a TI Prolog is not committed until the
  Prolog ends** (the non-`Direct` form). A process that creates a member, parents
  it with `DimensionElementComponentAdd`, then writes its cells (where the
  parent's rule guard should permit the write) must do the writes in the
  **Epilog**. Or use `DimensionElementComponentAddDirect` (v11 has it — see
  `WFP Load Positions`), which commits immediately, same as
  `DimensionElementInsertDirect`.
- **A parse-a-delimited-string loop (`WHILE(SCAN('~', v) > 1)`) skips the LAST
  record** if it has no trailing `~`. Always end the string with the delimiter.
  `WFP Load Positions` silently dropped its final roster row for months this way.
- **Restructuring a dimension can rewrite views that reference it.** Adding ~230
  members to `WFP Period` (the YTD hierarchy) silently degraded
  `Cost by Cost Centre`'s column axis from the named subset `2026 Quarters + FY`
  to an empty inline subset. Give every view axis a **named public subset**, not
  an inline / dynamic one — named subsets survive a restructure; inline ones get
  re-materialised. After a bulk dimension load, eyeball any view that used that
  dimension.
- **First matching rule wins, not last.** When two rule areas overlap on a cell,
  TM1 uses the one defined *earlier* in the file. So a broad component rule
  (`['Base'] = N: …`, area = one Pay Component element, every measure) beats a
  later measure rule (`['Amount Capex'] = N: …`, area = one Measure element, every
  pay component) on the cell they share — the new measure just inherits the
  component value. Fix: put the narrower/override rule **above** the broad one,
  and have it `CONTINUE` for the cells it doesn't own. Verify by reading one
  overlapping cell back — the symptom is "every measure returns the same number".
- **An `N:` rule is leaf-only — do NOT add `ELLEV(...) = 0` guards or `CONTINUE`
  branches inside it.** The `N:` qualifier already means "fires only at leaf cells
  of every dimension"; a consolidation never reaches an `N:` rule, it rolls up
  from its leaves naturally. So a per-leaf calc (capex = amount × a cost-centre
  rate) needs **no** leaf guard: write `['<measure>'] = N: IF(<gate>, expr, 0)`
  and the consolidations aggregate the leaf values correctly on their own.
  Adding `ELLEV(...) = 0` checks + `CONTINUE` is redundant noise that obscures the
  logic and breeds bugs — a leftover `CONTINUE` in the false branch makes the
  next matching rule (e.g. the component rule, or the Reporting translation)
  supply the value instead of `0`, silently breaking the split. `CONTINUE` only
  belongs in a rule that *does* fire at consolidations (a `C:` or unqualified
  rule). Verified: the WFP capex/opex split runs with no guard and all
  consolidations roll up correctly (55/55 assertions).
- **Feed a rule's output from its TRUE input, not from a blanket root.** A
  feeder section that says `['_Monthly Base Full'] => ['Base'], ['Gross Pay'],
  ['Employer Payroll Tax'], ... ['Net Pay'], ['_Earnings YTD'], ...` is
  inarticulate — it works but doesn't explain why. Each arrow should read as a
  dependency statement: `['Base'] => ['Gross Pay']` because gross = base;
  `['_Earnings YTD'] => ['_Employer Tax YTD']` because the tax is a function of
  earnings, not of monthly base. Write the feeder section as a mirror of the
  rule dependency graph, per-component.
- **Never feed rule-read-only helper cells.** Feeding only matters for cells that
  must appear in a *consolidation*. A helper that is a leaf and is only
  referenced by other rules (`_Earnings YTD`, `_Employer Tax YTD`, the
  `_Start/_End` index helpers) does NOT need feeding — a rule reads its value
  directly. Blanket-feeding helpers is pure noise and hides the real structure.
- **The currency/measure fan-out is irreducible under SKIPCHECK.** A rule-computed
  Reporting / Budget-FX / Capex / Opex leaf must be individually fed to roll up
  into a consolidation. So the translation-currency feeds can't be removed — but
  organise them **per component from that component's own local driver**, not as
  one mega-fan-out from a single source. (Verified: the WFP feeder rewrite cut
  ~50 blanket targets to a per-component dependency map, 55/55 assertions green.)

---

## What each build taught us

### OPX Allocations (Sep 2026) — first end-to-end MCP build

- **Wrong dimensionality.** Cost centres were built as `Benefits North Src` /
  `Benefits South Src` — subsidiary baked into the element name instead of a
  `Subsidiary` (or `Entity`) dimension. Also `Direct Input` / `Allocation` /
  `Fully Loaded` as separate measure elements where one `Amount` measure would
  do. This is a modelling competence failure, not a TM1 quirk — hence the
  "Get the dimensionality right first" section above. Likely cause: building
  cube-by-cube against an already-open change set made "add elements to the
  existing dimension" the path of least resistance over "introduce a new
  dimension and rebuild the cubes."
- 3-arg `ElementAttrN` returned blank for ~2 iterations → became a lint rule.
- TI built month elements in Prolog then wrote attributes on them in Prolog →
  "element not found" at runtime → became a lint rule; fix is attributes in
  Epilog.
- 3-deep `IF()` in the Direct Expense rule returned 0 with all inputs correct →
  flattened into helper measures.
- MDX views wouldn't render in the IDE → rebuilt as native. Native is now the
  default recommendation.
- ~175 tool calls, ~89 `read_cells` verifications. Checking was half the work and
  stayed manual.

### Workforce Planning — Phase 1 (Sep 2026) — second MCP build

- **Clean first pass — 16/16 assertions on the first `run_assertions`.** No
  wrong-number iterations. Differences from OPX: dimensionality agreed and
  written up in full (`WORKFORCE_MODEL_PLAN.md`) before any `build_cube`;
  helper measures for the proration logic kept every rule ≤1 IF deep; guards
  written as one compound `IF(cond1 & cond2, expr, 0)` not nested.
- **`STR()` in TI fails on this engine** — `vYr = TRIM( STR( nYear, 12, 0 ) );`
  → "invalid numeric expression". `STR` is a *rules* function; TI wants
  `NumberToString` / `NumberToStringEx`. Worked around by building the small
  fixed period dimension declaratively. → candidate ti-lint rule: flag `STR(`
  in TI code.
- **Parse-a-delimited-string-in-TI** works well for loading a roster / rate
  table without a datasource file: `~`-delimited records, `;`-delimited fields,
  repeated `SCAN`/`SUBST`. `DimensionElementInsertDirect` + immediate `AttrPutS`
  in the Prolog (Direct commits, so no Prolog-timing problem).
- The attribute-fed-feeder lint warning fired on
  `['FTE'] => DB(..., ATTRS(pos,'Home Entity'), ATTRS(pos,'Cost Centre'), ...)`
  — acceptable here because the loader `ItemReject`s any position whose
  entity/CC don't resolve, so the attributes are never blank.

### Workforce Planning — Phase 1 rev B (Sep 2026) — design review + rebuild

- **First build passed 16/16 assertions but was still wrong.** A design review
  found 7 foundational gaps (Version not Scenario, currency + FX, headcount as an
  output, salary as input not attribute, employment type, multi-year period,
  **progressive banded taxation**). Passing assertions ≠ a correct model — the
  assertions only check what you thought to check. The reviewer (domain expert)
  caught what the build missed.
- **`Group` is ambiguous when it's a member of two dimensions** — Entity *and*
  Currency both had `Group`. `['Group', 'Base'] = ...` → "Element name ambiguous".
  Rules can't disambiguate by dimension in the area. Fix: rename one (currency
  member → `Reporting`). → worth a lint check: flag an element name that exists
  in more than one dimension used by the same cube.
- **Progressive tax needs a YTD roll-forward even in "Phase 1".** Annual
  thresholds/caps mean `tax[month] = f(cumulative_YTD) - f(cumulative_prior)`.
  The 4-band walk is `Σ MAX(0, MIN(ytd, To_b) - From_b) * Rate_b` — flat, no IF
  nesting, unused bands (To=From=Rate=0) contribute 0. YTD resets at the FY
  boundary via `SUBST(!period, 6, 2) @= '01'`.
- **Reporting-currency translation as a rule area**: `['Reporting', 'Base'] = N:
  Σ DB(self, <ccy>, 'Base') * DB('FX Rates', <ccy>, ...)`. Place it *before* the
  local-currency `['Base']` rule so the more-specific area wins.
- Rebuild cost: ~70 objects, one change set, ~2 hours. Deleting + recreating was
  cleaner than surgical edits given Period, Pay Component, and all cubes changed.

### Workforce Planning — Phase 1 rev C (Sep 2026) — employee income tax / gross-to-net

- **Recreating a cube breaks the feeders from other cubes into it.** After
  `delete_object` + `build_cube` on `WFP Workforce Cost`, every leaf computed
  fine on a direct read but all consolidations returned 0 — the
  `WFP Workforce Input ['FTE'] => DB(WFP Workforce Cost, …)` feeder was dead.
  Re-applying the source cube's rules did **not** fix it. Fix: a TI running
  `CubeProcessFeeders('WFP Workforce Cost')`. **Always run CubeProcessFeeders on
  any cube you recreate, and on cubes that feed into it.** Keep a
  `<prefix> Reprocess Feeders` process in the model.
- **Progressive tax generalises cleanly**: one `WFP Tax Type` axis on the bands
  cube (`Employer Payroll Tax` / `Employee Income Tax`), the same 7-band YTD walk
  with the type as a parameter. Employee income tax verified against real
  NZ/UK brackets to the cent.
- Pay Component split into `Cost to Company` (C) and `Employee Deductions` (C),
  with `Gross Pay` and `Net Pay` as computed leaves
  (`Net Pay = Gross Pay − Employee Deductions`, referencing the consolidation
  directly in the rule).
- Contractor gate extends: no employer on-costs AND no employee PAYE / pension
  (a contractor invoices gross), so Net = Gross for them.
- **Default subset / view compliance** — a TI loops the model dimensions and
  builds a `Default` subset (all members) on each; a `Default` native view on
  each cube. `SubsetCreatebyMDX` silently no-opped on this engine — use
  `SubsetCreate` + a `SubsetElementInsert` loop.

### Workforce Planning — Phase 1 rev D (Sep 2026) — house conventions retrofit

Retrofit of three model-wide conventions onto a finished, assertion-green model:
per-cube measure dimension last, fixed house dimension order, default `#,##0.00`
element format. All six cubes dropped and rebuilt.

- **A coordinate-only rewrite is safe if you keep every element name identical.**
  Renaming the four "item" dims to `<Cube> Measure`, adding two new measure dims,
  and reordering cube dimensions touched ~40 `DB()` calls and ~25 rule areas —
  but because element names never changed, rule *areas* (`['Reporting', 'Base']`)
  needed no edits at all; only positional `DB()` argument lists were remapped.
  19/19 assertions green on the first `run_assertions` after the rewrite.
- **Rule areas are matched by element name, not dimension position** — so a
  single-element measure dim (`WFP Workforce Cost Measure` = just `Amount`) costs
  nothing in the calc rules; every `['Base'] = N: …` still resolves to Base ×
  Amount. Only `DB()` self-references have to carry the `'Amount'` coordinate.
- **YTD prior-period self-references survive a dimension reorder** provided the
  `ATTRS('WFP Period', !period, 'Prior Period')` term lands in the new Period
  slot. Verified with a *sum-of-12-months = FY* assertion, which catches a
  mis-placed self-ref coordinate that a single-period check would miss.
- **Every cube gets a measures dimension, last — no exceptions.** This is
  standard TM1 practice. A cube with one measure today (`WFP Workforce Cost
  Measure` = `Amount`) still gets the dimension: it is the extension point for
  the next measure, it keeps every cube's shape uniform, it gives the default
  view an obvious axis, and `build_cube` enforces it. Don't skip it just because
  the account dimension already carries the line structure.
- Seed-TI rewrite is the fiddly part: every `CellPutN` argument list is
  positional and has to be re-ordered to the new cube shape. Dims whose position
  didn't change (Tax Bands: Jurisdiction, Tax Type, Band, Measure) needed no
  edit.
- Rebuild cost: 39 change-set objects (92 in the release package), one change
  set, ~1 hour — cheaper than rev B because the logic was already correct and
  only coordinates moved.

### Workforce Planning — Phase 2 (Sep 2026) — versions & assumptions

- **A calculating version needs its downstream cells fed explicitly.** A
  `['Forecast'] = N: IF(cutoff, Actual, Working)` rule computes fine on a direct
  leaf read, but every consolidation over it read 0. `!WFP Version` feeders
  (`['FTE'] => DB(cube, !WFP Version, …)`) only ever fire for versions that have
  an *input* FTE cell — Forecast never does. Fix: feed the Forecast targets from
  a version that is always populated — `['Working', 'FTE'] => DB(cube, 'Forecast',
  …)` — a literal target, not `!WFP Version`.
- **Reference cubes that carry a `Version` dimension but hold version-agnostic
  data are a trap.** `WFP FX Rates` and `WFP Pay Rates` are keyed by Version; the
  engine reads them at `!WFP Version`. A new version (`Forecast`, a scenario)
  reads blank there until the seed is re-run for it — and the symptom is a
  silently-short consolidation, not an error. Either drop `Version` from the
  cube, or read at a fixed version in the rules, or (stopgap) loop **all** leaf
  versions in the seed (`DIMNM('<Version dim>', n)` not a hard-coded
  `'Budget|Working|'`).
- **Can't `CellPutN` to a consolidation.** `WFP Entity` has `Group` (C); seeding
  assumptions looped `Group` → "Cell type is consolidated". Write leaf entities
  only; rules read at a leaf (the position's Home Entity).
- **Neither `tm1.CheckFeedersForRules` nor `tm1.CheckFeedersOfCell` exists on
  this v11** — `check_feeders` / `trace_feeders` both fail. Only
  `CubeProcessFeeders` (the TI function) works. Diagnose under-feeding by reading
  the consolidation one level at a time (single position → position total →
  entity total) to find where it drops to 0.

### Workforce Planning — P5 simplification (Sep 2026)

- **`ELLEV` guards + `CONTINUE` inside an `N:` rule are redundant — and harmful.**
  The P5 capex/opex split was originally written with a five-way `ELLEV(...) = 0`
  leaf guard and a `CONTINUE` fallthrough. But `N:` already means "leaf cells
  only"; consolidations never reach the rule and roll up naturally (verified:
  the R&D consolidation computes correct Capex/Opex with no guard). When the
  guard was stripped, a leftover `CONTINUE` in the false branch made the next
  matching rule (the component rule / Reporting translation) supply the value
  instead of `0`, breaking `Capex + Opex = Amount` by exactly one component's
  value (11,850). The fix was `CONTINUE` → `0`. See the "Rules and TI" section
  for the full convention. Rule-reading discipline: when you edit a rule, re-read
  an overlapping cell AND a consolidation to confirm both still behave — one
  assertion (`capex + opex = Amount`) caught what a leaf-only read would miss.

### FIN Consolidation v1 — checkpoints 1–2 + periods (Sep 2026) — TM1_CONSOL (Windows)

- **Windows reserved device names.** TM1 saves every object as a file. On a Windows server a name
  whose part before the first dot is `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` can't be created:
  `CON.Company.Adjust.Post` → 400 code 178 "Failed to register object". `CON Data` (cube) and
  `CON Company Adjust Post` (process, spaces) are fine. Model prefix `CON` ⇒ never `CON.xxx`.
- **TM1 v11 returns 400 (code 278 "already exists"), not 409, for a duplicate POST.** The client's
  create-or-replace used to treat *every* 400 as "exists → PATCH", which turned real rejections (code
  178 above, compile errors) into a misleading 404 "can not be found". Fixed in
  `tm1_client.createOrReplaceProcess`: PATCH only on 409 or 400/278; otherwise rethrow TM1's message.
- **Control ≠ effective ownership.** Classification follows IFRS 10 control: votes held by
  *controlled* entities count in full, via associates not at all; NCI uses the multiplied interest %.
  Proven on ACCA J Group (80% × 60% = 48% effective, still a subsidiary). Implemented as live
  owner-sum rules (`CON Ownership`) — recursion runs downward only, so any depth resolves with no
  per-depth rule blocks; IF-nesting kept ≤ 2 with helper measures and a fixed-width
  `SUBST('          InvestmentAssociate Subsidiary', code*10+1, 10)` lookup.
- **`CellIncrementN` for postings that can hit the same cell twice** (two journals on one account),
  always after `ViewZeroOut` of the target slice — clear + increment = idempotent re-runs.
- **Cube Map missed clear-and-rebuild processes** — writer scan only knew `CellPutN/S`. Now also
  `CellIncrementN/S` (cube 2nd arg) and `ViewZeroOut`/`CubeClearData` (cube 1st arg).
- **Period Builder was append-only.** Re-running Build with a changed FY start left stale children
  (FY2010 got 15 months); re-running with a later current period grew `Rolling 3`. Fixed in the
  generator: clear FY/YTD/YTG/LTD children (and Rolling N) before re-adding. In a Prolog, `ELCOMP`
  reads the *committed* structure, so delete by counting down from a fixed `ELCOMPN` — a
  "while children > 0" loop never ends. FY start is now genuinely a runtime configuration.
- **Catalog `ParseDate` was wrong** (2 args, v12-only, args reversed) and blocked the Period Builder's
  own output. Live-verified: `ParseDate(dateString, format [, UseLocaleDate])`, v11 OK, returns days
  since 1960-01-01 (+21916 = Excel serial).
- **`LogOutput` goes to tm1server.log, not the process error file** — a `ProcessError` abort shows only
  the line number. Write validation messages somewhere the run can be read back (a run-log cube).
- **Balances vs movements:** store movements; the Period Builder's `yyyy OBL` + `LTD FYyyyy Pnn`
  (= OBL + YTD) gives closing balance by consolidation, no rules. Point-in-time stocks (ownership %)
  are read at month leaves only — never at FY/YTD.

### FIN Consolidation v1 — checkpoint 3, the consolidation run (Sep 2026)

- **First-run match on published answers.** `CON Consolidate` reproduced ACCA's Rodney consolidated
  balance sheet line by line (goodwill 123, RE 651.4, NCI 295.6, total 3,147) and all three J Group
  variants on the first run — because every figure was hand-worked into JSON test cases *before* any
  TI was written. 27 assertions.
- **`ProcessError` rolls back EVERYTHING the process wrote — including its own log lines.** A
  validation failure that logs to a cube then calls `ProcessError` leaves no trace of why. End
  validation failures with `ProcessQuit` (writes persist, status `QuitCalled`) and have callers test
  `ExecuteProcess(...) <> ProcessExitNormal()`. Keep `ProcessError` only where there's nothing to log
  against (bad parameters).
- **TI has no end-of-line comments.** `nLog = 50;   # note` is a *syntax error* ("unknown expression")
  and it only surfaces at run time, not on save. Comments must start their own line. → candidate
  `ti-lint` rule: flag `;` followed by `#` on the same line.
- **TM1 returns process code with `\r\n` line endings.** Any regex edit of fetched TI code must allow
  `\r?\n`.
- **`TM1User()` exists on v11 but was missing from the function catalog** — added (live-verified).
- **Journals as closing positions, stored as movements.** The run computes each elimination as a
  closing amount, then converts the month's cells to movement = closing − previous month's LTD. A
  Nov→Dec run proved it: Dec closing = Nov closing, Dec movements 0, no double-count. Point-in-time
  inputs (holdings) must exist for every month consolidated.
- **Group acquisition date ≠ legal acquisition date** for a sub-subsidiary acquired before its parent
  (ACCA J Group Ex2). The event register carries the legal date plus `Values As At`; the run derives
  the group date (later of the sub's and its owners' acquisitions) and warns if they disagree.

### FIN Consolidation v1 — checkpoints 4–5, ownership changes (Sep 2026)

- **All 9 published test cases green (47 assertions)** — acquisition (full/partial goodwill), step
  acquisition, NCI purchase and sale without loss of control, loss of control to associate, plus the
  complex-group cases. Regression suite re-run before every new case: the rewrite of the NCI logic
  changed nothing for the earlier cases.
- **NCI must ROLL FORWARD, never be recomputed at today's %.** `NCI = (1 − interest now) × post-acq`
  silently restates history once ownership changes. Correct: accrue post-acquisition at the NCI %
  in force *before* each change, then apply the change as an equity transaction (NCI adjusts,
  difference to parent equity, no P&L, goodwill unchanged — IFRS 10.23/B96).
- **Goodwill uses the consideration AT CONTROL, not the investment balance** — later tranches sit in
  the same investment account. The event carries `Consideration`; later tranches are eliminated in
  the Ownership Change stage.
- **The NCI adjustment basis is a policy, not a rule** — ACCA itself uses proportion-of-carrying for
  a purchase and share-of-(net assets + goodwill) for a sale. Carried per event (`NCI Basis`).
- **Loss of control needs two layers:** *Exclusion* reverses everything previously copied for the
  entity (every month after, not just the disposal month — it's a closing position), and *Disposal*
  books the group gain, reverses the parent's own gain, brings the retained interest in at fair value
  and keeps the group's share of post-acquisition profit. Once the entity stops being a subsidiary its
  elimination targets fall to zero and the closing→movement conversion reverses them automatically.

### FIN Consolidation v1 — master group, currency translation, intragroup (Oct 2026)

- **Two full ACCA group questions matched line by line on first run:** Kutchen (P2 Jun 2015, total
  assets 544.86 — in-year acquisitions, share + land consideration, eight IAS 19/37/12/lease/impairment
  corrections through the company-journal layer) and Bubble (P2 INT Dec 2015, total assets 613.9 —
  foreign subsidiary in dinars, goodwill retranslation, translation reserve 60/40 with NCI,
  intragroup loan). 75 assertions, all run by `CON Test Run All` in one call.
- **Prove the design numerically before writing TI.** A 30-line script reproducing ACCA's answer with
  the proposed journal set caught nothing wrong in Bubble — but for Kutchen it showed that NCI's
  post-acquisition share had to be split by equity component (RE vs OCE), or only the total matched.
- **Currency without a currency dimension:** entity data stays in the entity's currency, each root's
  slice is in the root's currency (entity attribute `Currency`). Translation = a derived stage:
  assets/liabilities at closing, acquisition equity at the historic rate (carried on the event),
  post-acquisition at average, balancing figure to the translation reserve. Goodwill of a foreign sub
  is computed in ITS currency and retranslated at closing (IAS 21.47).
- **Mid-run reads of a derived stage see the CLOSING target, not the movement** — so the LTD of a
  derived stage is wrong until the closing→movement conversion runs. Read copied stages at LTD and
  derived stages at the current month cell (intragroup region does exactly that).
- **Fair value adjustments on liabilities** (contingent liability) must reduce net assets — sign from
  the account's DRCR. Silent until a test with a liability FVA arrived.

### FIN Consolidation v1 — SKIPCHECK + feeders on a recursive rule cube (Oct 2026)

- **Proven the danger before fixing it:** with `SKIPCHECK` on and no feeders, Rodney's Del and
  Trigger read **0% control and a blank classification — no error**. On a classification cube an
  under-fed edge doesn't give a slightly wrong number, it silently removes a subsidiary.
- **Feed only the edges.** Values read with `DB()` (the owner's `Controlled`, `Interest %`) always
  evaluate and need no feeding; only the leaf cells that roll into a consolidation do. Two feeders on
  the input cube, targeting a consolidated root (`All Roots`) so every root sees every edge.
- **Self-checking feeders, runnable on PROD:** under SKIPCHECK a consolidation adds only FED leaves, but
  a direct read of ONE leaf always evaluates the rule. So `CON Feeder Check` compares Σ(leaf reads)
  with the consolidated total for every entity × root; any gap = under-fed. It runs inside every
  consolidation month and standalone. Proven by the negative test (SKIPCHECK without feeders →
  `QuitCalled`). The same idea as an MDX assertion: `WITH MEMBER [Owner].[Feed Gap] AS
  SUM(leaves) - [Owner].[All Owners]` → expected 0.
- **MCP `reprocess_feeders` fails on this v11** (`tm1.ProcessFeeders` REST action not resolvable) —
  keep a `<prefix> Reprocess Feeders` TI with `CubeProcessFeeders` (source cube first) in every model.

### FIN Consolidation v1 — year-end close + IAS 21 per-period translation (Oct 2026)

- **Movements + an `yyyy OBL` leaf need a close, even for monthly Actuals.** `LTD FYyyyy Pnn = yyyy OBL + YTD`,
  and nothing fills the OBL leaf by itself — without a close, P01 of a new year opens at zero (proven: TC06Y2
  total assets collapsed to −56.87). `CON Year End Close (pVersion, pPeriod)` rebuilds the version's OBL from
  the prior year's LTD P12 for every root and stage; P&L/dividend leaves close into RE Brought Forward
  signed by their weight path up to `Retained Earnings` (ELPAR/ELWEIGHT walk — no hand-listed accounts).
  `CON Consolidate` calls it when a month's OBL differs from the previous month's AND the previous month is
  inside the version (a version that *starts* at P01 keeps its OBL as input).
- **Find the OBL from the period dimension, not by name:** `ELCOMP('CON Period', ATTRS(month,'LTD'), 1)`.
  At a year boundary the closing→movement conversion's "prior closing" must be the new OBL, not LTD P12 —
  they differ by exactly the P&L that closed into RE b/f.
- **One-off event gains (remeasurement, disposal) recomputed as closing positions double-count after a close**
  — post them to P&L only in the event's financial year, to RE b/f afterwards.
- **IAS 21: never retranslate history at the current average.** v1 translated all post-acquisition equity,
  NCI's post-acq share and impairment at this month's average; months with NO movement drifted when the
  average changed (−0.1969 post-acq + 0.1783 impairment = −0.0186, found by flat filler months — a cheap,
  sharp test). Fix: chain equity (last month's translated closing + this month's movement / this month's
  average), derive NCI post-acq from that translated equity, translate each impairment at its own month's
  average. Net assets stay at closing; translation reserve stays the balancing figure.
- **Testing a close without a published two-year answer:** anchor year 1 on a published case, construct
  year 2, and assert invariants (no-movement months stable, OBL = P12 closing, P&L opens at 0, rerun from
  P01 identical) plus hand-calculated ACCA-method P01 figures.

### FIN Consolidation v1 — sub-groups / consolidation of consolidation (Oct 2026)

- **v11: a data leaf can't be a consolidated node in an alternate hierarchy** — adding `J1` (a leaf in
  `CON Root`) as a parent in a `Group Structure` hierarchy fails with `ElementLeafConsolidationConflict`
  (and leaves an empty hierarchy behind — delete it). A structure-only tree over data leaves needs either
  separate node elements or an attribute; we used a `Parent Group` string attribute on `CON Root`.
- **Plain C of C does NOT reproduce the ACCA (direct + indirect holding adjustment) answer.** J→80% B→60% D,
  full goodwill: building the B group first gives D goodwill 18.8 (B's cost 22); J's 20% NCI in B then
  shares in it, so group goodwill and NCI are both 4.4 (= 20% × 22) higher than ACCA; owners' equity is
  identical. Partial method differs too (20% × B-group goodwill). If B bought D before J bought B, D must also
  be remeasured at J's date (−1.1 in TC01c). So group totals must come from the direct engine; the sub-group
  keeps its own books (just another root) and the parent-level adjustment = parent minus sub-group for the
  sub-group's members (bridge: −4.4 IHA, −5.5 with the trap). The members-only bridge doesn't balance on its
  own — the investment-elimination half sits on the parent entity.
- **Run order:** sub-groups before the groups they feed (CON Test Run All: deepest `Parent Group` first).
  A new root must be a child of `All Roots` AND feeders reprocessed, or CON Feeder Check stops the run.
- Where C of C legitimately changes numbers — FX sub-groups translated as a unit (IFRIC 16 step-by-step) —
  is NOT built yet.
- **Foreign intermediate holding a foreign sub (three currencies)** — the direct engine treated an owner's
  investment balance as if it were already in the sub's currency. Fix: take it owner → group at the
  acquisition date (`Acq FX Rate Owner` on the event) → sub's currency for goodwill (330 DIN = 82.5 EUR);
  eliminate it at its *closing*-translated value (that's how the owner's asset arrives); the FX on the
  eliminated investment sits in the owner's translation reserve — take it back out split owners/NCI by the
  owner's interest. Entity currency is an attribute (not per version), so a currency test needs its own
  entities (J7/B7/D7), not re-used TC01 codes.
- **IFRIC 16 step-by-step = `FX Method` on CON Version** (`Direct` default | `Step`): a member of a foreign
  sub-group is translated from the sub-group's books (already in the sub-group currency) instead of its own.
  With cross-consistent closing/acquisition rates only average-rate items differ: TC07 vs TC07S moves profit
  −0.5072 (RE −0.2435 / translation reserve +0.2435 owners), total equity identical; D's own reserve 30.75 → 31.2572.
- **Disposal of a foreign subsidiary (IAS 21.48) — TC08, ACCA IAS 21 article (Holt) case study 2: gain 8.**
  The domestic disposal logic broke three ways for a foreign sub (proven by a negative run): the gain was
  computed in the sub's currency untranslated; the translation reserve just vanished instead of recycling;
  and **Exclusion reversed the derived Translation stage that region 5 already clears** (net assets −28,
  reserve −6 — double). Fixes: Exclusion reverses only the copied stages (Reported + Company Adj); a foreign
  disposal takes carrying amounts (translated net assets, goodwill, NCI, owners' reserve) from the month-end
  before the disposal, proceeds at the disposal-month closing rate, cost at the acquisition rate, and adds
  the owners' reserve to the gain. The RE line is solved so the disposal lines balance.
- **Results to disposal stay in group P&L (IFRS 10.B88)** — the exclusion takes a former sub's P&L out with
  everything else, so its result for the year of disposal used to land in RE b/f. The disposal journal now puts
  this year's P&L back (Disposal stage) and takes the same amount from RE b/f — equity unchanged. Only in the
  disposal's own financial year (after the close it is already in RE b/f). TC08: group P&L −3 + 8 = 5.

### TM1 only persists cube data on SaveDataAll or a clean shutdown (Oct 2026 — lost and restored TM1_CONSOL)

- TM1_CONSOL went down uncleanly (a leftover `tm1sd.exe` kept `PortNumber` 17433, so the service's restarts died
  with `E15) Server unable to listen on port 17433`; worked around by giving it `PortNumber=17434` — REST port
  52229 unchanged, so IDE/MCP/PAW unaffected). On restart **all input cube data loaded via REST/TI since the last
  save was gone** (CON Data, Holding, FX Rate, Company Journal); metadata, processes, rules and attribute values
  survived. "Transaction log write-locked, recovery possible" is NOT replayed automatically for a service.
- Recovered by reloading every test payload (kept as JSON in the session scratchpad — keep doing that) +
  Reprocess Feeders + CON Test Run All → 119/119. Then `CON Save Data` (SaveDataAll).
- **Rule now: SaveDataAll after every data load / build** (`CON Save Data`), and a scheduled save chore.
  Keep test payloads as files, not only as one-off write_cells calls — they were the whole recovery.

### Consolidation of consolidation — two options built side by side (Oct 2026)

- Option A (roots + direct engine + bridge) and Option B (James's path-encoding article: `PE Entity` path
  elements, `CC_`/`CG_` rollups, SUBST-pair ownership rules per depth, Grouped reversal rule) coexist on one
  server: B uses its own `PE` objects and reads A's inputs read-only. Write-up:
  `tm1_consolidation/design/option_a_vs_b_comparison.md`.
- Ng Eng Juan Ex 1–2: both options = book. They diverge only when the **sub-group has goodwill** (TC01: B +4.4
  goodwill/NCI = the indirect holding adjustment plain C of C omits); owners' equity always identical.
- Rules: depth blocks chained with `CONTINUE` (`IF( LONG(!dim) = 8, …, CONTINUE );`) stay within TM1's 2-deep IF
  limit and read exactly like "one block per depth". Guard `ELISPAR` on generated names with `DIMIX(…) = 0`
  first. A rules-only cube read only at leaf level can be SKIPCHECK without feeders.
- **IDE rules-lint bug (fixed Oct 2):** `IF( cond, - ['Base Data', 'Amount'], 0 )` was rejected as "IF() expects 3
  arguments, got 4" — the server linter split on the comma inside an area reference. Fixed in `core/rules-lint.js`.
- Option B now classifies by control and posts an `Indirect Holding Adj` stage → B = A = ACCA in all cases.
- **One goodwill per business combination (IFRS 3) — Option A bug found by comparing with Option B (TC11, Ng Eng
  Juan Ex 4 under IFRS).** Measuring goodwill subsidiary by subsidiary split one combination (L buys M, which owns N,
  and so gains control of N the same day) into goodwill 9 on M **plus** a bargain gain 2.25 on N. Region 4a of
  `CON Consolidate` now nets a bargain against goodwill of subsidiaries with the same group acquisition date (same
  currency; foreign pairs are logged, not netted) → goodwill 6.75, as IFRS 3 and Option B.
- Other engine gaps closed by the Ng Eng Juan set: indirect holding adjustment on a **stated** consideration paid by
  an intermediate (`Acquirer` ≠ root); NCI trades booked on the trade event's own `Acquirer`; Option B connecting
  affiliate (direct stake into a sub-group's company) needs the `Y` override + its own journal.
- `CON Test Run All` now runs > 2 minutes — longer than the MCP `run_process` timeout. The process still completes on
  the server; poll `Threads` until idle before reading results or saving.
- **Intragroup P&L (Ng Eng Juan Ex 6, TC13):** partner-tagged P&L lines (sales vs cost of sales, dividend income vs
  dividends paid) and balances are eliminated by the existing per-group region 4d — group-specific membership means a
  sub-group's own accounts keep sales to its parent as external. Unrealised profit in stock is a group-specific event
  (`unrealised_profit`: Target seller, Counterparty buyer, Amount) posted as a closing position (reverses = realises
  the next month with no event); the seller's NCI bears its share. Option B (no partner dim) reads partner detail from
  CON Data and eliminates level by level, skipping pairs already inside the same sub-group.
- Book Ex 6 goodwill "amortisation in previous years" maps to a prior-year impairment, and proposed dividends to
  dividends declared before year end — book figures preserved under IFRS.
- **Ng Eng Juan Ex 7 (TC14) — the workbook's worked answer was wrong;** corrected from first principles (cost of sales
  must include the 15 opening-stock profit realised; total 3,428 balances) and both options reproduce the correction.
  `unrealised_profit` now takes `Profit Account` / `Balance Account` (land: RE b/f + Other Net Assets; opening stock
  realised: Cost of Sales + RE b/f with a negative amount); NCI shares it only when net assets change (balance account
  an asset). Option B's connecting affiliate generalised to a path through a partly-owned intermediate.

### Storing documents in TM1 v11 Applications (Oct 2026 — phase 0 of model-owned history)

- `Contents('Files')` is v12-only; on v11.8 use `Contents('Applications')`.
- Folder names **can't start with `}`** (POST 400) — Applications folders can't be hidden by naming.
- A document named `X` gets ID **`X.blob`**; address it by ID. Content is at **`…/Contents('X.blob')/Document/Content`**
  on v11 (`…/Contents('X')/Content` → 404 "'Content' resource can not be resolved on type 'DocumentReference'").
- Deleting a folder deletes its documents. 5 MB writes fine (~0.3 s).
- Documents survived a stuck shutdown + VM reboot with no SaveDataAll — unlike cube data (see the SaveDataAll entry).
- A stuck shutdown ("Saving… The server is coming down… Deactivating chore", then nothing; REST refuses connections,
  service won't stop, Task Manager can't kill it) needed a VM reboot. CON data came back intact (133/133).

